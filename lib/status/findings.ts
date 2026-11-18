// Finding builder. The owner of each code is fixed here (design section 4), so
// no call site can name the wrong owner.

import { FINDING_CODES, type Finding, type FindingCode, type FindingKind, type Owner } from "./types.ts";

export const OWNER: Readonly<Record<FindingCode, Owner>> = {
  pr_not_open: "human",
  unknown_state: "pr-status",
  draft: "pr-merge",
  stacked: "human",
  wrong_base: "human",
  conflict: "pr-refresh",
  mergeability_pending: "pr-status",
  behind_base: "pr-refresh",
  check_failed: "human",
  check_flaky: "ci",
  check_cancelled: "ci",
  check_not_passing: "human",
  check_wrong_source: "human",
  check_stale_base: "pr-refresh",
  check_missing: "ci",
  checks_pending: "ci",
  ci_label_needed: "ci",
  review_missing: "reviewer",
  review_changes_requested: "pr-threads",
  review_decision: "reviewer",
  review_blocking_finding: "pr-threads",
  review_stale: "reviewer",
  threads_unresolved: "pr-threads",
  dco_missing: "pr-refresh",
  queued: "pr-merge",
  queue_unmergeable: "pr-merge",
  queue_ejected: "pr-status",
  done_when_unchecked: "human",
  body_template: "pr-refresh",
  gate_failed: "human",
  cross_repository: "pr-status",
  non_required_failing: "pr-status",
  github_disagrees: "human",
};

export function finding(code: FindingCode, kind: FindingKind, detail: string, next: string): Finding {
  return { code, kind, detail, next, owner: OWNER[code] };
}

const KIND_RANK: Readonly<Record<FindingKind, number>> = { blocker: 0, wait: 1, info: 2 };

/** Blockers first, then waits, then info. Inside a kind, the order of FINDING_CODES. Stable. */
export function sortFindings(findings: readonly Finding[]): readonly Finding[] {
  const rank = (f: Finding): number => KIND_RANK[f.kind] * 1000 + FINDING_CODES.indexOf(f.code);
  return findings
    .map((f, index) => ({ f, index }))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.index - b.index)
    .map((entry) => entry.f);
}

export function short(sha: string): string {
  return sha.slice(0, 7);
}
