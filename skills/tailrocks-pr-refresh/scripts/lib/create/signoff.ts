// signoff: add the missing Signed-off-by lines to the unpushed commits of the
// branch. The rewrite is the shared one of lib/dco.ts (`rewriteLocal`): it
// rebuilds each commit with `git commit-tree` (same tree, same author name,
// email, and date, same message plus one trailer) and checks every rebuilt
// commit as git stored it. This module only chooses the commits (never one that
// is on the remote), refuses what a local rewrite cannot keep, and then moves
// the local branch with a compare-and-swap `update-ref`. It never pushes. The
// trees do not change, so the working tree and the index stay as they are. The
// push capability stays private to lib/dco.ts.

import { rewriteLocal, type RangeCommit, type RewritePlan } from "../dco.ts";
import { ReadError } from "../github/read.ts";
import type { PolicyError } from "../policy/types.ts";
import { GitFailure, repoAt } from "../refresh/gitx.ts";
import { parseSha, type Sha } from "../types.ts";
import { branchProblem, needsSignoff, type CommitInfo } from "./checks.ts";
import { StepError } from "./github.ts";
import { gitOut, gitSha } from "./local.ts";
import { buildPlan } from "./plan.ts";
import type { CreateArgs, CreateConfig } from "./types.ts";

const STOPS: ReadonlySet<string> = new Set(["dirty_tree", "detached_head", "on_protected_branch", "no_commits"]);

export type SignoffResult =
  | { readonly kind: "policy-error"; readonly errors: readonly PolicyError[] }
  | { readonly kind: "refused"; readonly code: 3 | 4; readonly reasons: readonly string[] }
  | {
      readonly kind: "done";
      readonly branch: string;
      readonly oldHead: Sha;
      readonly newHead: Sha;
      readonly trailersAdded: number;
      readonly reparented: number;
    };

function refused(code: 3 | 4, ...reasons: readonly string[]): SignoffResult {
  return { kind: "refused", code, reasons };
}

function asInfo(commit: RangeCommit): CommitInfo {
  return { sha: commit.sha, authorName: commit.authorName, authorEmail: commit.authorEmail, subject: commit.message.split("\n")[0] ?? "", message: commit.message };
}

const label = (commit: RangeCommit): string => commit.sha.slice(0, 7);

/**
 * The check that runs on the chosen rewrite set before any commit is built. A
 * commit that the remote branch holds would need a force-push, and a merge or a
 * root commit cannot be rebuilt on one parent. The commit selection already
 * leaves pushed commits out, so the first refusal is defense in depth.
 */
export function rewriteRefusal(pushed: ReadonlySet<Sha>): (rewrite: RewritePlan) => { readonly code: string; readonly headline: string; readonly next: string } | null {
  return (rewrite) => {
    const onRemote = rewrite.rewrite.filter((c) => pushed.has(c.sha));
    if (onRemote.length > 0) {
      return {
        code: "pushed_commit",
        headline: `${onRemote.map(label).join(", ")} ${onRemote.length === 1 ? "is" : "are"} already on the remote branch; a rewrite would need a force-push`,
        next: "run tailrocks-pr-refresh in dco-fix mode on the open PR",
      };
    }
    const odd = rewrite.rewrite.filter((c) => c.parents.length !== 1);
    if (odd.length > 0) {
      return { code: "merge_commit", headline: `${odd.map(label).join(", ")} ${odd.length === 1 ? "is" : "are"} a merge or a root commit`, next: "sign off by hand" };
    }
    return null;
  };
}

export async function signoffRange(args: CreateArgs, cfg: CreateConfig): Promise<SignoffResult> {
  try {
    return await signoff(args, cfg);
  } catch (error) {
    // The shared rewrite throws GitFailure when git fails. Nothing was moved, so it is a refusal.
    if (error instanceof StepError || error instanceof ReadError || error instanceof GitFailure) {
      return refused(3, error.message);
    }
    throw error;
  }
}

async function signoff(args: CreateArgs, cfg: CreateConfig): Promise<SignoffResult> {
  const git = cfg.runGit;
  const oldHead = await gitSha(git, ["rev-parse", "HEAD"]);
  if (oldHead !== args.expectHead) {
    return refused(4, `the head changed since plan: plan saw ${args.expectHead ?? ""}, now it is ${oldHead}. Run plan again.`);
  }
  const result = await buildPlan(args, cfg);
  if (result.kind === "policy-error") {
    return result;
  }
  if (result.kind === "failed") {
    return refused(3, result.error);
  }
  const { plan } = result;
  // Only a finding that makes a rewrite unsafe stops it. A missing title or body is for a later plan.
  const others = plan.findings.filter((f) => f.kind === "refusal" || (f.kind === "blocker" && STOPS.has(f.code)));
  if (others.length > 0) {
    return refused(others.some((f) => f.kind === "refusal") ? 3 : 4, ...others.map((f) => `${f.code}: ${f.detail}`), "Fix these first. Run plan again.");
  }
  const branch = (await gitOut(git, ["branch", "--show-current"])).trim();
  if (branch === "") {
    return refused(3, "HEAD is not on a branch");
  }
  // The step moves the checked-out branch and nothing else, and never the default or a protected branch.
  if (branch !== plan.headBranch) {
    return refused(3, `signoff moves the checked-out branch ${branch}, but the plan is for ${plan.headBranch ?? "no branch"}. Do not pass --branch to signoff.`);
  }
  if (branchProblem(branch, plan.policy, plan.defaultBranch)?.code === "on_protected_branch") {
    return refused(3, `${branch} is the default branch or a protected branch; signoff never moves it`);
  }

  // The commits of the range that the remote branch already holds. A rewrite would need a force-push for them.
  const pushed = new Set<Sha>();
  if (plan.remoteHead !== null) {
    for (const line of (await gitOut(git, ["rev-list", plan.remoteHead, `^${plan.base.sha}`])).split("\n")) {
      const parsed = parseSha(line.trim());
      if (parsed.ok) {
        pushed.add(parsed.value);
      }
    }
  }
  const preflight = rewriteRefusal(pushed);

  const rewritten = await rewriteLocal({
    repo: repoAt(cfg.cwd, cfg.runRepo),
    head: oldHead,
    base: plan.base.sha,
    needsTrailer: (commit) => commit.parents.length === 1 && needsSignoff(asInfo(commit), plan.policy) && !pushed.has(commit.sha),
    preflight,
  });
  switch (rewritten.kind) {
    case "unchanged":
      return refused(3, "no unpushed commit needs a sign-off");
    case "refused":
      return refused(3, rewritten.refusal.headline, ...rewritten.details);
    case "aborted":
      return refused(3, `${rewritten.headline}. Nothing was moved.`);
    case "built":
      break;
  }

  // ---------- Move the branch: compare-and-swap, no checkout ----------
  const { newHead } = rewritten;
  const moved = await cfg.runGit(["update-ref", `refs/heads/${branch}`, newHead, oldHead]);
  if (moved.code !== 0) {
    return refused(4, `git update-ref failed, the branch did not move: ${moved.stderr.trim().split("\n")[0] ?? `exit ${moved.code}`}. Run plan again.`);
  }
  if ((await gitSha(git, ["rev-parse", "HEAD"])) !== newHead) {
    throw new StepError("the branch moved, but HEAD does not show the new head");
  }
  return { kind: "done", branch, oldHead, newHead, trailersAdded: rewritten.trailersAdded, reparented: rewritten.reparented };
}
