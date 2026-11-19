// The refresh port of the fleet: pr-refresh `sync`, called as a library. The
// fleet reads the Outcome object of pr-refresh (state and code), never an exit
// code. It runs `sync` only. A refresh is never `dco-fix`: that mode force-pushes,
// and the fleet never plans it. A missing sign-off is a stopped action whose
// `next` names the mode for the user.

import { tmpdir } from "node:os";
import { loadContext, type RefreshDeps } from "../refresh/context.ts";
import { guardedGit } from "../refresh/gitx.ts";
import type { Outcome } from "../refresh/outcome.ts";
import { defaultStateRoot } from "../refresh/state.ts";
import { runSync } from "../refresh/sync.ts";
import type { MergeIo } from "../merge/types.ts";
import type { RepoSlug } from "../types.ts";
import type { RefreshPort, RefreshResult } from "./types.ts";

/** Map the outcome of `sync`. DONE is a refresh, also when the branch was already up to date. */
export function refreshResultOf(outcome: Outcome): RefreshResult {
  if (outcome.state === "DONE") {
    return { ok: true, note: outcome.headline };
  }
  const detail = outcome.details[0];
  return {
    ok: false,
    note: `pr-refresh sync stopped (${outcome.code}): ${outcome.headline}${detail === undefined ? "" : ` (${detail})`}`,
    next: outcome.next,
  };
}

/** The port over given refresh dependencies. */
export function refreshPortFor(repo: RepoSlug, deps: RefreshDeps): RefreshPort {
  return {
    sync: async (number, expectedHead) => {
      const loaded = await loadContext(deps, repo, number, true);
      if (!loaded.ok) {
        return refreshResultOf(loaded.outcome);
      }
      // The fleet planned this head. A head that moved is a new plan, not a refresh of another commit.
      if (loaded.ctx.snapshot.headSha !== expectedHead) {
        return { ok: false, note: `the head moved from ${expectedHead.slice(0, 7)} to ${loaded.ctx.snapshot.headSha.slice(0, 7)} since the plan; nothing was written`, next: "Run the plan again." };
      }
      return refreshResultOf(await runSync(deps, loaded.ctx, { freshCi: false, runCi: false, keepWorktree: false }));
    },
  };
}

/** The port that the command line uses: the user's checkout, the remote `origin`, a temporary worktree root. */
export function defaultRefreshPort(repo: RepoSlug, io: MergeIo, cwd: string): RefreshPort {
  return refreshPortFor(repo, {
    cwd,
    remote: "origin",
    worktreeRoot: tmpdir(),
    stateRoot: defaultStateRoot(),
    runGh: io.runGh,
    mutate: io.mutate,
    git: guardedGit,
    sleep: io.sleep,
  });
}
