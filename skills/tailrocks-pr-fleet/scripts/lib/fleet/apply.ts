// Run the plan. The fleet writes only through the library functions of the
// other skills: dequeue and merge from pr-merge, sync from pr-refresh. Right
// before each action it reads the PR again. It never runs more refreshes than
// the budget allows, and only one apply runs at a time.

import { dequeueWrite } from "../merge/dequeue.ts";
import { evaluateFresh } from "../merge/evaluate.ts";
import { scopeCheck } from "../merge/common.ts";
import { acquireWatchLock } from "../merge/lock.ts";
import { mergeStep } from "../merge/merge.ts";
import { EXIT as MERGE_EXIT, type Evaluated, type StepContext } from "../merge/types.ts";
import type { RepoSlug } from "../types.ts";
import { entryOf, isMergeCandidate, isRefreshCandidate, queueLength, refreshBudget, type Read } from "./analyze.ts";
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
const LOCK_SECONDS = 3600;

function contextFor(deps: FleetDeps, repo: RepoSlug, number: number, lines: string[]): StepContext {
  return {
    repo,
    number,
    cwd: deps.cwd,
    gitDir: deps.gitDir,
    io: deps.io,
    shared: deps.shared,
    say: (line) => void lines.push(line),
    confirmed: true,
  };
}

function result(action: Action, kind: ActionResult["kind"], detail: string, next: string): ActionResult {
  return { action, kind, detail, next };
}

const NONE = "None.";

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

async function runDequeue(deps: FleetDeps, plan: Plan, action: Action): Promise<ActionResult> {
  const lines: string[] = [];
  const ctx = contextFor(deps, plan.repo, action.number, lines);
  const fresh = await evaluateFresh(ctx);
  if (!fresh.ok) {
    return result(action, "stopped", summary(lines, "the PR could not be read"), fresh.result.next);
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
    return result(action, "stopped", "the head moved since the plan; nothing was written", "Run the plan again.");
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

async function runMerge(deps: FleetDeps, plan: Plan, action: Action): Promise<ActionResult> {
  const lines: string[] = [];
  const ctx = contextFor(deps, plan.repo, action.number, lines);
  const fresh = await evaluateFresh(ctx);
  if (!fresh.ok) {
    return result(action, "stopped", summary(lines, "the PR could not be read"), fresh.result.next);
  }
  if (fresh.evaluated.snapshot.headSha !== action.headSha) {
    return result(action, "stopped", "the head moved since the plan; nothing was written", "Run the plan again.");
  }
  if (!isMergeCandidate(freshEntry(fresh.evaluated), plan.defaultBranch)) {
    return result(action, "skipped", `the PR is ${fresh.evaluated.verdict.state}, not READY and outside the queue`, fresh.evaluated.verdict.next);
  }
  const outcome = await mergeStep(ctx, { acceptRisk: false });
  const landed = outcome.exit === MERGE_EXIT.done || outcome.outcome === "queued";
  return landed
    ? result(action, "done", summary(lines, outcome.outcome), outcome.next)
    : result(action, "stopped", summary(lines, outcome.outcome), outcome.next);
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
  if (snapshot.headSha !== action.headSha) {
    return { result: result(action, "stopped", "the head moved since the plan; nothing was written", "Run the plan again."), ran: false };
  }
  if (!isRefreshCandidate(freshEntry(fresh.evaluated), plan.defaultBranch)) {
    return { result: result(action, "skipped", `the PR no longer needs a base merge (${verdict.state})`, verdict.next), ran: false };
  }
  // The queue grows while the fleet enqueues, so the budget is read again from this fresh read.
  const length = queueLength([readOf(fresh.evaluated)], plan.defaultBranch);
  const { budget, congested } = refreshBudget(policy, length);
  if (used >= budget) {
    const why = congested ? "the queue is congested" : "the budget is used";
    return { result: result(action, "skipped", `deferred: ${why} (${used} of ${budget} refreshes run)`, "Plan again in a later pass."), ran: false };
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
    const results: ActionResult[] = [];
    let refreshes = 0;
    for (const action of plan.actions) {
      if (action.kind === "dequeue") {
        results.push(await runDequeue(deps, plan, action));
      } else if (action.kind === "merge") {
        results.push(await runMerge(deps, plan, action));
      } else {
        const outcome = await runRefresh(deps, plan, action, refreshes);
        refreshes += outcome.ran ? 1 : 0;
        results.push(outcome.result);
      }
    }
    return { kind: "ran", results, refreshes };
  } finally {
    lock.release();
  }
}

/** 20 when an action was stopped, else 10 when one is pending, else 0. */
export function exitFor(results: readonly ActionResult[]): number {
  if (results.some((r) => r.kind === "stopped")) {
    return EXIT.blocked;
  }
  return results.some((r) => r.kind === "pending") ? EXIT.waiting : EXIT.done;
}
