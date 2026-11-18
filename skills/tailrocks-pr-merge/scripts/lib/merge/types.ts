// Shared types of pr-merge: exit codes, the I/O boundary, and the step result.
//
// Exit codes. Each code has one meaning. Any other code means the script crashed.
//   0   merged, or the step is done (ready, dequeued, or nothing to do)
//   10  waiting: the PR is queued, or a check or a watch still runs
//   20  blocked: the state of the PR or of GitHub stops the step
//   3   refused: the call is not allowed; nothing was written
//   2   usage or policy error

import type { GhRun } from "../github/graphql.ts";
import type { RunResult } from "../proc.ts";
import type { GhMutation } from "../safety-gh.ts";
import type { Policy } from "../policy/types.ts";
import type { PolicyLoad } from "../status/run.ts";
import type { PrSnapshot, Verdict } from "../status/types.ts";
import type { RepoSlug, Sha } from "../types.ts";

export const EXIT = { done: 0, usage: 2, refused: 3, waiting: 10, blocked: 20 } as const;

export type Step = "ready" | "merge" | "dequeue" | "watch";

export type Outcome =
  | "ready"
  | "queued"
  | "merged"
  | "dequeued"
  | "nothing_to_do"
  | "plan"
  | "refused"
  | "waiting"
  | "blocked"
  | "ejected"
  | "closed"
  | "timeout"
  | "policy_error";

export interface StepResult {
  readonly exit: number;
  readonly outcome: Outcome;
  readonly headSha: Sha | null;
  readonly mergeCommit: Sha | null;
  /** The one next action for the agent or the user. */
  readonly next: string;
  readonly verdict: Verdict | null;
}

/** Everything a step reads and writes goes through this boundary. Tests inject a fake. */
export interface MergeIo {
  /** Guarded `gh` runner: reads, `pr merge`, `pr comment`, `pr diff`, `pr view`. */
  readonly runGh: GhRun;
  /** Runs one typed mutation. The argv comes from `ghMutationArgv`. */
  readonly mutate: (op: GhMutation) => Promise<RunResult>;
  readonly sleep: (ms: number) => Promise<void>;
  /** Milliseconds, monotonic enough for a deadline. */
  readonly now: () => number;
}

export interface Evaluated {
  readonly snapshot: PrSnapshot;
  readonly verdict: Verdict;
  readonly policy: Policy;
}

/** Caches that live for one run. All are keyed by commit, so they never go stale. */
export interface SharedState {
  readonly policies: Map<string, Promise<PolicyLoad>>;
  readonly fetchedBases: Set<string>;
  readonly gitQueue: { tail: Promise<unknown> };
}

export function newShared(): SharedState {
  return { policies: new Map(), fetchedBases: new Set(), gitQueue: { tail: Promise.resolve() } };
}

export interface StepContext {
  readonly repo: RepoSlug;
  readonly number: number;
  readonly cwd: string;
  /** A local clone for review carry-over. Absent: carry-over is unknown. */
  readonly gitDir: string | null;
  readonly io: MergeIo;
  readonly shared: SharedState;
  /** Progress lines. */
  readonly say: (line: string) => void;
  /** The user passed `--confirm <pr>`. Without it a step only prints its plan. */
  readonly confirmed: boolean;
  /** Test seam: a local policy. A verdict that uses it is refused. */
  readonly localPolicy?: Policy;
}

export function result(
  exit: number,
  outcome: Outcome,
  next: string,
  evaluated: Evaluated | null = null,
  extra: { readonly mergeCommit?: Sha | null } = {},
): StepResult {
  return {
    exit,
    outcome,
    headSha: evaluated?.snapshot.headSha ?? null,
    mergeCommit: extra.mergeCommit ?? null,
    next,
    verdict: evaluated?.verdict ?? null,
  };
}
