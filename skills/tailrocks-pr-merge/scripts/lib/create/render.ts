// Text and JSON output. Commit subjects, issue titles, and branch names are
// untrusted: the output drops control characters, so no terminal escape passes.

import type { OpenReport } from "./open.ts";
import type { SignoffResult } from "./signoff.ts";
import type { Finding, Plan } from "./types.ts";

export function clean(text: string): string {
  return text.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]+/g, " ");
}

function findingLines(f: Finding): readonly string[] {
  return [
    `  [${f.kind}] ${f.code}: ${clean(f.detail)}`,
    ...f.items.map((item) => `      - ${clean(item)}`),
    ...(f.next === "None." ? [] : [`      next: ${clean(f.next)}`]),
  ];
}

export function renderPlanText(plan: Plan): string {
  const base = plan.base.stackedOn === null ? plan.base.ref : `${plan.base.ref} (stacked on PR #${plan.base.stackedOn.number})`;
  const lines = [
    `${plan.repo}: plan for ${clean(plan.headBranch ?? "(no branch)")} -> ${clean(base)}`,
    `head: ${plan.headSha}`,
    `policy: ${plan.policySource}`,
    `commits: ${plan.commitCount}; remote branch: ${plan.relation}`,
    plan.existing === null ? "pull request: none yet" : `pull request: #${plan.existing.number} ${plan.existing.url}`,
    `title: ${plan.title === null ? "(none)" : clean(plan.title)}`,
    `mode: ${plan.draft ? "draft" : "ready"}`,
    `labels: ${plan.labels.length === 0 ? "(none)" : plan.labels.map(clean).join(", ")}`,
  ];
  if (plan.issue !== null) {
    lines.push(`issue: #${plan.issue.number} ${clean(plan.issue.title)} (${plan.issue.state.toLowerCase()}); open Done-when boxes: ${plan.issue.unchecked.length}`);
  }
  if (plan.link !== null) {
    lines.push(`link: ${plan.link.line} (${plan.link.reason})`);
  }
  if (plan.prepushRan.length > 0) {
    lines.push(`pre-push steps run: ${plan.prepushRan.join(", ")}`);
  }
  if (plan.finalBody !== null) {
    lines.push("body: valid");
  }
  for (const f of plan.findings) {
    lines.push(...findingLines(f));
  }
  if (plan.skeleton !== null) {
    lines.push("body skeleton (HTML comments are instructions; open removes them):", "-----", plan.skeleton, "-----");
  }
  lines.push(`next: ${clean(plan.next)}`);
  return lines.join("\n");
}

export function planObject(plan: Plan) {
  return {
    schema: 1,
    mode: "plan",
    repo: plan.repo,
    exit: plan.exit,
    head: plan.headSha,
    branch: plan.headBranch,
    base: plan.base,
    policySource: plan.policySource,
    remote: { name: plan.remote, head: plan.remoteHead, relation: plan.relation },
    commits: plan.commitCount,
    existing: plan.existing,
    title: plan.title,
    draft: plan.draft,
    labels: plan.labels,
    issue: plan.issue,
    link: plan.link,
    requiredHeadings: plan.requiredHeadings,
    skeleton: plan.skeleton,
    bodyValid: plan.finalBody !== null,
    prepushRan: plan.prepushRan,
    findings: plan.findings,
    next: plan.next,
  };
}

export function renderOpenText(report: OpenReport): string {
  const { plan, pr } = report;
  const lines: string[] = [];
  if (pr !== null) {
    lines.push(`${plan.repo}: PR #${pr.number} ${report.created ? "opened" : "kept"} (${pr.isDraft ? "draft" : "ready"}) ${pr.url}`);
  } else {
    lines.push(`${plan.repo}: no PR`);
  }
  lines.push(report.pushed ? `pushed: ${plan.headSha.slice(0, 7)} to ${plan.remote}/${clean(plan.headBranch ?? "")}` : "pushed: nothing to push");
  if (report.labelsAdded.length > 0) {
    lines.push(`labels added: ${report.labelsAdded.map(clean).join(", ")}`);
  }
  for (const note of report.notes) {
    lines.push(`note: ${clean(note)}`);
  }
  for (const problem of report.problems) {
    lines.push(`PROBLEM: ${clean(problem)}`);
  }
  lines.push(`head: ${plan.headSha}`, `next: ${clean(report.next)}`);
  return lines.join("\n");
}

export function openObject(report: OpenReport, exit: number) {
  return {
    schema: 1,
    mode: "open",
    repo: report.plan.repo,
    exit,
    head: report.plan.headSha,
    pushed: report.pushed,
    created: report.created,
    pr: report.pr,
    labelsAdded: report.labelsAdded,
    notes: report.notes,
    problems: report.problems,
    findings: report.findings,
    next: report.next,
  };
}

export function renderRefusalText(reasons: readonly string[]): string {
  return ["REFUSED, nothing was written", ...reasons.map((r) => `  ${clean(r)}`)].join("\n");
}

type Done = Extract<SignoffResult, { readonly kind: "done" }>;

export function renderSignoffText(done: Done): string {
  return [
    `signed off ${done.trailersAdded} commit${done.trailersAdded === 1 ? "" : "s"} on ${clean(done.branch)}; trees unchanged (old ${done.oldHead.slice(0, 7)} -> new ${done.newHead.slice(0, 7)})`,
    ...(done.reparented > 0 ? [`${done.reparented} commit${done.reparented === 1 ? "" : "s"} moved onto the new parents with no change`] : []),
    `head: ${done.newHead}`,
    "next: Run plan again. Nothing was pushed.",
  ].join("\n");
}

export function signoffObject(done: Done) {
  return {
    schema: 1,
    mode: "signoff",
    exit: 0,
    branch: done.branch,
    oldHead: done.oldHead,
    head: done.newHead,
    trailersAdded: done.trailersAdded,
    reparented: done.reparented,
    next: "Run plan again. Nothing was pushed.",
  };
}
