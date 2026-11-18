// How a READY PR lands: through the merge queue, or by a direct merge.
// The route follows the policy and the branch rules. A mismatch is a block.

import type { GhRun } from "../github/graphql.ts";
import type { Policy } from "../policy/types.ts";
import type { PrSnapshot } from "../status/types.ts";
import { readQueueMethod } from "./github.ts";
import type { Evaluated } from "./types.ts";

export type Method = Policy["merge"]["method"];

export type Route =
  | { readonly kind: "queue"; readonly method: Method; readonly jump: boolean; readonly jumpLabel: string | null }
  | { readonly kind: "direct"; readonly method: Method }
  | { readonly kind: "blocked"; readonly reason: string };

export interface JumpDecision {
  readonly jump: boolean;
  readonly label: string | null;
  /** A note when a jump label is present but the policy does not allow a jump. */
  readonly note: string | null;
}

/** A jump needs both the policy (`merge.jump = "labelled"`) and a jump label on the PR. */
export function jumpDecision(policy: Policy, snapshot: PrSnapshot): JumpDecision {
  const label = policy.merge.jump_labels.find((candidate) => snapshot.labels.includes(candidate)) ?? null;
  if (policy.merge.jump === "labelled" && label !== null) {
    return { jump: true, label, note: null };
  }
  return {
    jump: false,
    label: null,
    note: label === null ? null : `the PR has the jump label "${label}", but the policy has merge.jump = "never"; it enters the queue without a jump`,
  };
}

export async function decideRoute(run: GhRun, evaluated: Evaluated): Promise<Route> {
  const { policy, snapshot } = evaluated;
  const wanted = policy.merge.method;
  const queueExists = snapshot.rules.mergeQueue;
  const mode = policy.merge.queue;
  if (mode === "required" && !queueExists) {
    return { kind: "blocked", reason: `the policy has merge.queue = "required", but ${snapshot.baseRef} has no merge queue` };
  }
  if (mode === "never" && queueExists) {
    return { kind: "blocked", reason: `the policy has merge.queue = "never", but ${snapshot.baseRef} requires the merge queue` };
  }
  if (queueExists) {
    const queue = await readQueueMethod(run, snapshot.repo, snapshot.baseRef);
    if (!queue.known) {
      return { kind: "blocked", reason: `the merge method of the queue is not confirmed: ${queue.reason}` };
    }
    if (queue.method !== wanted) {
      return { kind: "blocked", reason: `the queue merges with ${queue.method}, but the policy has merge.method = "${wanted}"` };
    }
    const jump = jumpDecision(policy, snapshot);
    return { kind: "queue", method: wanted, jump: jump.jump, jumpLabel: jump.label };
  }
  const allowed = snapshot.rules.allowedMergeMethods;
  if (allowed.length > 0 && !allowed.includes(wanted)) {
    return { kind: "blocked", reason: `the branch rules allow ${allowed.join(", ")}, but the policy has merge.method = "${wanted}"` };
  }
  return { kind: "direct", method: wanted };
}

export function describeRoute(route: Route): string {
  switch (route.kind) {
    case "queue":
      return route.jump ? `enqueue with a jump (label ${route.jumpLabel ?? ""}), ${route.method} queue` : `enqueue, ${route.method} queue`;
    case "direct":
      return `merge directly with ${route.method}`;
    case "blocked":
      return `no route: ${route.reason}`;
  }
}
