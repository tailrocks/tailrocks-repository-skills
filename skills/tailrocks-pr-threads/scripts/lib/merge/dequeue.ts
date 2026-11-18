// Step `dequeue`: take a PR out of the merge queue and say why in a comment.

import { writeBodyFile } from "../body-file.ts";
import type { FindingCode } from "../status/types.ts";
import { parseMutationReply } from "./github.ts";
import { planOnly, reread, scopeCheck, unexpectedAfter } from "./common.ts";
import { blockerCodes, codesOf, evaluateFresh } from "./evaluate.ts";
import { EXIT, result, type Evaluated, type StepContext, type StepResult } from "./types.ts";

export const DEQUEUE_REASONS = ["changes-needed", "blocked", "unmergeable", "manual"] as const;
export type DequeueReason = (typeof DEQUEUE_REASONS)[number];

const REASON_TEXT: Readonly<Record<DequeueReason, string>> = {
  "changes-needed": "a review asks for changes",
  blocked: "the PR has open blockers, so the entry must not hold the queue",
  unmergeable: "the queue entry is UNMERGEABLE and blocks the entries behind it",
  manual: "a person asked for the removal",
};

const CHANGES_CODES: readonly FindingCode[] = ["review_changes_requested", "review_blocking_finding"];

export function hasChangesNeeded(evaluated: Evaluated): boolean {
  const codes = codesOf(evaluated);
  return CHANGES_CODES.some((code) => codes.has(code));
}

/** The reason that the verdict gives. A reason that the user passes wins. */
export function deriveReason(evaluated: Evaluated): DequeueReason {
  const codes = codesOf(evaluated);
  if (codes.has("queue_unmergeable")) {
    return "unmergeable";
  }
  if (hasChangesNeeded(evaluated)) {
    return "changes-needed";
  }
  return codes.has("queued_while_blocked") ? "blocked" : "manual";
}

/** The comment uses fixed words and finding codes only. No text of the PR enters it. */
export function dequeueComment(reason: DequeueReason, evaluated: Evaluated): string {
  const open = blockerCodes(evaluated).filter((code) => code !== "queued_while_blocked");
  const lines = ["Removed from the merge queue by an automated step.", "", `Reason: ${REASON_TEXT[reason]}.`];
  if (open.length > 0) {
    lines.push(`Open findings: ${open.join(", ")}.`);
  }
  lines.push("", "Fix the findings. Then add the PR to the queue again.");
  return lines.join("\n");
}

/**
 * Remove the queue entry after the plan was shown and confirmed. Reads the PR
 * again first: the head and the entry must be the ones of the plan.
 */
export async function dequeueWrite(ctx: StepContext, plan: Evaluated, reason: DequeueReason): Promise<StepResult> {
  const entry = plan.snapshot.queueEntry;
  if (entry === null) {
    return result(EXIT.done, "nothing_to_do", "None. The PR is not in the merge queue.", plan);
  }
  const again = await reread(ctx, plan);
  if (!again.ok) {
    return again.result;
  }
  const current = again.evaluated.snapshot.queueEntry;
  if (current === null || current.id !== entry.id) {
    ctx.say("the queue entry changed between the plan and the write; nothing was written");
    return result(EXIT.blocked, "blocked", "Read the PR again with pr-status.", again.evaluated);
  }
  const reply = parseMutationReply(await ctx.io.mutate({ kind: "dequeuePullRequest", entryId: entry.id }));
  if (!reply.ok) {
    ctx.say(`GitHub refused the dequeue: ${reply.message}`);
    return result(EXIT.blocked, "blocked", "Read the PR page for GitHub's reason.", again.evaluated);
  }
  const comment = await ctx.io.runGh([
    "pr",
    "comment",
    String(ctx.number),
    "--repo",
    ctx.repo,
    "--body-file",
    writeBodyFile(dequeueComment(reason, again.evaluated)),
  ]);
  if (comment.code !== 0) {
    ctx.say("warning: the PR left the queue, but the reason comment failed; post the reason by hand");
  }
  const after = await evaluateFresh(ctx);
  if (!after.ok) {
    return unexpectedAfter(ctx, "the PR could not be read again", null);
  }
  if (after.evaluated.snapshot.queueEntry !== null) {
    return unexpectedAfter(ctx, "the PR is still in the queue", after.evaluated);
  }
  ctx.say(`removed from the merge queue (reason: ${reason})`);
  return result(EXIT.done, "dequeued", after.evaluated.verdict.next, after.evaluated);
}

export async function dequeueStep(ctx: StepContext, requested: DequeueReason | null): Promise<StepResult> {
  const first = await evaluateFresh(ctx);
  if (!first.ok) {
    return first.result;
  }
  const plan = first.evaluated;
  const scoped = scopeCheck(ctx, plan);
  if (scoped !== null) {
    return scoped;
  }
  if (plan.snapshot.queueEntry === null) {
    ctx.say(`the PR is ${plan.snapshot.state.toLowerCase()} and has no queue entry; nothing to do`);
    return result(EXIT.done, "nothing_to_do", "None. The PR is not in the merge queue.", plan);
  }
  const reason = requested ?? deriveReason(plan);
  ctx.say(`queue entry ${plan.snapshot.queueEntry.state} at position ${plan.snapshot.queueEntry.position}; reason: ${reason}`);
  if (!ctx.confirmed) {
    return planOnly(ctx, `remove the PR from the merge queue (reason: ${reason})`, plan);
  }
  return dequeueWrite(ctx, plan, reason);
}
