// Step `ready`: draft to ready for review, when the policy allows it.

import { renderText } from "../status/render.ts";
import { parseMutationReply } from "./github.ts";
import { planOnly, reread, refuse, scopeCheck, unexpectedAfter } from "./common.ts";
import { evaluateFresh } from "./evaluate.ts";
import { EXIT, result, type Evaluated, type StepContext, type StepResult } from "./types.ts";

/**
 * Judge `draft.ready_when`. `immediately` needs nothing more: marking a PR
 * ready is what starts CI in label-less draft flows. `checks-and-review`
 * needs `draft` as the only blocker and no wait. `manual` is never allowed.
 */
export function readyGate(evaluated: Evaluated): { readonly allowed: true } | { readonly allowed: false; readonly exit: number; readonly message: string } {
  const mode = evaluated.policy.draft.ready_when;
  if (mode === "manual") {
    return { allowed: false, exit: EXIT.refused, message: 'the policy has draft.ready_when = "manual"; the user marks the PR ready' };
  }
  if (mode === "immediately") {
    return { allowed: true };
  }
  const findings = evaluated.verdict.findings;
  const others = findings.filter((f) => f.kind === "blocker" && f.code !== "draft");
  const waits = findings.filter((f) => f.kind === "wait");
  if (others.length > 0) {
    return { allowed: false, exit: EXIT.blocked, message: `other blockers remain: ${[...new Set(others.map((f) => f.code))].join(", ")}` };
  }
  if (waits.length > 0) {
    return { allowed: false, exit: EXIT.waiting, message: `still waiting: ${[...new Set(waits.map((f) => f.code))].join(", ")}` };
  }
  return { allowed: true };
}

export async function readyStep(ctx: StepContext): Promise<StepResult> {
  const first = await evaluateFresh(ctx);
  if (!first.ok) {
    return first.result;
  }
  const plan = first.evaluated;
  const scoped = scopeCheck(ctx, plan);
  if (scoped !== null) {
    return scoped;
  }
  if (plan.snapshot.state !== "OPEN") {
    ctx.say(renderText(plan.verdict));
    return result(EXIT.blocked, "blocked", plan.verdict.next, plan);
  }
  if (!plan.snapshot.isDraft) {
    ctx.say("the PR is not a draft; nothing to do");
    return result(EXIT.done, "nothing_to_do", "None. The PR is ready for review.", plan);
  }
  const gate = readyGate(plan);
  if (!gate.allowed) {
    ctx.say(renderText(plan.verdict));
    if (gate.exit === EXIT.refused) {
      return refuse(ctx, gate.message, "Ask the user to mark the PR ready.", plan);
    }
    ctx.say(`not marked ready: ${gate.message}`);
    return result(gate.exit, gate.exit === EXIT.waiting ? "waiting" : "blocked", plan.verdict.next, plan);
  }
  if (!ctx.confirmed) {
    return planOnly(ctx, "mark the PR ready for review", plan);
  }
  const again = await reread(ctx, plan);
  if (!again.ok) {
    return again.result;
  }
  const recheck = readyGate(again.evaluated);
  if (!again.evaluated.snapshot.isDraft || !recheck.allowed) {
    ctx.say("the PR changed between the plan and the write; nothing was written");
    const exit = !again.evaluated.snapshot.isDraft ? EXIT.done : recheck.allowed ? EXIT.blocked : recheck.exit;
    const outcome = exit === EXIT.done ? "nothing_to_do" : exit === EXIT.waiting ? "waiting" : exit === EXIT.refused ? "refused" : "blocked";
    return result(exit, outcome, "Run this step again.", again.evaluated);
  }
  const reply = parseMutationReply(
    await ctx.io.mutate({ kind: "markPullRequestReadyForReview", pullRequestId: again.evaluated.snapshot.nodeId }),
  );
  if (!reply.ok) {
    ctx.say(`GitHub refused: ${reply.message}`);
    return result(EXIT.blocked, "blocked", "Read the PR page for GitHub's reason.", again.evaluated);
  }
  const after = await evaluateFresh(ctx);
  if (!after.ok) {
    return unexpectedAfter(ctx, "the PR could not be read again", null);
  }
  if (after.evaluated.snapshot.isDraft) {
    return unexpectedAfter(ctx, "the PR is still a draft", after.evaluated);
  }
  ctx.say(`marked ready for review (head ${after.evaluated.snapshot.headSha.slice(0, 7)})`);
  return result(EXIT.done, "ready", after.evaluated.verdict.next, after.evaluated);
}
