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
  queued_while_blocked: "pr-merge",
  queue_unmergeable: "pr-merge",
  queue_ejected: "pr-status",
  done_when_unchecked: "human",
  body_template: "pr-refresh",
  gate_failed: "human",
  cross_repository: "pr-status",
  non_required_failing: "pr-status",
  github_disagrees: "human",
};

export function finding(code: FindingCode, kind: FindingKind, detail: string, next: string, items: readonly string[] = []): Finding {
  return { code, kind, detail, next, owner: OWNER[code], items };
}

const LIST_LIMIT = 5;

/** The first five items, then "and N more". The finding keeps the full list in `items`. */
export function listCapped(items: readonly string[]): string {
  return items.length <= LIST_LIMIT
    ? items.join(", ")
    : `${items.slice(0, LIST_LIMIT).join(", ")}, and ${items.length - LIST_LIMIT} more`;
}

const KIND_RANK: Readonly<Record<FindingKind, number>> = { blocker: 0, wait: 1, info: 2 };

/**
 * Headline order of blockers. The first blocker gives the verdict's `next`.
 * Work that changes the head comes first. Review comes last among the code
 * steps, because an earlier step changes the head and the review must be on the
 * final head. Codes in one group have equal rank.
 */
export const HEADLINE_ORDER: readonly (readonly FindingCode[])[] = [
  ["pr_not_open"],
  ["unknown_state"],
  ["stacked", "wrong_base"],
  ["queued_while_blocked"],
  ["conflict", "queue_unmergeable", "behind_base"],
  ["dco_missing"],
  ["check_stale_base"],
  ["threads_unresolved"],
  ["check_failed", "check_not_passing", "check_wrong_source"],
  ["check_flaky", "check_cancelled", "check_missing", "ci_label_needed"],
  ["review_missing", "review_changes_requested", "review_decision", "review_blocking_finding", "review_stale"],
  ["draft"],
  ["body_template", "done_when_unchecked"],
  ["gate_failed"],
  ["github_disagrees"],
];

function headlineRank(code: FindingCode): number {
  const rank = HEADLINE_ORDER.findIndex((group) => group.includes(code));
  return rank < 0 ? HEADLINE_ORDER.length : rank;
}

/** Blockers in headline order, then waits, then info. Inside a rank, the order of FINDING_CODES. Stable. */
export function sortFindings(findings: readonly Finding[]): readonly Finding[] {
  const rank = (f: Finding): number =>
    KIND_RANK[f.kind] * 100_000 + (f.kind === "blocker" ? headlineRank(f.code) * 1000 : 0) + FINDING_CODES.indexOf(f.code);
  return findings
    .map((f, index) => ({ f, index }))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.index - b.index)
    .map((entry) => entry.f);
}

export function short(sha: string): string {
  return sha.slice(0, 7);
}
