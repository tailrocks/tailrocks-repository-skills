// One fresh read of a PR: gather, load the default-branch policy, evaluate.
// Every call uses a new gather cache, so a read before a write never reuses
// facts from an earlier read.

import { newGatherCache } from "../github/gather.ts";
import { formatPolicyErrors } from "../policy/load.ts";
import { policyFor, statusFor, type StatusConfig } from "../status/run.ts";
import { renderText } from "../status/render.ts";
import type { PrSnapshot } from "../status/types.ts";
import { EXIT, result, type Evaluated, type StepContext, type StepResult } from "./types.ts";

export type Fresh =
  | { readonly ok: true; readonly evaluated: Evaluated }
  | { readonly ok: false; readonly kind: "policy" | "unreadable"; readonly result: StepResult };

export function configFor(ctx: StepContext): StatusConfig {
  return {
    cwd: ctx.cwd,
    runGh: ctx.io.runGh,
    cache: newGatherCache(),
    policies: ctx.shared.policies,
    fetchedBases: ctx.shared.fetchedBases,
    gitQueue: ctx.shared.gitQueue,
    ...(ctx.gitDir === null ? {} : { gitDir: ctx.gitDir }),
    ...(ctx.localPolicy === undefined ? {} : { localPolicy: { policy: ctx.localPolicy } }),
  };
}

export async function evaluateFresh(ctx: StepContext): Promise<Fresh> {
  const config = configFor(ctx);
  const status = await statusFor(ctx.repo, ctx.number, config);
  if (status.kind === "policy-error") {
    ctx.say(`invalid policy:\n${formatPolicyErrors(status.errors)}`);
    return { ok: false, kind: "policy", result: result(EXIT.usage, "policy_error", "Fix the policy file on the default branch. No step ran.") };
  }
  const { verdict, snapshot } = status;
  if (snapshot === null) {
    ctx.say(renderText(verdict));
    return { ok: false, kind: "unreadable", result: result(EXIT.blocked, "blocked", verdict.next) };
  }
  const loaded = await policyFor(ctx.repo, snapshot.defaultSha, config, ctx.io.runGh);
  if (!loaded.ok) {
    ctx.say(`invalid policy:\n${formatPolicyErrors(loaded.errors)}`);
    return { ok: false, kind: "policy", result: result(EXIT.usage, "policy_error", "Fix the policy file on the default branch. No step ran.") };
  }
  return { ok: true, evaluated: { snapshot, verdict, policy: loaded.policy } };
}

export function codesOf(evaluated: Evaluated): ReadonlySet<string> {
  return new Set(evaluated.verdict.findings.map((f) => f.code));
}

export function blockerCodes(evaluated: Evaluated): readonly string[] {
  return [...new Set(evaluated.verdict.findings.filter((f) => f.kind === "blocker").map((f) => f.code))];
}

/** The exit code that a verdict gives when the step cannot go on. */
export function verdictExit(evaluated: Evaluated): number {
  return evaluated.verdict.state === "WAITING" ? EXIT.waiting : EXIT.blocked;
}

export type HeadCheck = { readonly same: true } | { readonly same: false; readonly was: PrSnapshot["headSha"]; readonly now: PrSnapshot["headSha"] };

export function compareHead(before: Evaluated, after: Evaluated): HeadCheck {
  return before.snapshot.headSha === after.snapshot.headSha
    ? { same: true }
    : { same: false, was: before.snapshot.headSha, now: after.snapshot.headSha };
}
