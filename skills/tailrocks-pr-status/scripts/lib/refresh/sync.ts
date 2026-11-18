// `refresh sync`: merge the base branch into the PR branch, regenerate declared
// outputs, check inventories and sign-offs, run pre-push steps, and push once.
// Any failed check means no push. The push is a plain push of one exact SHA.

import { matchesAnyGlob } from "../glob.ts";
import { scrub } from "../proc.ts";
import type { PolicyRegenerateStep } from "../policy/types.ts";
import type { Sha } from "../types.ts";
import { SafetyError } from "../guard.ts";
import { confirmHead, reread, type PrContext, type RefreshDeps } from "./context.ts";
import { writeRefusal } from "./gate.ts";
import { GitFailure, must, mustSha, repoAt, splitNul, yesNo, type Repo } from "./gitx.ts";
import { blocked, done, type JsonValue, type Outcome } from "./outcome.ts";
import {
  changedFiles,
  checkInventories,
  matchesWhenChanged,
  regenerateEntry,
  runPrepush,
  unsignedCommits,
  type StepProblem,
} from "./steps.ts";
import { withWorktree } from "./worktree.ts";

export interface SyncOptions {
  /** Add an empty signed commit when the branch is already up to date. */
  readonly freshCi: boolean;
  /** Add the run-once CI label after the push (label-triggered CI only). */
  readonly runCi: boolean;
}

function problemOutcome(problems: readonly StepProblem[]): Outcome {
  const [first] = problems;
  if (first === undefined) {
    return blocked("unknown_state", "a step failed without a reason", "run the mode again");
  }
  return blocked(
    first.code,
    problems.length === 1 ? first.headline : `${first.headline} (and ${problems.length - 1} more problem(s))`,
    first.next,
    problems.flatMap((p) => [p.headline, ...p.details.map((d) => `  ${d}`)]),
  );
}

interface MergeState {
  /** The merge commit of a conflict-free merge. Null after a resolved conflict or when no merge ran. */
  readonly cleanMergeCommit: Sha | null;
  readonly regenerated: readonly string[];
}

type MergeStep = { readonly ok: true; readonly state: MergeState } | { readonly ok: false; readonly outcome: Outcome };

async function abortMerge(repo: Repo): Promise<void> {
  await repo.run(["merge", "--abort"]);
}

/** Resolve a conflicted merge only when every conflicted path is a regenerable output. */
async function resolveConflicts(repo: Repo, ctx: PrContext, mergeError: string): Promise<MergeStep> {
  const unmerged = splitNul(await must(repo, ["diff", "--name-only", "-z", "--diff-filter=U"]));
  if (unmerged.length === 0) {
    await abortMerge(repo);
    return {
      ok: false,
      outcome: blocked("merge_failed", "the merge of the base failed without a content conflict", "run pr-status, then try again", [mergeError]),
    };
  }
  const owners = unmerged.map((path) => ({
    path,
    entry: ctx.policy.regenerate.find((e) => matchesAnyGlob(e.outputs, path)) ?? null,
  }));
  const strays = owners.filter((o) => o.entry === null).map((o) => o.path);
  if (strays.length > 0) {
    await abortMerge(repo);
    return {
      ok: false,
      outcome: blocked(
        "conflict",
        `the merge of the base conflicts in ${strays.length} file(s) that are not regenerable outputs; the merge was aborted`,
        "resolve keeping both sides; never hand-merge generated files",
        unmerged.map((p) => `${strays.includes(p) ? "conflict" : "generated"}: ${p}`),
        { conflicts: unmerged },
      ),
    };
  }
  const entries: PolicyRegenerateStep[] = ctx.policy.regenerate.filter((e) => owners.some((o) => o.entry === e));
  const staged: string[] = [];
  for (const entry of entries) {
    const paths = owners.filter((o) => o.entry === entry).map((o) => o.path);
    const result = await regenerateEntry(repo, entry, paths);
    if (result.problem !== null) {
      await abortMerge(repo);
      return { ok: false, outcome: problemOutcome([result.problem]) };
    }
    staged.push(...result.paths);
  }
  await must(repo, ["add", "--", ...new Set(staged)]);
  const left = splitNul(await must(repo, ["diff", "--name-only", "-z", "--diff-filter=U"]));
  if (left.length > 0) {
    await abortMerge(repo);
    return { ok: false, outcome: blocked("conflict", "conflicts remain after the regeneration; the merge was aborted", "resolve keeping both sides", left) };
  }
  await must(repo, ["commit", "-s", "--no-edit"]);
  return { ok: true, state: { cleanMergeCommit: null, regenerated: entries.map((e) => e.name) } };
}

async function mergeBase(repo: Repo, ctx: PrContext, base: Sha): Promise<MergeStep> {
  const merged = await repo.run(["merge", "--signoff", "--no-ff", "--no-edit", base]);
  if (merged.code === 0) {
    return { ok: true, state: { cleanMergeCommit: await mustSha(repo, ["rev-parse", "HEAD"]), regenerated: [] } };
  }
  return resolveConflicts(repo, ctx, merged.stderr.trim().split("\n")[0] ?? `exit ${merged.code}`);
}

/** After a clean merge: regenerate entries whose inputs changed, and commit changed outputs. */
async function regenerateAfterMerge(
  repo: Repo,
  ctx: PrContext,
  changed: readonly string[],
  already: readonly string[],
): Promise<{ readonly problem: StepProblem | null; readonly regenerated: readonly string[]; readonly committed: boolean }> {
  const regenerated: string[] = [];
  let committed = false;
  for (const entry of ctx.policy.regenerate) {
    if (already.includes(entry.name) || entry.when_changed.length === 0 || !matchesWhenChanged(entry.when_changed, changed)) {
      continue;
    }
    const result = await regenerateEntry(repo, entry, []);
    if (result.problem !== null) {
      return { problem: result.problem, regenerated, committed };
    }
    regenerated.push(entry.name);
    if (result.paths.length > 0) {
      await must(repo, ["add", "--", ...result.paths]);
      await must(repo, ["commit", "-s", "-m", `Regenerate ${entry.name} outputs`]);
      committed = true;
    }
  }
  return { problem: null, regenerated, committed };
}

/** True when the merge equals a clean `git merge-tree` of the old head and the base. */
async function isCleanMerge(repo: Repo, oldHead: Sha, base: Sha, mergeCommit: Sha): Promise<boolean> {
  const result = await repo.run(["merge-tree", "--write-tree", oldHead, base]);
  if (result.code !== 0) {
    return false;
  }
  const expected = result.stdout.trim().split("\n")[0] ?? "";
  return expected === (await must(repo, ["rev-parse", `${mergeCommit}^{tree}`])).trim();
}

interface ReviewRequest {
  readonly state: "requested" | "manual";
  readonly notes: readonly string[];
  readonly failure: string | null;
}

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

async function requestReview(deps: RefreshDeps, ctx: PrContext, head: Sha): Promise<ReviewRequest> {
  const { comment, reviewers } = ctx.policy.review.rerequest;
  const notes: string[] = [];
  if (comment === "" && reviewers.length === 0) {
    return { state: "manual", notes: ["policy review.rerequest is empty"], failure: null };
  }
  if (comment !== "") {
    const posted = await deps.mutate({ kind: "issue-comment", repo: ctx.repo, number: ctx.number, body: comment });
    if (posted.code !== 0) {
      return { state: "manual", notes, failure: `the re-review comment failed: ${posted.stderr.trim().split("\n")[0] ?? ""}` };
    }
    notes.push(`commented on the PR to ask for a review of ${head.slice(0, 7)}`);
  }
  const ids: string[] = [];
  for (const login of reviewers) {
    if (!LOGIN.test(login)) {
      notes.push(`cannot request a review from "${login}" by id; ask by hand`);
      continue;
    }
    const lookup = await deps.runGh(["api", `users/${login}`, "--jq", ".node_id"]);
    const id = lookup.stdout.trim();
    if (lookup.code === 0 && id !== "") {
      ids.push(id);
    } else {
      notes.push(`cannot look up reviewer ${login}`);
    }
  }
  if (ids.length > 0) {
    const requested = await deps.mutate({ kind: "requestReviews", pullRequestId: ctx.snapshot.nodeId, userIds: ids });
    if (requested.code !== 0) {
      return { state: "manual", notes, failure: `the review request failed: ${requested.stderr.trim().split("\n")[0] ?? ""}` };
    }
    notes.push(`requested a review from ${reviewers.filter((l) => LOGIN.test(l)).join(", ")}`);
  }
  return { state: "requested", notes, failure: null };
}

/** Run the sync mode. Never throws: a failure is a blocked outcome. */
export async function runSync(deps: RefreshDeps, ctx: PrContext, options: SyncOptions): Promise<Outcome> {
  try {
    return await sync(deps, ctx, options);
  } catch (error) {
    const reason = error instanceof Error ? scrub(error.message) : "failed";
    const code = error instanceof SafetyError ? "safety_refused" : error instanceof GitFailure ? "git_failed" : "failed";
    return blocked(code, `${reason}; nothing was pushed unless the report says so`, "run pr-status, then try again");
  }
}

async function sync(deps: RefreshDeps, ctx: PrContext, options: SyncOptions): Promise<Outcome> {
  const { snapshot, policy } = ctx;
  const refusal = writeRefusal(snapshot, policy, ctx.ghUser, { allowQueued: false });
  if (refusal !== null) {
    return blocked(refusal.code, refusal.headline, refusal.next);
  }
  const origin = repoAt(deps.cwd, deps.git);
  const fetched = await origin.run(["fetch", "--no-tags", "--quiet", deps.remote, snapshot.headRef, snapshot.baseRef]);
  if (fetched.code !== 0) {
    return blocked("fetch_failed", `cannot fetch from ${deps.remote}: ${fetched.stderr.trim().split("\n")[0] ?? ""}`, "check the remote, then run the mode again");
  }
  const remoteHead = await mustSha(origin, ["rev-parse", `${deps.remote}/${snapshot.headRef}^{commit}`]);
  if (remoteHead !== snapshot.headSha) {
    return blocked("head_moved", `the remote branch is at ${remoteHead.slice(0, 7)}, not ${snapshot.headSha.slice(0, 7)}; nothing was written`, "run the mode again");
  }
  if (!(await yesNo(origin, ["cat-file", "-e", `${snapshot.baseSha}^{commit}`]))) {
    return blocked("base_missing", "the base commit is not in the local clone after the fetch", "run pr-status, then try again");
  }

  return withWorktree({ cwd: deps.cwd, root: deps.worktreeRoot, runner: deps.git }, snapshot.headSha, async ({ repo }) => {
    const { baseSha: base, headSha: oldHead } = snapshot;
    const upToDate = await yesNo(repo, ["merge-base", "--is-ancestor", base, "HEAD"]);
    let state: MergeState = { cleanMergeCommit: null, regenerated: [] };
    let extraCommit = false;
    if (!upToDate) {
      const merged = await mergeBase(repo, ctx, base);
      if (!merged.ok) {
        return merged.outcome;
      }
      state = merged.state;
    } else if (options.freshCi) {
      await must(repo, ["commit", "--allow-empty", "-s", "-m", "Start a fresh CI run"]);
    } else {
      return done("the branch already contains the base; nothing to merge or push", [`head ${oldHead.slice(0, 7)}`], { pushed: false, head: oldHead });
    }

    const changed = await changedFiles(repo, base, oldHead);
    const regenerated = await regenerateAfterMerge(repo, ctx, changed, state.regenerated);
    if (regenerated.problem !== null) {
      return problemOutcome([regenerated.problem]);
    }
    extraCommit = regenerated.committed;

    const inventoryProblems = await checkInventories(repo, policy, base);
    if (inventoryProblems.length > 0) {
      return problemOutcome(inventoryProblems);
    }
    const unsigned = await unsignedCommits(repo, policy, snapshot, base);
    if (unsigned.length > 0) {
      return problemOutcome([
        {
          code: "dco_missing",
          headline: `${unsigned.length} commit(s) have no Signed-off-by trailer`,
          next: "run pr-refresh dco-fix, then run sync again",
          details: unsigned.map((s) => s.slice(0, 12)),
        },
      ]);
    }
    const prepush = await runPrepush(repo, policy.prepush, changed);
    if (prepush !== null) {
      return problemOutcome([prepush]);
    }

    const newHead = await mustSha(repo, ["rev-parse", "HEAD"]);
    const merge = state.cleanMergeCommit;
    const clean =
      upToDate || (merge !== null && !extraCommit && newHead === merge && (await isCleanMerge(repo, oldHead, base, merge)));

    // Write: read the PR again, then push the exact SHA once.
    await deps.beforePush?.();
    const again = await reread(deps, ctx, oldHead, false);
    if (!again.ok) {
      return again.outcome;
    }
    const pushed = await repo.run(["push", deps.remote, `${newHead}:refs/heads/${snapshot.headRef}`]);
    if (pushed.code !== 0) {
      return blocked(
        "push_rejected",
        `the push was rejected: ${pushed.stderr.trim().split("\n")[0] ?? ""}; nothing changed on the remote`,
        "run the mode again",
      );
    }

    const details: string[] = [`pushed ${newHead.slice(0, 7)} (was ${oldHead.slice(0, 7)})`];
    if (regenerated.regenerated.length + state.regenerated.length > 0) {
      details.push(`regenerated: ${[...state.regenerated, ...regenerated.regenerated].join(", ")}`);
    }
    let review: ReviewRequest | null = null;
    if (!clean) {
      review = await requestReview(deps, ctx, newHead);
      details.push(...review.notes);
    }
    if (options.runCi && policy.labels.pr_ci === "label" && policy.labels.run_once !== "") {
      const labelled = await deps.runGh(["pr", "edit", String(ctx.number), "--repo", ctx.repo, "--add-label", policy.labels.run_once]);
      details.push(
        labelled.code === 0
          ? `added the label ${policy.labels.run_once}`
          : `could not add the label ${policy.labels.run_once}: ${labelled.stderr.trim().split("\n")[0] ?? ""}`,
      );
    }
    const lag = await confirmHead(deps, ctx, newHead);
    if (lag !== null) {
      details.push(lag);
    }
    const data: Record<string, JsonValue> = {
      pushed: true,
      oldHead,
      newHead,
      cleanMerge: clean,
      merged: !upToDate,
      regenerated: [...state.regenerated, ...regenerated.regenerated],
      reReview: clean ? "not-needed" : (review?.state ?? "manual"),
    };
    if (review?.failure !== null && review?.failure !== undefined) {
      return blocked(
        "rereview_failed",
        `pushed ${newHead.slice(0, 7)}, but the re-review request failed: ${review.failure}`,
        `request a new review of ${newHead.slice(0, 7)} by hand`,
        details,
        data,
      );
    }
    if (!clean && review?.state === "manual") {
      return done(
        `pushed ${newHead.slice(0, 7)}; the merge was not clean, so the old review no longer holds`,
        details,
        data,
        `request a new review of ${newHead.slice(0, 7)} (the policy has no re-request text)`,
      );
    }
    return done(
      clean ? `pushed ${newHead.slice(0, 7)}; the merge was clean, so no new review is needed` : `pushed ${newHead.slice(0, 7)}; a new review was requested`,
      details,
      data,
    );
  });
}
