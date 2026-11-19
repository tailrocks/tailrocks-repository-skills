// Open the PR. open compares the head first, runs the plan again, refuses on any
// blocker, pushes the exact commit, and creates one PR (or reuses the open
// one). It sets the state that the policy names. It never forces a push.
//
// Exit rules. Before the first write, a stop is exit 3 (the user decides) or
// exit 4 (the head, the tree, or a blocker changed: run plan again). After the
// first write, nothing is "refused": every failure is a problem and the exit is
// 20, because part of the work is already on the remote.

import { removeBodyFiles, writeBodyFile } from "../body-file.ts";
import { ReadError } from "../github/read.ts";
import type { PolicyError } from "../policy/types.ts";
import { listOpenPrs, StepError } from "./github.ts";
import { fetchBranch, gitSha, readTreeState } from "./local.ts";
import { buildPlan } from "./plan.ts";
import { classifyPush } from "./push.ts";
import type { CreateArgs, CreateConfig, Finding, OpenPr, Plan } from "./types.ts";

export interface OpenReport {
  readonly plan: Plan;
  readonly pushed: boolean;
  readonly created: boolean;
  readonly pr: OpenPr | null;
  readonly labelsAdded: readonly string[];
  readonly notes: readonly string[];
  /** Things that went wrong after a write, or that need a later step. Any problem makes the exit code 20. */
  readonly problems: readonly string[];
  readonly findings: readonly Finding[];
  readonly next: string;
}

export type OpenResult =
  | { readonly kind: "policy-error"; readonly errors: readonly PolicyError[] }
  | { readonly kind: "refused"; readonly code: 3 | 4; readonly reasons: readonly string[] }
  | { readonly kind: "finished"; readonly report: OpenReport };

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}

function refused(code: 3 | 4, ...reasons: readonly string[]): OpenResult {
  return { kind: "refused", code, reasons };
}

const PR_URL = /https?:\/\/\S+\/pull\/\d+/;

export async function openPr(args: CreateArgs, cfg: CreateConfig): Promise<OpenResult> {
  try {
    return await open(args, cfg);
  } catch (error) {
    if (error instanceof StepError || error instanceof ReadError) {
      return refused(3, error.message);
    }
    throw error;
  } finally {
    // The body file lives in a private directory of this process. Delete it by its exact path.
    removeBodyFiles();
  }
}

async function open(args: CreateArgs, cfg: CreateConfig): Promise<OpenResult> {
  // The cheapest check comes first: no policy command runs for a head that is not the planned one.
  const headFirst = await gitSha(cfg.runGit, ["rev-parse", "HEAD"]);
  if (headFirst !== args.expectHead) {
    return refused(4, `the head changed since plan: plan saw ${args.expectHead ?? ""}, now it is ${headFirst}. Nothing was run. Run plan again.`);
  }
  const first = await buildPlan(args, cfg);
  if (first.kind === "policy-error") {
    return first;
  }
  if (first.kind === "failed") {
    return refused(3, first.error);
  }
  const { plan } = first;
  if (plan.headSha !== args.expectHead) {
    return refused(4, `the head changed while open read the plan: it is now ${plan.headSha}. Run plan again.`);
  }
  const stops = plan.findings.filter((f) => f.kind !== "info");
  if (stops.length > 0) {
    const hasRefusal = stops.some((f) => f.kind === "refusal");
    return refused(hasRefusal ? 3 : 4, ...stops.map((f) => `${f.code}: ${f.detail}`), hasRefusal ? "Stop and report this. The user decides." : "Run plan, fix each item, and run open again.");
  }
  const branch = plan.headBranch;
  if (branch === null) {
    return refused(4, "HEAD is not on a branch. Run plan.");
  }
  if (plan.existing === null && (plan.finalBody === null || plan.title === null)) {
    return refused(4, "open needs a valid --body-file for a new PR. Run plan --body-file <file> first.");
  }

  // The window between the plan and the write: read the commit and the tree once more.
  const headNow = await gitSha(cfg.runGit, ["rev-parse", "HEAD"]);
  const tree = await readTreeState(cfg.runGit);
  if (headNow !== plan.headSha || tree.tracked.length > 0) {
    return refused(4, "the head or the working tree changed while open ran. Nothing was pushed. Run plan again.");
  }

  const notes: string[] = [];
  const problems: string[] = [];
  let pushed = false;
  let created = false;
  let pr: OpenPr | null = null;
  let labelsAdded: readonly string[] = [];

  const finish = (): OpenResult => {
    if (pr !== null && plan.unsignedPushed.length > 0) {
      problems.push(`dco_missing: ${plan.unsignedPushed.length} pushed commit${plan.unsignedPushed.length === 1 ? " lacks" : "s lack"} a sign-off. The PR stays a draft. Run pr-refresh dco-fix ${pr.number}.`);
    }
    const dcoNext = pr !== null && plan.unsignedPushed.length > 0 ? `pr-refresh dco-fix ${pr.number}` : null;
    return {
      kind: "finished",
      report: {
        plan,
        pushed,
        created,
        pr,
        labelsAdded,
        notes,
        problems,
        findings: plan.findings,
        next:
          dcoNext !== null
            ? `Run ${dcoNext}. Then run pr-status ${pr?.number ?? ""}.`
            : problems.length > 0
              ? "Read the problems above. Run plan, then open again: open reuses the pushed branch and the open PR."
              : pr === null
                ? "Run plan."
                : pr.isDraft
                  ? `Run pr-status ${pr.number}. The PR is a draft: pr-merge ready marks it ready when the policy allows.`
                  : `Run pr-status ${pr.number}.`,
      },
    };
  };

  const addLabels = async (target: OpenPr): Promise<readonly string[]> => {
    if (plan.labels.length === 0) {
      return [];
    }
    const edit = await cfg.runGh(["pr", "edit", String(target.number), "--repo", plan.repo, "--add-label", plan.labels.join(",")]);
    if (edit.code === 0) {
      return plan.labels;
    }
    problems.push(`adding the labels ${plan.labels.join(", ")} failed: ${firstLine(edit.stderr)}`);
    return [];
  };

  // ---------- The push: the first write ----------
  if (plan.relation !== "same") {
    const result = await cfg.runGit(["push", plan.remote, `${plan.headSha}:refs/heads/${branch}`]);
    if (result.code !== 0) {
      // The class comes from git's own ref status lines (see push.ts), never from words in the output.
      const failure = classifyPush(result.stderr, result.code);
      const reason = `git push failed, nothing was pushed: ${failure.cause}`;
      // Exit 4 needs a rejected push (the remote branch moved) and an unchanged local head.
      // A refusal by the remote (a hook, a protected branch) is not cured by a new plan.
      const headStill = (await gitSha(cfg.runGit, ["rev-parse", "HEAD"])) === plan.headSha;
      return failure.kind === "moved" && headStill
        ? refused(4, reason, "The remote branch moved. Run plan again.")
        : refused(3, reason);
    }
    pushed = true;
  }

  // From here on, any failure is a problem and the exit is 20.
  try {
    if (pushed) {
      const check = await fetchBranch(cfg.runGit, plan.remote, branch);
      if (check.kind !== "found" || check.sha !== plan.headSha) {
        problems.push(`the remote branch does not show ${plan.headSha} after the push`);
      }
    }

    if (plan.existing !== null) {
      pr = plan.existing;
      notes.push(pushed ? `pushed the new commits to PR #${pr.number}` : `PR #${pr.number} is already open and current`);
      if (pushed) {
        const seen = (await listOpenPrs(cfg.runGh, plan.repo, branch)).find((p) => p.number === plan.existing?.number);
        if (seen !== undefined && seen.headSha !== plan.headSha) {
          notes.push(`GitHub still shows the older head ${seen.headSha.slice(0, 7)} for the PR; run pr-status again in a minute`);
        }
      }
      labelsAdded = await addLabels(pr);
      return finish();
    }

    // ---------- Create the PR ----------
    const title = plan.title ?? "";
    const bodyPath = writeBodyFile(plan.finalBody ?? "");
    const create = await cfg.runGh([
      "pr", "create", "--repo", plan.repo, "--base", plan.base.ref, "--head", branch, "--title", title, "--body-file", bodyPath,
      ...(plan.draft ? ["--draft"] : []),
    ]);
    if (create.code !== 0) {
      problems.push(`gh pr create failed (exit ${create.code}): ${firstLine(create.stderr)}`);
    }
    const printed = PR_URL.exec(create.stdout)?.[0] ?? null;
    // After a failure or a lost reply, read GitHub before anything else. Never create a second PR.
    let found: readonly OpenPr[];
    try {
      found = (await listOpenPrs(cfg.runGh, plan.repo, branch)).filter((p) => p.headRef === branch && !p.isCrossRepository);
    } catch (error) {
      if (error instanceof StepError || error instanceof ReadError) {
        problems.push(`the branch is pushed, but the PR state is unknown: ${error.message}${printed === null ? "" : `. gh printed ${printed}`}`);
        return finish();
      }
      throw error;
    }
    if (found.length > 1) {
      problems.push(`${found.length} open PRs now have the head ${branch}. Do not open another. Ask the user.`);
      return finish();
    }
    const seen = found[0] ?? null;
    if (seen === null) {
      problems.push(create.code === 0 ? `gh pr create reported success${printed === null ? "" : ` (${printed})`}, but no open PR shows for the branch` : "the branch is pushed and no PR exists");
      return finish();
    }
    pr = seen;
    created = true;
    if (create.code !== 0) {
      notes.push("gh pr create reported an error, but the PR exists; it was not created twice");
    }
    if (pr.headSha !== plan.headSha || pr.baseRef !== plan.base.ref || pr.title !== title) {
      problems.push(`PR #${pr.number} does not match the plan (head ${pr.headSha.slice(0, 7)}, base ${pr.baseRef}, title ${JSON.stringify(pr.title)})`);
    }

    // ---------- Draft or ready, set by the policy ----------
    if (pr.isDraft !== plan.draft) {
      if (pr.isDraft && !plan.draft) {
        const mutation = await cfg.mutate({ kind: "markPullRequestReadyForReview", pullRequestId: pr.id });
        if (mutation.code === 0) {
          notes.push("marked the PR ready because draft.create_as_draft is false");
          pr = { ...pr, isDraft: false };
        } else {
          problems.push(`the PR is a draft, but the policy says ready, and marking it ready failed: ${firstLine(mutation.stderr)}`);
        }
      } else {
        problems.push("the PR is not a draft, but the policy says draft; this skill does not convert a PR back to a draft. Tell the user.");
      }
    }
    labelsAdded = await addLabels(pr);
    return finish();
  } catch (error) {
    if (error instanceof StepError || error instanceof ReadError) {
      problems.push(`a read failed after a write: ${error.message}. Run plan: it reuses the pushed branch and the open PR.`);
      return finish();
    }
    throw error;
  }
}
