// `refresh continue` and `refresh abort`: finish or drop a merge that
// `sync --keep-worktree` left in progress in a library worktree.

import { join } from "node:path";
import { type PrContext, type RefreshDeps } from "./context.ts";
import { writeRefusal } from "./gate.ts";
import { GitFailure, must, repoAt, splitNul, type Repo } from "./gitx.ts";
import { blocked, done, type Outcome } from "./outcome.ts";
import { hasConflictMarkers } from "./steps.ts";
import { entryFor, finishAndPush, guarded, regenerateConflicts, withNotes } from "./sync.ts";
import { openKeptWorktree, removeWorktree, type WorktreeOptions } from "./worktree.ts";

function options(deps: RefreshDeps, notes: string[]): WorktreeOptions {
  return { cwd: deps.cwd, root: deps.worktreeRoot, runner: deps.git, stateRoot: deps.stateRoot, onProblem: (note) => notes.push(note) };
}

/** Drop the kept worktree. It checks the marker first, so it deletes nothing else. */
export function runAbort(deps: RefreshDeps, repo: string, number: number, worktree: string): Promise<Outcome> {
  return guarded(async () => {
    const notes: string[] = [];
    const opened = await openKeptWorktree(options(deps, notes), worktree, false);
    if (!opened.ok) {
      return blocked("worktree_invalid", opened.reason, "check the path that sync printed; nothing was deleted");
    }
    if (opened.state.repo !== repo || opened.state.number !== number) {
      return blocked("worktree_invalid", `the worktree was made for ${opened.state.repo}#${opened.state.number}, not ${repo}#${number}; nothing was deleted`, "use the path that sync printed for this PR");
    }
    const note = await removeWorktree(opened.handle.recorded, options(deps, notes));
    return withNotes(done("removed the kept worktree; nothing was pushed", [], { pushed: false }), note === null ? notes : [...notes, note]);
  });
}

/**
 * Paths where the staged tree, the work tree, or the untracked files differ from
 * the auto-merge of the two recorded commits, except the allowed paths. The
 * allowed set comes from the state that the library wrote, never from a file in
 * the worktree.
 */
async function editsOutside(repo: Repo, head: string, base: string, allowed: ReadonlySet<string>): Promise<readonly string[]> {
  // `merge-tree` exits 1 on conflicts and still prints the tree of the auto-merge on the first line.
  const merged = await repo.run(["merge-tree", "--write-tree", head, base]);
  const tree = merged.stdout.split("\n")[0]?.trim() ?? "";
  if ((merged.code !== 0 && merged.code !== 1) || !/^[0-9a-f]{40}$/.test(tree)) {
    throw new GitFailure("cannot compute the auto-merge tree of the recorded commits");
  }
  const staged = splitNul(await must(repo, ["diff", "--cached", "--name-only", "--no-renames", "-z", tree]));
  const unstaged = splitNul(await must(repo, ["diff", "--name-only", "--no-renames", "-z"]));
  const untracked = splitNul(await must(repo, ["ls-files", "-z", "--others", "--exclude-standard"]));
  return [...new Set([...staged, ...unstaged, ...untracked])].filter((path) => !allowed.has(path)).sort();
}

/** Finish the merge in the kept worktree, run the checks, push once, and clean up. */
export function runContinue(deps: RefreshDeps, ctx: PrContext, worktree: string, runCi: boolean): Promise<Outcome> {
  return guarded(async () => {
    const notes: string[] = [];
    const opened = await openKeptWorktree(options(deps, notes), worktree, true);
    if (!opened.ok) {
      return blocked("worktree_invalid", opened.reason, "check the path that sync printed, or run abort; nothing was changed");
    }
    const { handle, state: marker } = opened;
    const { snapshot, policy } = ctx;
    if (marker.repo !== ctx.repo || marker.number !== ctx.number) {
      return blocked("worktree_invalid", `the worktree was made for ${marker.repo}#${marker.number}, not ${ctx.repo}#${ctx.number}`, "use the path that sync printed for this PR");
    }
    // From here the worktree stays when the problem is one that the agent can fix and retry.
    const keepOnFailure = (outcome: Outcome): Outcome => ({
      ...outcome,
      next: `${outcome.next}; then run continue ${ctx.number} --worktree ${handle.path} again`,
    });
    // The merge itself is gone: only abort and a new sync help.
    const keepForAbort = (outcome: Outcome): Outcome => outcome;
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
    // The kept merge holds the base that the state names. If the base moved, the checks would
    // run against a base that the merge does not contain.
    const origin = repoAt(deps.cwd, deps.git);
    const fetched = await origin.run(["fetch", "--no-tags", "--quiet", deps.remote, marker.baseRef]);
    const tip = fetched.code === 0 ? (await origin.run(["rev-parse", `${deps.remote}/${marker.baseRef}^{commit}`])).stdout.trim() : "";
    if (fetched.code !== 0 || tip !== marker.baseSha || snapshot.baseSha !== marker.baseSha) {
      return blocked(
        fetched.code !== 0 ? "fetch_failed" : "base_moved",
        fetched.code !== 0
          ? `cannot fetch the base from ${deps.remote}: ${fetched.stderr.trim().split("\n")[0] ?? ""}`
          : `the base branch moved from ${marker.baseSha.slice(0, 7)} to ${(snapshot.baseSha !== marker.baseSha ? snapshot.baseSha : tip).slice(0, 7)} since sync; the kept merge is out of date`,
        `abort ${ctx.number} --worktree ${handle.path}, then run sync ${ctx.number} --keep-worktree again`,
      );
    }
    const mergeHead = await repo.run(["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
    const head = (await must(repo, ["rev-parse", "HEAD"])).trim();
    if (mergeHead.code !== 0 || mergeHead.stdout.trim() !== marker.baseSha || head !== marker.headSha) {
      return keepForAbort(
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
    // Before any generator runs, only the recorded conflict set may differ from the plain
    // auto-merge. A hand-made file under an output glob is refused here.
    const early = await editsOutside(repo, marker.headSha, marker.baseSha, new Set(marker.conflicts));
    if (early.length > 0) {
      return keepOnFailure(
        blocked(
          "continue_outside_edit",
          `${early.length} path(s) outside the conflict set differ from the plain merge; nothing was committed`,
          "undo those edits (an edit that was staged needs abort and a new sync)",
          early.map((p) => `outside: ${p}`),
        ),
      );
    }
    const regenerated = await regenerateConflicts(repo, ctx, generated);
    if (!regenerated.ok) {
      return keepOnFailure(regenerated.outcome);
    }
    // Stage exactly the conflicted paths, and the outputs that the generators rewrote.
    const allowed = new Set([...byHand, ...generated, ...regenerated.paths]);
    await must(repo, ["add", "--", ...allowed]);
    const left = splitNul(await must(repo, ["diff", "--name-only", "-z", "--diff-filter=U"]));
    if (left.length > 0) {
      return keepOnFailure(blocked("conflict", "conflicts remain", "resolve them keeping both sides", left.map((p) => `conflict: ${p}`)));
    }
    // Only the recorded conflict paths (and regenerated outputs) may differ from the plain auto-merge.
    const outside = await editsOutside(repo, marker.headSha, marker.baseSha, allowed);
    if (outside.length > 0) {
      return keepOnFailure(
        blocked(
          "continue_outside_edit",
          `${outside.length} path(s) outside the conflict set differ from the plain merge; nothing was committed`,
          "undo those edits (an edit that was staged needs abort and a new sync)",
          outside.map((p) => `outside: ${p}`),
        ),
      );
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
