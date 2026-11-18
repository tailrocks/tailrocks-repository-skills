// Human summary and JSON for a verdict. The JSON keys are stable (schema 1).

import { short } from "./findings.ts";
import type { Verdict } from "./types.ts";

export function renderText(verdict: Verdict): string {
  const head = verdict.headSha === null ? "head unknown" : `head ${short(verdict.headSha)}`;
  const lines = [`${verdict.repo}#${verdict.number}: ${verdict.state} (${head}) -> ${verdict.next}`];
  if (verdict.policySource === "local") {
    lines.push("note: verdict uses a LOCAL policy file; pr-merge refuses it");
  }
  for (const f of verdict.findings) {
    lines.push(`  [${f.kind}] ${f.code} (${f.owner}): ${f.detail}`);
    if (f.kind !== "info") {
      lines.push(`      next: ${f.next}`);
    }
  }
  return lines.join("\n");
}

export function renderOneLine(verdict: Verdict): string {
  const codes = verdict.findings.map((f) => f.code).join(",");
  return `#${verdict.number} ${verdict.state}${codes === "" ? "" : ` ${codes}`}`;
}

/** The stable JSON shape (schema 1). */
export function verdictObject(verdict: Verdict) {
  return {
    schema: verdict.schema,
    repo: verdict.repo,
    number: verdict.number,
    headSha: verdict.headSha,
    state: verdict.state,
    next: verdict.next,
    policySource: verdict.policySource,
    findings: verdict.findings.map((f) => ({
      code: f.code,
      kind: f.kind,
      owner: f.owner,
      detail: f.detail,
      next: f.next,
      items: f.items,
    })),
  };
}

export function toJson(verdict: Verdict): string {
  return JSON.stringify(verdictObject(verdict), null, 2);
}
