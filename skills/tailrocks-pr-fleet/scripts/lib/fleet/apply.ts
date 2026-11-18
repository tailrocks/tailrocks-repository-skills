// Run the plan. The fleet writes only through the library functions of the
// other skills: dequeue and merge from pr-merge, sync from pr-refresh. Right
// before each action it reads the PR again, and it checks freeze and hold in
// the policy of that read. It never starts more merges or refreshes than the
// budgets allow, and only one apply runs at a time.

import { dequeueWrite } from "../merge/dequeue.ts";
import { evaluateFresh } from "../merge/evaluate.ts";
import { scopeCheck } from "../merge/common.ts";
import { acquireWatchLock } from "../merge/lock.ts";
import { mergeStep } from "../merge/merge.ts";
import { EXIT as MERGE_EXIT, type Evaluated, type StepContext } from "../merge/types.ts";
import type { RepoSlug } from "../types.ts";
import {
  baseMergeCap,
  entryOf,
  isBehindReady,
  isMergeCandidate,
  isRefreshCandidate,
  queueLength,
  queueRoom,
  refreshBudget,
  type Read,
} from "./analyze.ts";
import type { FleetDeps } from "./plan.ts";
import {
  EXIT,
  PENDING_REFRESH,
  QUEUE_HEAD,
  type Action,
  type ActionResult,
  type Entry,
  type Plan,
} from "./types.ts";

export const LOCK_PREFIX = "pr-fleet-apply";
/** A second apply is refused while the first holds the lock. A lock this old is stale. */
export const LOCK_SECONDS = 3600;
/** The pass stops before the lock can go stale: the holder never outlives its lock. */
export const DEADLINE_SECONDS = 1800;

/** Full PR reads that one action makes, for the GraphQL estimate. A refresh is an upper bound: the port reads too. */
const READS_PER_ACTION = { dequeue: 3, merge: 4, refresh: 6 } as const;

export function estimatedReads(actions: readonly Action[]): number {
  return actions.reduce((sum, action) => sum + READS_PER_ACTION[action.kind], 0);
}

function contextFor(deps: FleetDeps, repo: RepoSlug, number: number, lines: string[]): StepContext {
  return {
    repo,
    number,
    cwd: deps.cwd,
    gitDir: deps.gitDir,
    io: deps.io,
    shared: deps.shared,
    say: (line) => void lines.push(line),
    // The fleet never runs the watch step, so no stop signal handler calls this. Still, end the run when one does.
    stop: (outcome) => deps.io.exit(outcome.exit),
    confirmed: true,
  };
}

function result(action: Action, kind: ActionResult["kind"], detail: string, next: string): ActionResult {
  return { action, kind, detail, next };
}

const NONE = "None.";
const MOVED = "the head moved since the plan; nothing was written";

/** The PR as the plan logic reads it, built from a fresh read. */
function readOf({ snapshot, verdict }: Evaluated): Read {
  return {
    pr: {
      number: snapshot.number,
      headRef: snapshot.headRef,
      headSha: snapshot.headSha,
      baseRef: snapshot.baseRef,
      baseSha: snapshot.baseSha,
      author: snapshot.author,
      isDraft: snapshot.isDraft,
      isCrossRepository: snapshot.isCrossRepository,
    },
    verdict,
    snapshot,
  };
}

const freshEntry = (evaluated: Evaluated): Entry => entryOf(readOf(evaluated), evaluated.policy);

function summary(lines: readonly string[], fallback: string): string {
  return lines.length === 0 ? fallback : lines.join("; ");
}

/** The environment switch, read again for each action. */
function envFreeze(deps: FleetDeps): boolean {
  return deps.env["PR_FLEET_FREEZE"] === "1";
}

const FROZEN_ENV = "freeze is on (environment PR_FLEET_FREEZE=1)";
const FROZEN_POLICY = "freeze is on (policy fleet.freeze)";

/**
 * Freeze and hold, from the policy of the read that came right before the
 * write. A freeze refuses the action. A held PR is skipped.
 */
function writeGuard(deps: FleetDeps, evaluated: Evaluated, action: Action): ActionResult | null {
  if (envFreeze(deps)) {
    return result(action, "refused", FROZEN_ENV, NONE);
  }
  if (evaluated.policy.fleet.freeze) {
    return result(action, "refused", FROZEN_POLICY, NONE);
  }
  if (evaluated.policy.fleet.hold.includes(action.number)) {
    return result(action, "skipped", "held by the policy (fleet.hold)", NONE);
  }
  return null;
}

async function runDequeue(deps: FleetDeps, plan: Plan, action: Action): Promise<ActionResult> {
  const lines: string[] = [];
  const ctx = contextFor(deps, plan.repo, action.number, lines);
  const fresh = await evaluateFresh(ctx);
  if (!fresh.ok) {
    return result(action, "stopped", summary(lines, "the PR could not be read"), fresh.result.next);
  }
  const guard = writeGuard(deps, fresh.evaluated, action);
  if (guard !== null) {
    return guard;
  }
  const { snapshot } = fresh.evaluated;
  const slot = snapshot.queueEntry;
  if (snapshot.state !== "OPEN" || slot === null) {
    return result(action, "skipped", "the PR has left the queue", NONE);
  }
  if (snapshot.baseRef !== plan.defaultBranch) {
    return result(action, "skipped", `the PR base is ${snapshot.baseRef}, not the default branch`, NONE);
  }
  if (snapshot.headSha !== action.headSha) {
    return result(action, "stopped", MOVED, "Run the plan again.");
  }
  if (slot.state !== "UNMERGEABLE" || slot.position > QUEUE_HEAD) {
    return result(action, "skipped", `the entry is ${slot.state} at position ${slot.position}, not UNMERGEABLE in the head of the queue`, NONE);
  }
  const scoped = scopeCheck(ctx, fresh.evaluated);
  if (scoped !== null) {
    return result(action, "stopped", summary(lines, "refused"), scoped.next);
  }
  const outcome = await dequeueWrite(ctx, fresh.evaluated, "unmergeable");
  return outcome.exit === MERGE_EXIT.done
    ? result(action, "done", summary(lines, "removed from the merge queue"), outcome.next)
    : result(action, "stopped", summary(lines, outcome.outcome), outcome.next);
}

interface MergeState {
  /** Merges and enqueues that ran in this pass. */
  started: number;
  /** A direct merge ran: the base moved, and every later PR is judged on the new base. */
  directMerged: boolean;
}

interface Ran {
  readonly result: ActionResult;
  /** A refresh action that the fleet adds to this pass. */
  readonly late?: Action;
}

async function runMerge(deps: FleetDeps, plan: Plan, action: Action, state: MergeState): Promise<Ran> {
  const lines: string[] = [];
  const ctx = contextFor(deps, plan.repo, action.number, lines);
  const fresh = await evaluateFresh(ctx);
  if (!fresh.ok) {
    return { result: result(action, "stopped", summary(lines, "the PR could not be read"), fresh.result.next) };
  }
  const { evaluated } = fresh;
  const guard = writeGuard(deps, evaluated, action);
  if (guard !== null) {
    return { result: guard };
  }
  if (evaluated.snapshot.headSha !== action.headSha) {
    return { result: result(action, "stopped", MOVED, "Run the plan again.") };
  }
  const entry = freshEntry(evaluated);
  const route = evaluated.snapshot.rules.mergeQueue ? "queue" : "direct";
  // The queue grows with the fleet's own enqueues, so the merge budget is read again from this read.
  const length = queueLength([readOf(evaluated)], plan.defaultBranch);
  const overBudget = state.started >= baseMergeCap(evaluated.policy, route) || (route === "queue" && queueRoom(evaluated.policy, length) < 1);
  if (overBudget) {
    return { result: result(action, "skipped", "deferred (merge budget)", "Plan again in a later pass.") };
  }
  if (state.directMerged && isBehindReady(entry, plan.defaultBranch)) {
    // The next PR must be READY on the new base. A PR that is behind needs a base merge.
    const late: Action = { ...action, kind: "refresh", detail: "behind the new base after a direct merge", late: true, pending: deps.refresh === null ? PENDING_REFRESH : null };
    return { result: result(action, "skipped", "behind the new base after a direct merge; it counts as a refresh candidate, not a merge", NONE), late };
  }
  if (!isMergeCandidate(entry, plan.defaultBranch)) {
    return { result: result(action, "skipped", `the PR is ${evaluated.verdict.state}, not READY and outside the queue`, evaluated.verdict.next) };
  }
  const outcome = await mergeStep(ctx, { acceptRisk: false });
  const landed = outcome.exit === MERGE_EXIT.done || outcome.outcome === "queued";
  if (landed) {
    state.started += 1;
    state.directMerged = state.directMerged || route === "direct";
  }
  return {
    result: landed
      ? result(action, "done", summary(lines, outcome.outcome), outcome.next)
      : result(action, "stopped", summary(lines, outcome.outcome), outcome.next),
  };
}

async function runRefresh(deps: FleetDeps, plan: Plan, action: Action, used: number): Promise<{ readonly result: ActionResult; readonly ran: boolean }> {
  const port = deps.refresh;
  if (port === null) {
    return { result: result(action, "pending", PENDING_REFRESH, "None until pr-refresh is available. Report this action to the user."), ran: false };
  }
  const lines: string[] = [];
  const ctx = contextFor(deps, plan.repo, action.number, lines);
  const fresh = await evaluateFresh(ctx);
  if (!fresh.ok) {
    return { result: result(action, "stopped", summary(lines, "the PR could not be read"), fresh.result.next), ran: false };
  }
  const { snapshot, policy, verdict } = fresh.evaluated;
  const guard = writeGuard(deps, fresh.evaluated, action);
  if (guard !== null) {
    return { result: guard, ran: false };
  }
  if (snapshot.headSha !== action.headSha) {
    return { result: result(action, "stopped", MOVED, "Run the plan again."), ran: false };
  }
  const entry = freshEntry(fresh.evaluated);
  const needed = isRefreshCandidate(entry, plan.defaultBranch) || (action.late && isBehindReady(entry, plan.defaultBranch));
  if (!needed) {
    return { result: result(action, "skipped", `the PR no longer needs a base merge (${verdict.state})`, verdict.next), ran: false };
  }
  // The queue grows while the fleet enqueues, so the budget is read again from this fresh read.
  // Refreshes from an earlier pass that still run CI use up the budget too.
  const length = queueLength([readOf(fresh.evaluated)], plan.defaultBranch);
  const { budget, congested } = refreshBudget(policy, length);
  const running = used + plan.refresh.inFlight.length;
  if (running >= budget) {
    const why = congested ? "the queue is congested" : "the budget is used";
    return {
      result: result(action, "skipped", `deferred: ${why} (${used} refreshes run in this pass, ${plan.refresh.inFlight.length} still in CI, budget ${budget})`, "Plan again in a later pass."),
      ran: false,
    };
  }
  const outcome = await port.sync(action.number, action.headSha);
  return {
    result: outcome.ok ? result(action, "done", outcome.note, NONE) : result(action, "stopped", outcome.note, outcome.next),
    ran: true,
  };
}

export type ApplyOutcome =
  | { readonly kind: "locked"; readonly reason: string }
  | { readonly kind: "ran"; readonly results: readonly ActionResult[]; readonly refreshes: number };

/** Run the actions of the plan in order. The caller has checked freeze and the local policy. */
export async function applyPlan(deps: FleetDeps, plan: Plan): Promise<ApplyOutcome> {
  const lock = acquireWatchLock({
    dir: deps.io.lockDir,
    repo: plan.repo,
    number: 0,
    timeoutSeconds: LOCK_SECONDS,
    now: deps.io.now,
    isAlive: deps.io.isAlive,
    startOf: deps.io.startOf,
    pid: deps.io.pid,
    prefix: LOCK_PREFIX,
    label: "fleet apply",
  });
  if (!lock.ok) {
    return { kind: "locked", reason: lock.reason };
  }
  try {
    const started = deps.io.now();
    const results: ActionResult[] = [];
    const merges: MergeState = { started: 0, directMerged: false };
    const queue: Action[] = [...plan.actions];
    let refreshes = 0;
    let frozen: string | null = null;
    // The queue may grow during the loop: a direct merge can add a refresh.
    for (const action of queue) {
      if (frozen === null && envFreeze(deps)) {
        frozen = FROZEN_ENV;
      }
      if (frozen !== null) {
        results.push(result(action, "refused", frozen, NONE));
        continue;
      }
      if (deps.io.now() - started >= DEADLINE_SECONDS * 1000) {
        results.push(result(action, "pending", "deferred (pass deadline)", "Plan again, then run apply again."));
        continue;
      }
      let outcome: ActionResult;
      if (action.kind === "dequeue") {
        outcome = await runDequeue(deps, plan, action);
      } else if (action.kind === "merge") {
        const ran = await runMerge(deps, plan, action, merges);
        outcome = ran.result;
        if (ran.late !== undefined) {
          queue.push(ran.late);
        }
      } else {
        const ran = await runRefresh(deps, plan, action, refreshes);
        refreshes += ran.ran ? 1 : 0;
        outcome = ran.result;
      }
      if (outcome.kind === "refused") {
        frozen = outcome.detail;
      }
      results.push(outcome);
    }
    return { kind: "ran", results, refreshes };
  } finally {
    lock.release();
  }
}

/** 3 when a freeze refused an action, else 20 when one was stopped, else 10 when one is pending, else 0. */
export function exitFor(results: readonly ActionResult[]): number {
  if (results.some((r) => r.kind === "refused")) {
    return EXIT.refused;
  }
  if (results.some((r) => r.kind === "stopped")) {
    return EXIT.blocked;
  }
  return results.some((r) => r.kind === "pending") ? EXIT.waiting : EXIT.done;
}
