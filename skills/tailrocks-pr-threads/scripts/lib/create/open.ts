// Open the PR. open runs the plan again, refuses on any blocker, pushes the
// exact commit, creates one PR (or reuses the open one), and sets the state
// that the policy names. It never forces a push.

import { removeBodyFiles, writeBodyFile } from "../body-file.ts";
import { gitSha, fetchBranch, readTreeState } from "./local.ts";
import { listOpenPrs, StepError } from "./github.ts";
import { buildPlan } from "./plan.ts";
import type { CreateArgs, CreateConfig, OpenPr, Plan } from "./types.ts";
import type { PolicyError } from "../policy/types.ts";
import { ReadError } from "../github/read.ts";

export interface OpenReport {
  readonly plan: Plan;
  readonly pushed: boolean;
  readonly created: boolean;
  readonly pr: OpenPr | null;
  readonly labelsAdded: readonly string[];
  readonly notes: readonly string[];
  /** Things that went wrong after a write. Any problem makes the exit code 20. */
  readonly problems: readonly string[];
  readonly next: string;
}

export type OpenResult =
  | { readonly kind: "policy-error"; readonly errors: readonly PolicyError[] }
  | { readonly kind: "refused"; readonly reasons: readonly string[] }
  | { readonly kind: "finished"; readonly report: OpenReport };

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}

function refused(...reasons: readonly string[]): OpenResult {
  return { kind: "refused", reasons };
}

export async function openPr(args: CreateArgs, cfg: CreateConfig): Promise<OpenResult> {
  try {
    return await open(args, cfg);
  } catch (error) {
    if (error instanceof StepError || error instanceof ReadError) {
      return refused(error.message);
    }
    throw error;
  } finally {
    // The body file lives in a private directory of this process. Delete it by its exact path.
    removeBodyFiles();
  }
}

async function open(args: CreateArgs, cfg: CreateConfig): Promise<OpenResult> {
  const first = await buildPlan(args, cfg);
  if (first.kind === "policy-error") {
    return first;
  }
  if (first.kind === "failed") {
    return refused(first.error);
  }
  const { plan } = first;
  if (plan.headSha !== args.expectHead) {
    return refused(`the head changed since plan: plan saw ${args.expectHead ?? ""}, now it is ${plan.headSha}. Run plan again.`);
  }
  const stops = plan.findings.filter((f) => f.kind !== "info");
  if (stops.length > 0) {
    return refused(...stops.map((f) => `${f.code}: ${f.detail}`), "Run plan, fix each item, and run open again.");
  }
  const branch = plan.headBranch;
  if (branch === null) {
    return refused("HEAD is not on a branch");
  }
  if (plan.existing === null && (plan.finalBody === null || plan.title === null)) {
    return refused("open needs a valid --body-file for a new PR. Run plan --body-file <file> first.");
  }

  // The window between the plan and the write: read the commit and the tree once more.
  const headNow = await gitSha(cfg.runGit, ["rev-parse", "HEAD"]);
  const tree = await readTreeState(cfg.runGit);
  if (headNow !== plan.headSha || tree.tracked.length > 0) {
    return refused("the head or the working tree changed while open ran. Nothing was pushed. Run plan again.");
  }

  const notes: string[] = [];
  const problems: string[] = [];
  let pushed = false;
  if (plan.relation !== "same") {
    const result = await cfg.runGit(["push", plan.remote, `${plan.headSha}:refs/heads/${branch}`]);
    if (result.code !== 0) {
      return refused(`git push failed, nothing was pushed: ${firstLine(result.stderr) || `exit ${result.code}`}`);
    }
    pushed = true;
    const check = await fetchBranch(cfg.runGit, plan.remote, branch);
    if (check.kind !== "found" || check.sha !== plan.headSha) {
      problems.push(`the remote branch does not show ${plan.headSha} after the push`);
    }
  }

  const finish = (pr: OpenPr | null, created: boolean, labelsAdded: readonly string[]): OpenResult => ({
    kind: "finished",
    report: {
      plan,
      pushed,
      created,
      pr,
      labelsAdded,
      notes,
      problems,
      next:
        problems.length > 0
          ? "Read the problems above. Run plan, then open again: open reuses the pushed branch and the open PR."
          : pr === null
            ? "Run plan."
            : pr.isDraft
              ? `Run pr-status ${pr.number}. The PR is a draft: pr-merge ready marks it ready when the policy allows.`
              : `Run pr-status ${pr.number}.`,
    },
  });

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

  if (plan.existing !== null) {
    notes.push(pushed ? `pushed the new commits to PR #${plan.existing.number}` : `PR #${plan.existing.number} is already open and current`);
    if (pushed) {
      const seen = (await listOpenPrs(cfg.runGh, plan.repo, branch)).find((p) => p.number === plan.existing?.number);
      if (seen !== undefined && seen.headSha !== plan.headSha) {
        notes.push(`GitHub still shows the older head ${seen.headSha.slice(0, 7)} for the PR; run pr-status again in a minute`);
      }
    }
    const labelsAdded = await addLabels(plan.existing);
    return finish(plan.existing, false, labelsAdded);
  }

  // ---------- Create the PR ----------
  const title = plan.title ?? "";
  const bodyPath = writeBodyFile(plan.finalBody ?? "");
  const create = await cfg.runGh([
    "pr", "create", "--repo", plan.repo, "--base", plan.base.ref, "--head", branch, "--title", title, "--body-file", bodyPath,
    ...(plan.draft ? ["--draft"] : []),
  ]);
  // After a failure or a lost reply, read GitHub before anything else. Never create a second PR.
  const found = (await listOpenPrs(cfg.runGh, plan.repo, branch)).filter((p) => p.headRef === branch && !p.isCrossRepository);
  if (create.code !== 0) {
    problems.push(`gh pr create failed (exit ${create.code}): ${firstLine(create.stderr)}`);
  }
  let pr = found.length === 1 ? (found[0] ?? null) : null;
  if (found.length > 1) {
    problems.push(`${found.length} open PRs now have the head ${branch}. Do not open another. Ask the user.`);
    return finish(null, false, []);
  }
  if (pr === null) {
    problems.push(create.code === 0 ? "gh pr create reported success, but no open PR shows for the branch" : "the branch is pushed and no PR exists");
    return finish(null, false, []);
  }
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
      problems.push("the PR is not a draft, but draft.create_as_draft is true; GitHub gives no way to convert it back here. Tell the user.");
    }
  }

  const labelsAdded = await addLabels(pr);
  return finish(pr, true, labelsAdded);
}
