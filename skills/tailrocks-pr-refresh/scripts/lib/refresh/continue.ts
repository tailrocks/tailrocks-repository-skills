// `refresh continue` and `refresh abort`: finish or drop a merge that
// `sync --keep-worktree` left in progress in a library worktree.

import { join } from "node:path";
import { type PrContext, type RefreshDeps } from "./context.ts";
import { writeRefusal } from "./gate.ts";
import { must, splitNul } from "./gitx.ts";
import { blocked, done, type Outcome } from "./outcome.ts";
import { hasConflictMarkers } from "./steps.ts";
import { entryFor, finishAndPush, guarded, regenerateConflicts, withNotes } from "./sync.ts";
import { openKeptWorktree, removeWorktree, type WorktreeOptions } from "./worktree.ts";

function options(deps: RefreshDeps, notes: string[]): WorktreeOptions {
  return { cwd: deps.cwd, root: deps.worktreeRoot, runner: deps.git, onProblem: (note) => notes.push(note) };
}

/** Drop the kept worktree. It checks the marker first, so it deletes nothing else. */
export function runAbort(deps: RefreshDeps, repo: string, number: number, worktree: string): Promise<Outcome> {
  return guarded(async () => {
    const notes: string[] = [];
    const opened = await openKeptWorktree(options(deps, notes), worktree, false);
    if (!opened.ok) {
      return blocked("worktree_invalid", opened.reason, "check the path that sync printed; nothing was deleted");
    }
    if (opened.marker.repo !== repo || opened.marker.number !== number) {
      return blocked("worktree_invalid", `the worktree was made for ${opened.marker.repo}#${opened.marker.number}, not ${repo}#${number}; nothing was deleted`, "use the path that sync printed for this PR");
    }
    const note = await removeWorktree(opened.handle.recorded, options(deps, notes));
    return withNotes(done("removed the kept worktree; nothing was pushed", [], { pushed: false }), note === null ? notes : [...notes, note]);
  });
}

/** Finish the merge in the kept worktree, run the checks, push once, and clean up. */
export function runContinue(deps: RefreshDeps, ctx: PrContext, worktree: string, runCi: boolean): Promise<Outcome> {
  return guarded(async () => {
    const notes: string[] = [];
    const opened = await openKeptWorktree(options(deps, notes), worktree, true);
    if (!opened.ok) {
      return blocked("worktree_invalid", opened.reason, "check the path that sync printed, or run abort; nothing was changed");
    }
    const { handle, marker } = opened;
    const { snapshot, policy } = ctx;
    if (marker.repo !== ctx.repo || marker.number !== ctx.number) {
      return blocked("worktree_invalid", `the worktree was made for ${marker.repo}#${marker.number}, not ${ctx.repo}#${ctx.number}`, "use the path that sync printed for this PR");
    }
    // From here the worktree stays when the problem is one that the agent can fix and retry.
    const keepOnFailure = (outcome: Outcome): Outcome => ({
      ...outcome,
      next: `${outcome.next}; then run continue ${ctx.number} --worktree ${handle.path} again`,
    });
    const discard = async (outcome: Outcome): Promise<Outcome> => {
      const note = await removeWorktree(handle.recorded, options(deps, notes));
      return withNotes(outcome, note === null ? notes : [...notes, note]);
    };
    if (snapshot.headSha !== marker.headSha) {
      return discard(
        blocked(
          "head_moved",
          `the PR head is now ${snapshot.headSha.slice(0, 7)}, not ${marker.headSha.slice(0, 7)}; the kept merge is out of date, so it was removed`,
          `run sync ${ctx.number} --keep-worktree again`,
        ),
      );
    }
    const refusal = writeRefusal(snapshot, policy, ctx.ghUser, { allowQueued: false });
    if (refusal !== null) {
      return discard(blocked(refusal.code, `${refusal.headline}; the kept merge was removed`, refusal.next));
    }
    const { repo } = handle;
    const mergeHead = await repo.run(["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
    const head = (await must(repo, ["rev-parse", "HEAD"])).trim();
    if (mergeHead.code !== 0 || mergeHead.stdout.trim() !== marker.baseSha || head !== marker.headSha) {
      return keepOnFailure(
        blocked(
          "merge_not_in_progress",
          "the merge is not in progress any more (do not run git commit or git merge --abort in the worktree)",
          `run abort ${ctx.number} --worktree ${handle.path}, then run sync ${ctx.number} --keep-worktree again`,
        ),
      );
    }

    const byHand = marker.conflicts.filter((path) => entryFor(ctx, path) === null);
    const generated = marker.conflicts.filter((path) => entryFor(ctx, path) !== null);
    const marked = byHand.filter((path) => hasConflictMarkers(join(handle.path, path)));
    if (marked.length > 0) {
      return keepOnFailure(
        blocked("conflict_markers", `${marked.length} resolved file(s) still hold conflict markers`, "remove the markers, keeping both sides", marked.map((p) => `markers: ${p}`)),
      );
    }
    const modified = splitNul(await must(repo, ["ls-files", "-z", "--modified"]));
    const stray = modified.filter((path) => !marker.conflicts.includes(path));
    if (stray.length > 0) {
      return keepOnFailure(
        blocked("continue_dirty", `${stray.length} file(s) outside the conflict set were edited`, "undo those edits; only the conflicted files may change", stray.map((p) => `edited: ${p}`)),
      );
    }

    const regenerated = await regenerateConflicts(repo, ctx, generated);
    if (!regenerated.ok) {
      return keepOnFailure(regenerated.outcome);
    }
    // Stage exactly the conflicted paths, and the outputs that the generators rewrote.
    await must(repo, ["add", "--", ...new Set([...byHand, ...regenerated.paths])]);
    const left = splitNul(await must(repo, ["diff", "--name-only", "-z", "--diff-filter=U"]));
    if (left.length > 0) {
      return keepOnFailure(blocked("conflict", "conflicts remain", "resolve them keeping both sides", left.map((p) => `conflict: ${p}`)));
    }
    await must(repo, ["commit", "--signoff", "--no-edit"]);

    const outcome = await finishAndPush(deps, ctx, handle, {
      upToDate: false,
      state: {
        cleanMergeCommit: null,
        regenerated: regenerated.names,
        notCleanBecause: "the merge needed a conflict resolution by hand",
      },
      oldHead: snapshot.headSha,
      runCi,
    });
    const removed = await discard(outcome);
    return outcome.state === "BLOCKED" && outcome.data["pushed"] !== true
      ? { ...removed, details: [...removed.details, `the resolved merge was discarded with the worktree; fix the cause, then run sync ${ctx.number} --keep-worktree again`] }
      : removed;
  });
}
