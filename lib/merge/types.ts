// Shared types of pr-merge: exit codes, the I/O boundary, and the step result.
//
// Exit codes. Each code has one meaning. Any other code means the script crashed.
//   0   merged, or the step is done (ready, dequeued, or nothing to do)
//   10  waiting: the PR is queued, a check or a watch still runs, or a watch was
//       stopped by a signal (the lock is removed, the PR was not judged)
//   20  blocked: the state of the PR or of GitHub stops the step
//   3   refused: the call is not allowed; do not retry; nothing was written
//   4   plan: the plan is shown and nothing was written; run again with --confirm
//   2   usage or policy error

import type { GhRun } from "../github/graphql.ts";
import type { RunResult } from "../proc.ts";
import type { GhMutation } from "../safety-gh.ts";
import type { Policy } from "../policy/types.ts";
import type { PolicyLoad } from "../status/run.ts";
import type { StopSignal } from "./signals.ts";
import type { PrSnapshot, Verdict } from "../status/types.ts";
import type { RepoSlug, Sha } from "../types.ts";

export const EXIT = { done: 0, usage: 2, refused: 3, plan: 4, waiting: 10, blocked: 20 } as const;

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
  | "stopped"
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
  /** Directory of the watch lock files. */
  readonly lockDir: string;
  /** Process id of this run, recorded in the watch lock. */
  readonly pid: number;
  /** True when a process exists. Used only to judge a stale watch lock. */
  readonly isAlive: (pid: number) => boolean;
  /** The start time of a process, or null when the platform does not show it. */
  readonly startOf: (pid: number) => string | null;
  /** Run the handler when the process gets SIGTERM, SIGINT, or SIGHUP. Returns a remover. */
  readonly onStopSignal: (handler: (signal: StopSignal) => void) => () => void;
  /** End the process. The watch uses it after a stop signal. */
  readonly exit: (code: number) => void;
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
  /**
   * Called by a stop-signal handler with the final result. The caller prints it (text or JSON),
   * removes the temporary files, and ends the process through `io.exit`.
   */
  readonly stop: (outcome: StepResult) => void;
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
