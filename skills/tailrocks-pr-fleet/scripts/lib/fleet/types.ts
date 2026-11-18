// Shared types of pr-fleet: exit codes, the plan, and the boundary to other skills.
//
// Exit codes. Each code has one meaning. Any other code means the script crashed.
//   0   done: `plan` printed the plan; `apply --apply` ran every planned action,
//       or nothing was planned
//   10  waiting: `apply --apply` stopped no action, but at least one action did not
//       run (pending: pr-refresh not available, or the pass deadline passed)
//   20  blocked: `apply --apply` ran, and at least one action was stopped by a
//       re-read (head moved, GitHub refused, a gate failed)
//   3   refused: freeze, a local policy file, or a second apply that holds the
//       lock. The refused actions wrote nothing. A freeze that starts during the
//       pass refuses the remaining actions; the earlier ones are listed as done
//   4   plan shown, nothing was written: `apply` without `--apply`
//   2   usage or policy error, or the GraphQL budget is too low

import type { Policy, PolicySource } from "../policy/types.ts";
import type { Owner, QueueState, VerdictState } from "../status/types.ts";
import type { RepoSlug, Sha } from "../types.ts";

export const EXIT = { done: 0, usage: 2, refused: 3, plan: 4, waiting: 10, blocked: 20 } as const;

/** Queue entries at positions 1 to this number are the head of the queue. */
export const QUEUE_HEAD = 5;

export type ActionKind = "dequeue" | "merge" | "refresh";

export interface Action {
  readonly kind: ActionKind;
  readonly number: number;
  /** The head the plan saw. A write runs only when the PR still has this head. */
  readonly headSha: Sha;
  readonly detail: string;
  /** A refresh that a direct merge made necessary during this pass. The plan never holds one. */
  readonly late: boolean;
  /** Set when the action cannot run in this build, for example "pending: pr-refresh not available". */
  readonly pending: string | null;
}

export interface QueueSlot {
  readonly position: number;
  readonly state: QueueState;
}

export interface Entry {
  readonly number: number;
  readonly author: string;
  readonly headRef: string;
  readonly baseRef: string;
  readonly headSha: Sha | null;
  readonly state: VerdictState;
  /** Who acts next: the owner of the first blocker, else of the first wait. */
  readonly owner: Owner;
  readonly next: string;
  /** Codes of every finding. */
  readonly codes: readonly string[];
  /** Codes of the blockers only. */
  readonly blockers: readonly string[];
  readonly isDraft: boolean;
  readonly isCrossRepository: boolean;
  readonly queue: QueueSlot | null;
  readonly behind: boolean;
  readonly approved: boolean;
  /** The head is a sync merge (or a fresh-CI commit) and its CI still runs. */
  readonly refreshing: boolean;
}

export interface Hygiene {
  readonly number: number;
  readonly position: number;
  readonly state: QueueState;
  readonly planned: boolean;
  readonly note: string | null;
}

export interface OrphanRun {
  readonly id: number;
  readonly branch: string;
  readonly workflow: string;
  readonly event: string;
}

export type MergeRoute = "queue" | "direct";

export interface OrphanRuns {
  readonly runs: readonly OrphanRun[];
  /** The list holds as many runs as the limit allows, so more may exist. */
  readonly truncated: boolean;
  /** Set when the runs could not be read. The report then says so. */
  readonly error: string | null;
}

export type FreezeSource = "policy" | "env";

export interface Plan {
  readonly schema: 1;
  readonly repo: RepoSlug;
  readonly defaultBranch: string;
  readonly policySource: PolicySource;
  readonly policySha: Sha;
  /** The policy came from a local file. The plan is advice, and apply refuses it. */
  readonly advisory: boolean;
  readonly frozen: FreezeSource | null;
  readonly open: number;
  readonly held: readonly number[];
  readonly ranking: readonly Entry[];
  readonly stockpile: {
    readonly readyNotQueued: readonly number[];
    readonly approvedBehind: readonly number[];
  };
  readonly queue: {
    /** Null when GitHub did not show the length. A queue of unknown length counts as congested. */
    readonly length: number | null;
    readonly congested: boolean;
    readonly head: readonly (QueueSlot & { readonly number: number })[];
  };
  readonly hygiene: readonly Hygiene[];
  readonly merge: {
    readonly route: MergeRoute;
    /** Merges or enqueues that this pass may start. */
    readonly cap: number;
    readonly candidates: readonly number[];
    readonly planned: readonly number[];
    /** READY PRs over the merge budget, in ranked order. */
    readonly deferred: readonly number[];
  };
  readonly refresh: {
    readonly budget: number;
    /** PRs whose refresh from an earlier pass still has CI running. They use up the budget. */
    readonly inFlight: readonly number[];
    readonly candidates: readonly number[];
    readonly planned: readonly number[];
    readonly deferred: readonly number[];
  };
  readonly orphanRuns: OrphanRuns;
  readonly actions: readonly Action[];
  readonly next: string;
}

/** Fleet-level facts that decide the plan. They come from the default-branch policy. */
export interface FleetPolicy {
  readonly policy: Policy;
  readonly source: PolicySource;
  readonly sha: Sha;
}

export type RefreshResult =
  | { readonly ok: true; readonly note: string }
  | { readonly ok: false; readonly note: string; readonly next: string };

/** The refresh library, as the fleet sees it. Absent until pr-refresh is on main. */
export interface RefreshPort {
  /** Run `sync` for one PR. The port counts as one refresh, even when it pushes nothing. */
  readonly sync: (number: number, expectedHead: Sha) => Promise<RefreshResult>;
}

export const PENDING_REFRESH = "pending: pr-refresh not available";

export type ResultKind = "done" | "skipped" | "pending" | "stopped" | "refused";

export interface ActionResult {
  readonly action: Action;
  readonly kind: ResultKind;
  readonly detail: string;
  readonly next: string;
}
