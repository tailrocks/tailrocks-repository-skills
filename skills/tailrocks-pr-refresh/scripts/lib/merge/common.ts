// Parts that every write step shares: refusals, the plan-only gate, and the
// re-read before a write (design section 4: a head change stops the write).

import { renderText } from "../status/render.ts";
import { compareHead, evaluateFresh, verdictExit } from "./evaluate.ts";
import { EXIT, result, type Evaluated, type StepContext, type StepResult } from "./types.ts";

export function refuse(ctx: StepContext, message: string, next: string, evaluated: Evaluated | null = null, refusal?: "high_risk"): StepResult {
  ctx.say(`refused: ${message}`);
  return result(EXIT.refused, "refused", next, evaluated, refusal === undefined ? {} : { refusal });
}

/** Refusals that hold for every step: a fork PR, and a verdict from a local policy. */
export function scopeCheck(ctx: StepContext, evaluated: Evaluated): StepResult | null {
  if (evaluated.snapshot.isCrossRepository) {
    return refuse(ctx, "the PR head is in a fork; the writing skills do not touch fork PRs", "Ask the user to handle this PR by hand.", evaluated);
  }
  if (evaluated.verdict.policySource === "local") {
    return refuse(ctx, "the verdict uses a LOCAL policy file; only the default-branch policy is valid", "Run again without a local policy.", evaluated);
  }
  return null;
}

/** Without `--confirm <pr>` a step prints what it would do and writes nothing. */
export function planOnly(ctx: StepContext, action: string, evaluated: Evaluated): StepResult {
  ctx.say(`plan: ${action}`);
  ctx.say(`nothing was written; add --confirm ${ctx.number} to run it`);
  return result(EXIT.plan, "plan", `Run again with --confirm ${ctx.number} to ${action}.`, evaluated);
}

/** The verdict is not READY: print it and stop. WAITING gives 10, BLOCKED gives 20. */
export function notReady(ctx: StepContext, evaluated: Evaluated): StepResult | null {
  if (evaluated.verdict.state === "READY") {
    return null;
  }
  ctx.say(renderText(evaluated.verdict));
  return result(verdictExit(evaluated), evaluated.verdict.state === "WAITING" ? "waiting" : "blocked", evaluated.verdict.next, evaluated);
}

export type Reread = { readonly ok: true; readonly evaluated: Evaluated } | { readonly ok: false; readonly result: StepResult };

/**
 * Read the PR again right before a write. The head must equal the head of the
 * plan. Any other change is judged by the caller on the new read.
 */
export async function reread(ctx: StepContext, plan: Evaluated): Promise<Reread> {
  const fresh = await evaluateFresh(ctx);
  if (!fresh.ok) {
    return { ok: false, result: fresh.result };
  }
  const head = compareHead(plan, fresh.evaluated);
  if (!head.same) {
    ctx.say(`the head moved from ${head.was.slice(0, 7)} to ${head.now.slice(0, 7)} between the plan and the write; nothing was written`);
    return {
      ok: false,
      result: result(EXIT.blocked, "blocked", "Read the PR again with pr-status, then run this step again.", fresh.evaluated),
    };
  }
  const scoped = scopeCheck(ctx, fresh.evaluated);
  return scoped === null ? { ok: true, evaluated: fresh.evaluated } : { ok: false, result: scoped };
}

/** The write ran, but the read after it failed or shows an unexpected state. */
export function unexpectedAfter(ctx: StepContext, what: string, evaluated: Evaluated | null): StepResult {
  ctx.say(`the write ran, but ${what}`);
  return result(EXIT.blocked, "blocked", "Read the PR again with pr-status before any retry.", evaluated);
}
