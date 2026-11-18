// Step `merge`: land one READY PR, through the merge queue or by a direct merge.
// Never --admin. Never a branch deletion. The head is pinned in both routes.

import { renderText } from "../status/render.ts";
import { planOnly, notReady, reread, refuse, scopeCheck, unexpectedAfter } from "./common.ts";
import { evaluateFresh } from "./evaluate.ts";
import { mergedSuffix, parseMutationReply, readChangedFiles, readPrState } from "./github.ts";
import { classifyRisk } from "./risk.ts";
import { decideRoute, describeRoute, jumpDecision, type Route } from "./route.ts";
import { EXIT, result, type Evaluated, type StepContext, type StepResult } from "./types.ts";

export interface MergeOptions {
  readonly acceptRisk: boolean;
}

const MERGED_READS = 3;
const MERGED_WAIT_MS = 2000;

async function enqueue(ctx: StepContext, evaluated: Evaluated, route: Extract<Route, { kind: "queue" }>): Promise<StepResult> {
  const reply = parseMutationReply(
    await ctx.io.mutate({
      kind: "enqueuePullRequest",
      pullRequestId: evaluated.snapshot.nodeId,
      expectedHeadOid: evaluated.snapshot.headSha,
      jump: route.jump,
    }),
  );
  if (!reply.ok) {
    if (route.jump) {
      ctx.say(`jump refused by GitHub: ${reply.message}`);
      return result(
        EXIT.blocked,
        "blocked",
        "The jump was refused and no retry ran. Ask the user: remove the jump label to enter the queue normally, or fix the cause.",
        evaluated,
      );
    }
    ctx.say(`GitHub refused to enqueue: ${reply.message}`);
    return result(EXIT.blocked, "blocked", "Read the PR page for GitHub's reason.", evaluated);
  }
  const after = await evaluateFresh(ctx);
  if (!after.ok) {
    return unexpectedAfter(ctx, "the PR could not be read again", null);
  }
  const now = after.evaluated;
  if (now.snapshot.state === "MERGED") {
    const state = await readPrState(ctx.io.runGh, ctx.repo, ctx.number);
    ctx.say(`merged${mergedSuffix(state)}`);
    return result(EXIT.done, "merged", "None. The PR is merged.", now, { mergeCommit: state?.mergeCommit ?? null });
  }
  const entry = now.snapshot.queueEntry;
  if (entry === null) {
    return unexpectedAfter(ctx, "the PR is not in the queue", now);
  }
  ctx.say(`enqueued at position ${entry.position}, state ${entry.state}${entry.jump ? ", with a jump" : ""} (head ${evaluated.snapshot.headSha.slice(0, 7)})`);
  return result(EXIT.waiting, "queued", `Watch the entry: merge.ts watch ${ctx.number} --confirm ${ctx.number}`, now);
}

async function directMerge(ctx: StepContext, evaluated: Evaluated, route: Extract<Route, { kind: "direct" }>): Promise<StepResult> {
  const head = evaluated.snapshot.headSha;
  const run = await ctx.io.runGh([
    "pr",
    "merge",
    String(ctx.number),
    "--repo",
    ctx.repo,
    `--${route.method}`,
    "--match-head-commit",
    head,
  ]);
  let state = await readPrState(ctx.io.runGh, ctx.repo, ctx.number);
  for (let i = 1; run.code === 0 && state?.state === "OPEN" && i < MERGED_READS; i += 1) {
    await ctx.io.sleep(MERGED_WAIT_MS);
    state = await readPrState(ctx.io.runGh, ctx.repo, ctx.number);
  }
  if (state?.state === "MERGED") {
    ctx.say(`merged${mergedSuffix(state)} (${route.method}, head ${head.slice(0, 7)})`);
    return result(EXIT.done, "merged", "None. The PR is merged.", evaluated, { mergeCommit: state.mergeCommit });
  }
  if (run.code !== 0) {
    ctx.say(`the merge command failed: ${run.stderr.split("\n")[0] ?? ""}`);
    return result(EXIT.blocked, "blocked", "Nothing merged. Read the PR with pr-status, then run this step again.", evaluated);
  }
  ctx.say("the merge was accepted, but the PR is not merged yet");
  return result(EXIT.waiting, "waiting", "Read the PR again with pr-status.", evaluated);
}

export async function mergeStep(ctx: StepContext, options: MergeOptions): Promise<StepResult> {
  const first = await evaluateFresh(ctx);
  if (!first.ok) {
    return first.result;
  }
  const plan = first.evaluated;
  const scoped = scopeCheck(ctx, plan);
  if (scoped !== null) {
    return scoped;
  }
  if (plan.snapshot.state === "MERGED") {
    const state = await readPrState(ctx.io.runGh, ctx.repo, ctx.number);
    ctx.say(`the PR is already merged${mergedSuffix(state)}`);
    return result(EXIT.done, "nothing_to_do", "None. The PR is merged.", plan, { mergeCommit: state?.mergeCommit ?? null });
  }
  const stop = notReady(ctx, plan);
  if (stop !== null) {
    return stop;
  }
  ctx.say(`READY (head ${plan.snapshot.headSha.slice(0, 7)}, policy: ${plan.verdict.policySource})`);

  const risk = classifyRisk(await readChangedFiles(ctx.io.runGh, ctx.repo, ctx.number));
  if (risk.level === "high" && !options.acceptRisk) {
    for (const path of risk.paths.slice(0, 10)) {
      ctx.say(`  high-risk path: ${path}`);
    }
    return refuse(
      ctx,
      `${risk.reason}`,
      "Ask the user to confirm the high-risk change. Then run this step again with --accept-risk.",
      plan,
    );
  }
  if (risk.level === "high") {
    ctx.say(`risk accepted by the user: ${risk.reason}`);
  }

  const route = await decideRoute(ctx.io.runGh, plan);
  if (route.kind === "blocked") {
    ctx.say(`blocked: ${route.reason}`);
    return result(EXIT.blocked, "blocked", "A person with admin rights fixes the policy or the branch rules. Do not work around it.", plan);
  }
  const jump = jumpDecision(plan.policy, plan.snapshot);
  if (jump.note !== null) {
    ctx.say(`note: ${jump.note}`);
  }
  ctx.say(`route: ${describeRoute(route)}`);
  if (!ctx.confirmed) {
    return planOnly(ctx, describeRoute(route), plan);
  }

  const again = await reread(ctx, plan);
  if (!again.ok) {
    return again.result;
  }
  const now = again.evaluated;
  const stillStop = notReady(ctx, now);
  if (stillStop !== null) {
    ctx.say("the PR is no longer READY; nothing was written");
    return stillStop;
  }
  const route2 = await decideRoute(ctx.io.runGh, now);
  if (route2.kind === "blocked" || describeRoute(route2) !== describeRoute(route)) {
    ctx.say("the route changed between the plan and the write; nothing was written");
    ctx.say(renderText(now.verdict));
    return result(EXIT.blocked, "blocked", "Run this step again.", now);
  }
  return route2.kind === "queue" ? enqueue(ctx, now, route2) : directMerge(ctx, now, route2);
}
