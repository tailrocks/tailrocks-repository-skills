// Text and JSON for a fleet plan and for the results of an apply.
// Branch and workflow names are untrusted text: strip control characters and cut them short.

import type { ActionResult, Entry, Plan } from "./types.ts";

export function clean(text: string, max = 60): string {
  // eslint-disable-next-line no-control-regex
  const line = text.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 3)}...` : line;
}

function numbers(list: readonly number[]): string {
  return list.length === 0 ? "none" : list.map((n) => `#${n}`).join(", ");
}

function rankLine(index: number, e: Entry): string {
  const queue = e.queue === null ? "" : ` [queue ${e.queue.position} ${e.queue.state}]`;
  const draft = e.isDraft ? " [draft]" : "";
  const fork = e.isCrossRepository ? " [fork]" : "";
  return `  ${index + 1}. #${e.number} ${e.state} ${e.owner}${queue}${draft}${fork} ${clean(e.headRef)} -> ${e.next}`;
}

export function renderPlan(plan: Plan): string {
  const lines = [`fleet plan for ${plan.repo}`];
  lines.push(
    plan.advisory
      ? "policy: a local file, not the default branch"
      : `policy: ${plan.policySource} at ${plan.policySha.slice(0, 7)} of ${plan.defaultBranch}`,
  );
  if (plan.advisory) {
    lines.push("ADVISORY: the policy is a local file. Apply refuses it.");
  }
  if (plan.frozen !== null) {
    lines.push(`FROZEN (${plan.frozen === "env" ? "environment PR_FLEET_FREEZE=1" : "policy fleet.freeze"}): nothing is planned that pushes, enqueues, or dequeues.`);
  }
  lines.push(`open PRs: ${plan.open}; held: ${numbers(plan.held)}; read: ${plan.ranking.length}`);
  const length = plan.queue.length === null ? "unknown" : String(plan.queue.length);
  const head = plan.queue.head.map((s) => `#${s.number}@${s.position} ${s.state}`).join(", ");
  lines.push(`queue: length ${length}, ${plan.queue.congested ? "congested" : "not congested"}${head === "" ? "" : `; entries read: ${head}`}`);
  lines.push(`refresh budget: ${plan.refresh.budget}; candidates: ${numbers(plan.refresh.candidates)}; planned: ${numbers(plan.refresh.planned)}; deferred: ${numbers(plan.refresh.deferred)}`);
  lines.push("", "ranking (READY, then WAITING, then BLOCKED by owner):");
  if (plan.ranking.length === 0) {
    lines.push("  none");
  }
  plan.ranking.forEach((e, i) => lines.push(rankLine(i, e)));
  lines.push("", `stockpile: ${plan.stockpile.readyNotQueued.length} READY not queued (${numbers(plan.stockpile.readyNotQueued)}); ${plan.stockpile.approvedBehind.length} approved and behind (${numbers(plan.stockpile.approvedBehind)})`);
  lines.push("queue hygiene (UNMERGEABLE in the first positions):");
  if (plan.hygiene.length === 0) {
    lines.push("  none");
  }
  for (const h of plan.hygiene) {
    lines.push(`  #${h.number} ${h.state} at position ${h.position}: ${h.planned ? "dequeue planned" : `not planned (${h.note ?? "unknown"})`}`);
  }
  const runs = plan.orphanRuns;
  lines.push(`orphan runs (in progress, no open PR; never cancelled): ${runs.error !== null ? `unknown (${runs.error})` : String(runs.runs.length)}${runs.truncated ? " (list may be cut)" : ""}`);
  for (const run of runs.runs.slice(0, 10)) {
    lines.push(`  run ${run.id} on ${clean(run.branch)}: ${clean(run.workflow)} (${clean(run.event, 20)})`);
  }
  if (runs.runs.length > 10) {
    lines.push(`  and ${runs.runs.length - 10} more`);
  }
  lines.push("actions:");
  if (plan.actions.length === 0) {
    lines.push("  none");
  }
  plan.actions.forEach((a, i) => lines.push(`  ${i + 1}. ${a.kind} #${a.number}: ${a.detail}${a.pending === null ? "" : ` [${a.pending}]`}`));
  lines.push(`next: ${plan.next}`);
  return lines.join("\n");
}

export function renderResults(results: readonly ActionResult[]): string {
  if (results.length === 0) {
    return "no action ran";
  }
  return results.map((r) => `${r.kind}: ${r.action.kind} #${r.action.number}: ${clean(r.detail, 200)}${r.next === "None." ? "" : ` -> ${r.next}`}`).join("\n");
}

export interface JsonRun {
  readonly mode: "plan" | "apply";
  readonly exit: number;
  readonly plan: Plan | null;
  readonly results: readonly ActionResult[];
  readonly next: string;
  readonly message: string | null;
}

export function jsonOf(run: JsonRun): string {
  return JSON.stringify(
    {
      schema: 1,
      mode: run.mode,
      exit: run.exit,
      next: run.next,
      message: run.message,
      plan: run.plan,
      results: run.results.map((r) => ({ kind: r.kind, action: r.action.kind, number: r.action.number, detail: r.detail, next: r.next })),
    },
    null,
    2,
  );
}
