// Step `watch`: one bounded poller for a queued PR. It never runs twice in
// parallel, and it never merges. It ends when the PR merges, leaves the queue,
// closes, needs a dequeue, or the time bound passes.

import { renderText } from "../status/render.ts";
import { dequeueWrite, hasChangesNeeded } from "./dequeue.ts";
import { blockerCodes, codesOf, evaluateFresh } from "./evaluate.ts";
import { planOnly, scopeCheck } from "./common.ts";
import { mergedSuffix, readPrState } from "./github.ts";
import { EXIT, result, type Evaluated, type StepContext, type StepResult } from "./types.ts";

export const DEFAULT_INTERVAL_SECONDS = 180;
export const DEFAULT_TIMEOUT_SECONDS = 90 * 60;
export const MIN_INTERVAL_SECONDS = 5;
const MAX_UNREADABLE = 3;
const SETTLE_READS = 3;
const SETTLE_WAIT_MS = 5000;

export type WatchView =
  | { readonly kind: "merged" }
  | { readonly kind: "closed" }
  | { readonly kind: "dequeue" }
  | { readonly kind: "stuck" }
  | { readonly kind: "queued"; readonly line: string }
  | { readonly kind: "not_queued" };

/** What one read of the PR means for the watcher. Pure, so recorded snapshots can test it. */
export function classifyWatch(evaluated: Evaluated): WatchView {
  const { snapshot } = evaluated;
  if (snapshot.state === "MERGED") {
    return { kind: "merged" };
  }
  if (snapshot.state === "CLOSED") {
    return { kind: "closed" };
  }
  const entry = snapshot.queueEntry;
  if (entry === null) {
    return { kind: "not_queued" };
  }
  if (hasChangesNeeded(evaluated)) {
    return { kind: "dequeue" };
  }
  if (codesOf(evaluated).has("queue_unmergeable")) {
    return { kind: "stuck" };
  }
  const open = blockerCodes(evaluated).filter((code) => code !== "queued_while_blocked");
  return {
    kind: "queued",
    line: `queued: position ${entry.position}, ${entry.state}, head ${snapshot.headSha.slice(0, 7)}${open.length === 0 ? "" : `; open blockers: ${open.join(", ")}`}`,
  };
}

export interface WatchOptions {
  readonly intervalSeconds: number;
  readonly timeoutSeconds: number;
}

function leftQueue(ctx: StepContext, evaluated: Evaluated, neverQueued: boolean): StepResult {
  const removal = evaluated.snapshot.lastQueueRemoval;
  if (neverQueued) {
    ctx.say(renderText(evaluated.verdict));
    ctx.say("refused: the PR is not in the merge queue and was not removed from it; there is nothing to watch");
    return result(EXIT.refused, "refused", `Use merge.ts merge ${ctx.number} to enter the queue.`, evaluated);
  }
  ctx.say(`the PR left the merge queue without a merge (head ${evaluated.snapshot.headSha.slice(0, 7)})`);
  ctx.say(
    removal === null
      ? "removal reason: none recorded by GitHub yet"
      : `removal reason: ${removal.reason} (at ${removal.at}${removal.afterLastPush ? "" : ", before the last push"})`,
  );
  ctx.say(renderText(evaluated.verdict));
  return result(EXIT.blocked, "ejected", evaluated.verdict.next, evaluated);
}

export async function watchStep(ctx: StepContext, options: WatchOptions): Promise<StepResult> {
  const first = await evaluateFresh(ctx);
  if (!first.ok) {
    return first.result;
  }
  const scoped = scopeCheck(ctx, first.evaluated);
  if (scoped !== null) {
    return scoped;
  }
  if (!ctx.confirmed) {
    ctx.say(`now: ${first.evaluated.snapshot.state}${first.evaluated.snapshot.queueEntry === null ? ", not queued" : `, queue position ${first.evaluated.snapshot.queueEntry.position}`}`);
    return planOnly(
      ctx,
      `poll every ${options.intervalSeconds}s for up to ${options.timeoutSeconds}s, and dequeue when a review asks for changes`,
      first.evaluated,
    );
  }
  const intervalMs = options.intervalSeconds * 1000;
  const deadline = ctx.io.now() + options.timeoutSeconds * 1000;
  ctx.say(`watching every ${options.intervalSeconds}s for up to ${options.timeoutSeconds}s`);

  let current: Evaluated | null = first.evaluated;
  let seenQueued = false;
  let lastLine = "";
  let unreadable = 0;
  let settling = 0;
  for (;;) {
    if (current === null) {
      const fresh = await evaluateFresh(ctx);
      if (!fresh.ok) {
        if (fresh.kind === "policy") {
          return fresh.result;
        }
        unreadable += 1;
        if (unreadable >= MAX_UNREADABLE) {
          ctx.say(`the PR could not be read ${MAX_UNREADABLE} times in a row; the watch stops`);
          return fresh.result;
        }
      } else {
        unreadable = 0;
        current = fresh.evaluated;
      }
    }
    if (current !== null) {
      const view = classifyWatch(current);
      if (view.kind === "merged") {
        const state = await readPrState(ctx.io.runGh, ctx.repo, ctx.number);
        ctx.say(`merged${mergedSuffix(state)}`);
        return result(EXIT.done, "merged", "None. The PR is merged.", current, { mergeCommit: state?.mergeCommit ?? null });
      }
      if (view.kind === "closed") {
        ctx.say("the PR was closed without a merge");
        return result(EXIT.blocked, "closed", "Ask the user whether to reopen the PR.", current);
      }
      if (view.kind === "dequeue") {
        ctx.say("a review asks for changes while the PR is queued; removing it from the queue");
        const written = await dequeueWrite(ctx, current, "changes-needed");
        if (written.outcome !== "dequeued") {
          return written;
        }
        return result(EXIT.blocked, "dequeued", "Fix the review findings with pr-threads. Then run pr-status.", current);
      }
      if (view.kind === "stuck") {
        ctx.say("the queue entry is UNMERGEABLE and blocks the entries behind it");
        ctx.say(renderText(current.verdict));
        return result(EXIT.blocked, "blocked", `Run merge.ts dequeue ${ctx.number} --confirm ${ctx.number}, then pr-refresh.`, current);
      }
      if (view.kind === "queued") {
        seenQueued = true;
        settling = 0;
        if (view.line !== lastLine) {
          ctx.say(view.line);
          lastLine = view.line;
        }
      } else {
        const removed = current.snapshot.lastQueueRemoval?.afterLastPush === true;
        if (!seenQueued && !removed) {
          return leftQueue(ctx, current, true);
        }
        // GitHub can show an open PR for a few seconds after a merge. Read again before the verdict.
        if (settling < SETTLE_READS) {
          settling += 1;
          current = null;
          await ctx.io.sleep(SETTLE_WAIT_MS);
          continue;
        }
        return leftQueue(ctx, current, false);
      }
    }
    const left = deadline - ctx.io.now();
    if (left <= 0) {
      ctx.say(`the time bound passed; the PR is still ${seenQueued ? "in the queue" : "not merged"}`);
      return result(EXIT.waiting, "timeout", `Run merge.ts watch ${ctx.number} --confirm ${ctx.number} again to keep watching.`, current);
    }
    current = null;
    await ctx.io.sleep(Math.min(intervalMs, left));
  }
}
