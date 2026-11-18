// `refresh sync`: merge the base branch into the PR branch, regenerate declared
// outputs, check inventories and sign-offs, run pre-push steps, and push once.
// Any failed check means no push. The push is a plain push of one exact SHA.
//
// `sync --keep-worktree` stops on a conflict that the policy cannot regenerate
// and leaves the merge in progress in the library worktree. The agent resolves
// the files, then `continue` finishes the merge (lib/refresh/continue.ts).

import { writeBodyFile, removeBodyFiles } from "../body-file.ts";
import { SafetyError } from "../guard.ts";
import { matchesAnyGlob } from "../glob.ts";
import type { PolicyRegenerateStep } from "../policy/types.ts";
import { scrub } from "../proc.ts";
import type { Sha } from "../types.ts";
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
import { withWorktree, type WorktreeHandle } from "./worktree.ts";

export interface SyncOptions {
  /** Add an empty signed commit when the branch is already up to date. */
  readonly freshCi: boolean;
  /** Add the run-once CI label after the push (label-triggered CI only). */
  readonly runCi: boolean;
  /** On a conflict that the policy cannot regenerate, keep the merge in progress and print the path. */
  readonly keepWorktree: boolean;
}

export function problemOutcome(problems: readonly StepProblem[]): Outcome {
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

export function withNotes(outcome: Outcome, notes: readonly string[]): Outcome {
  return notes.length === 0 ? outcome : { ...outcome, details: [...outcome.details, ...notes] };
}

export interface MergeState {
  /** The merge commit of a conflict-free merge. Null after a resolved conflict or when no merge ran. */
  readonly cleanMergeCommit: Sha | null;
  readonly regenerated: readonly string[];
  /** Why the merge is not clean, when it is not. */
  readonly notCleanBecause: string | null;
}

type MergeStep = { readonly ok: true; readonly state: MergeState } | { readonly ok: false; readonly outcome: Outcome };

async function abortMerge(repo: Repo): Promise<void> {
  await repo.run(["merge", "--abort"]);
}

export function entryFor(ctx: PrContext, path: string): PolicyRegenerateStep | null {
  return ctx.policy.regenerate.find((e) => matchesAnyGlob(e.outputs, path)) ?? null;
}

/**
 * Regenerate the conflicted outputs of each entry and stage them. Returns the
 * paths to add, or a blocking outcome.
 */
export async function regenerateConflicts(
  repo: Repo,
  ctx: PrContext,
  conflicted: readonly string[],
): Promise<{ readonly ok: true; readonly paths: readonly string[]; readonly names: readonly string[] } | { readonly ok: false; readonly outcome: Outcome }> {
  const entries = ctx.policy.regenerate.filter((e) => conflicted.some((path) => entryFor(ctx, path) === e));
  const staged: string[] = [];
  for (const entry of entries) {
    const paths = conflicted.filter((path) => entryFor(ctx, path) === entry);
    const result = await regenerateEntry(repo, entry, paths);
    if (result.problem !== null) {
      return { ok: false, outcome: problemOutcome([result.problem]) };
    }
    staged.push(...result.paths);
  }
  return { ok: true, paths: [...new Set(staged)], names: entries.map((e) => e.name) };
}

/** Resolve a conflicted merge only when every conflicted path is a regenerable output. */
async function resolveConflicts(
  handle: WorktreeHandle,
  ctx: PrContext,
  options: SyncOptions,
  deps: RefreshDeps,
  mergeError: string,
): Promise<MergeStep> {
  const { repo } = handle;
  const unmerged = splitNul(await must(repo, ["diff", "--name-only", "-z", "--diff-filter=U"]));
  if (unmerged.length === 0) {
    await abortMerge(repo);
    return {
      ok: false,
      outcome: blocked("merge_failed", "the merge of the base failed without a content conflict", "run pr-status, then try again", [mergeError]),
    };
  }
  const strays = unmerged.filter((path) => entryFor(ctx, path) === null);
  if (strays.length > 0) {
    const listing = unmerged.map((p) => `${strays.includes(p) ? "conflict" : "generated"}: ${p}`);
    if (options.keepWorktree) {
      const kept = handle.keep({
        repo: ctx.repo,
        number: ctx.number,
        remote: deps.remote,
        headRef: ctx.snapshot.headRef,
        headSha: ctx.snapshot.headSha,
        baseRef: ctx.snapshot.baseRef,
        baseSha: ctx.snapshot.baseSha,
        conflicts: unmerged,
      });
      return {
        ok: false,
        outcome: blocked(
          "conflict",
          `the merge of the base conflicts in ${strays.length} file(s) that are not regenerable outputs; the merge is in progress in ${handle.path}`,
          `edit only the "conflict:" files in ${handle.path}, keeping both sides, never the generated outputs and never run git commit; then run: refresh.ts continue ${ctx.number} --worktree ${handle.path} (or abort ${ctx.number} --worktree ${handle.path} to give up)`,
          [...listing, `state id: ${kept.id}`],
          { conflicts: unmerged, resolveByHand: strays, regenerable: unmerged.filter((p) => !strays.includes(p)), worktree: handle.path, id: kept.id },
        ),
      };
    }
    await abortMerge(repo);
    return {
      ok: false,
      outcome: blocked(
        "conflict",
        `the merge of the base conflicts in ${strays.length} file(s) that are not regenerable outputs; the merge was aborted`,
        `run sync ${ctx.number} --keep-worktree to resolve the conflict in a kept worktree, keeping both sides; never hand-merge generated files`,
        listing,
        { conflicts: unmerged, resolveByHand: strays },
      ),
    };
  }
  const regenerated = await regenerateConflicts(repo, ctx, unmerged);
  if (!regenerated.ok) {
    await abortMerge(repo);
    return regenerated;
  }
  await must(repo, ["add", "--", ...regenerated.paths]);
  const left = splitNul(await must(repo, ["diff", "--name-only", "-z", "--diff-filter=U"]));
  if (left.length > 0) {
    await abortMerge(repo);
    return { ok: false, outcome: blocked("conflict", "conflicts remain after the regeneration; the merge was aborted", "resolve keeping both sides", left) };
  }
  await must(repo, ["commit", "-s", "--no-edit"]);
  return {
    ok: true,
    state: { cleanMergeCommit: null, regenerated: regenerated.names, notCleanBecause: "the merge had conflicts in generated outputs, which were regenerated" },
  };
}

async function mergeBase(handle: WorktreeHandle, ctx: PrContext, base: Sha, options: SyncOptions, deps: RefreshDeps): Promise<MergeStep> {
  const merged = await handle.repo.run(["merge", "--signoff", "--no-ff", "--no-edit", base]);
  if (merged.code === 0) {
    return { ok: true, state: { cleanMergeCommit: await mustSha(handle.repo, ["rev-parse", "HEAD"]), regenerated: [], notCleanBecause: null } };
  }
  return resolveConflicts(handle, ctx, options, deps, merged.stderr.trim().split("\n")[0] ?? `exit ${merged.code}`);
}

/** After a merge: regenerate entries whose inputs changed, and commit changed outputs. */
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
  readonly notes: readonly string[];
  readonly failure: string | null;
}

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

/** Ask for a new review as the policy says. With no policy text, post a generic comment. */
async function requestReview(deps: RefreshDeps, ctx: PrContext, head: Sha, reason: string): Promise<ReviewRequest> {
  const { comment, reviewers } = ctx.policy.review.rerequest;
  const notes: string[] = [];
  if (comment === "" && reviewers.length === 0) {
    const text = `New head ${head} needs a review: ${reason}`;
    try {
      const file = writeBodyFile(text);
      const posted = await deps.runGh(["pr", "comment", String(ctx.number), "--repo", ctx.repo, "--body-file", file]);
      if (posted.code !== 0) {
        return { notes, failure: `the review request comment failed: ${posted.stderr.trim().split("\n")[0] ?? ""}` };
      }
    } finally {
      removeBodyFiles();
    }
    return { notes: [`policy review.rerequest is empty, so the script posted this comment: "${text}"`], failure: null };
  }
  if (comment !== "") {
    const posted = await deps.mutate({ kind: "issue-comment", repo: ctx.repo, number: ctx.number, body: comment });
    if (posted.code !== 0) {
      return { notes, failure: `the re-review comment failed: ${posted.stderr.trim().split("\n")[0] ?? ""}` };
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
      return { notes, failure: `the review request failed: ${requested.stderr.trim().split("\n")[0] ?? ""}` };
    }
    notes.push(`requested a review from ${reviewers.filter((l) => LOGIN.test(l)).join(", ")}`);
  }
  return { notes, failure: null };
}

/** Run a mode body. Never throws: a failure is a blocked outcome. */
export async function guarded(body: () => Promise<Outcome>): Promise<Outcome> {
  try {
    return await body();
  } catch (error) {
    const reason = error instanceof Error ? scrub(error.message) : "failed";
    const code = error instanceof SafetyError ? "safety_refused" : error instanceof GitFailure ? "git_failed" : "failed";
    return blocked(code, `${reason}; nothing was pushed unless the report says so`, "run pr-status, then try again");
  }
}

export function runSync(deps: RefreshDeps, ctx: PrContext, options: SyncOptions): Promise<Outcome> {
  return guarded(() => sync(deps, ctx, options));
}

export interface FinishInput {
  readonly upToDate: boolean;
  readonly state: MergeState;
  readonly oldHead: Sha;
  readonly runCi: boolean;
}

/**
 * Everything after the merge: regenerate, inventories, sign-off scan, pre-push
 * steps, the second read of the PR, one plain push, and the re-review request.
 * `continue` shares this tail.
 */
export async function finishAndPush(deps: RefreshDeps, ctx: PrContext, handle: WorktreeHandle, input: FinishInput): Promise<Outcome> {
  const { repo } = handle;
  const { snapshot, policy } = ctx;
  const { baseSha: base } = snapshot;
  const { oldHead, state, upToDate } = input;

  const changed = await changedFiles(repo, base, oldHead);
  const regenerated = await regenerateAfterMerge(repo, ctx, changed, state.regenerated);
  if (regenerated.problem !== null) {
    return problemOutcome([regenerated.problem]);
  }
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
  // Fix the SHA before the policy steps run. Those steps, and the PR code that
  // they run, can write anywhere in the worktree, `.git` included.
  const newHead = await mustSha(repo, ["rev-parse", "HEAD"]);
  const prepush = await runPrepush(repo, policy.prepush, changed);
  if (prepush !== null) {
    return problemOutcome([prepush]);
  }
  if (!(await handle.intact()) || (await mustSha(repo, ["rev-parse", "HEAD"])) !== newHead) {
    return blocked(
      "worktree_tampered",
      "a policy step changed the worktree git data or the head; nothing was pushed",
      "check the policy steps of the base branch",
    );
  }

  const merge = state.cleanMergeCommit;
  const extraCommit = regenerated.committed;
  const clean =
    (upToDate && !extraCommit) || (merge !== null && !extraCommit && newHead === merge && (await isCleanMerge(repo, oldHead, base, merge)));
  const reason =
    state.notCleanBecause ??
    (extraCommit ? "a regenerate commit changed generated files that no reviewer saw" : "the merge is not a clean merge of the base");

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

  const allRegenerated = [...state.regenerated, ...regenerated.regenerated];
  const details: string[] = [`pushed ${newHead.slice(0, 7)} (was ${oldHead.slice(0, 7)})`];
  if (allRegenerated.length > 0) {
    details.push(`regenerated: ${allRegenerated.join(", ")}`);
  }
  let review: ReviewRequest | null = null;
  if (!clean) {
    review = await requestReview(deps, ctx, newHead, reason);
    details.push(...review.notes);
  }
  if (input.runCi && policy.labels.pr_ci === "label" && policy.labels.run_once !== "") {
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
    regenerated: allRegenerated,
    reReview: clean ? "not-needed" : "requested",
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
  return done(
    clean ? `pushed ${newHead.slice(0, 7)}; the merge was clean, so no new review is needed` : `pushed ${newHead.slice(0, 7)}; a new review was requested`,
    details,
    data,
    clean ? "none" : `a new review of ${newHead.slice(0, 7)} is needed; run pr-status`,
  );
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

  const notes: string[] = [];
  const outcome = await withWorktree(
    { cwd: deps.cwd, root: deps.worktreeRoot, runner: deps.git, stateRoot: deps.stateRoot, onProblem: (note) => notes.push(note) },
    snapshot.headSha,
    async (handle) => {
      const { repo } = handle;
      const { baseSha: base, headSha: oldHead } = snapshot;
      const upToDate = await yesNo(repo, ["merge-base", "--is-ancestor", base, "HEAD"]);
      let state: MergeState = { cleanMergeCommit: null, regenerated: [], notCleanBecause: null };
      if (!upToDate) {
        const merged = await mergeBase(handle, ctx, base, options, deps);
        if (!merged.ok) {
          return merged.outcome;
        }
        state = merged.state;
      } else if (options.freshCi) {
        await must(repo, ["commit", "--allow-empty", "-s", "-m", "Start a fresh CI run"]);
      } else {
        return done("the branch already contains the base; nothing to merge or push", [`head ${oldHead.slice(0, 7)}`], { pushed: false, head: oldHead });
      }
      return finishAndPush(deps, ctx, handle, { upToDate, state, oldHead, runCi: options.runCi });
    },
  );
  return withNotes(outcome, notes);
}
