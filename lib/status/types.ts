// Snapshot and verdict types (design section 4). A snapshot holds every fact
// that `evaluate` needs, so a recorded snapshot is a test fixture.

import type { PolicySource } from "../policy/types.ts";
import type { RepoSlug, Sha } from "../types.ts";

export type CheckConclusion =
  | "success"
  | "failure"
  | "cancelled"
  | "timed_out"
  | "action_required"
  | "neutral"
  | "skipped"
  | "stale"
  | "startup_failure";

export type CheckStatus = "queued" | "in_progress" | "completed" | "waiting" | "pending" | "requested";

export interface CheckObservation {
  readonly name: string;
  readonly kind: "check_run" | "status_context";
  readonly status: CheckStatus;
  /** A status context maps SUCCESS to success, FAILURE and ERROR to failure, and EXPECTED and PENDING to status "pending". */
  readonly conclusion: CheckConclusion | null;
  /** GitHub's own `isRequired(pullRequestNumber:)`. */
  readonly isRequired: boolean;
  /** Numeric id of the app that reports the check. Null for a status context. */
  readonly appId: number | null;
  readonly workflow: string | null;
  readonly event: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  /** Database id of the check run. A later attempt has a higher id. Null for a status context. */
  readonly runId: number | null;
  /** Number of attempts seen on the head for this (workflow, name). */
  readonly attempts: number;
  /** Number of those attempts that failed. */
  readonly failedAttempts: number;
}

export type AuthorAssociation =
  | "OWNER"
  | "MEMBER"
  | "COLLABORATOR"
  | "CONTRIBUTOR"
  | "FIRST_TIME_CONTRIBUTOR"
  | "FIRST_TIMER"
  | "MANNEQUIN"
  | "NONE";

export type ReviewState = "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";

export interface ReviewObservation {
  readonly author: string;
  readonly association: AuthorAssociation;
  readonly state: ReviewState;
  readonly body: string;
  readonly commit: Sha | null;
  readonly submittedAt: string;
}

/** One entry of `latestOpinionatedReviews(writersOnly: true)`. */
export interface OpinionatedReview {
  readonly author: string;
  readonly association: AuthorAssociation;
  readonly state: ReviewState;
  readonly commit: Sha | null;
}

export type ReviewDecision = "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED";

export interface ThreadObservation {
  readonly id: string;
  readonly isResolved: boolean;
  readonly isOutdated: boolean;
  readonly path: string | null;
  readonly line: number | null;
  readonly firstAuthor: string;
  readonly firstBody: string;
  readonly lastAuthor: string;
  readonly commentCount: number;
}

export interface CommitObservation {
  readonly oid: Sha;
  readonly parents: readonly Sha[];
  readonly tree: Sha;
  /** Full message including trailers. */
  readonly message: string;
  readonly authorLogin: string | null;
  readonly authorEmail: string;
  readonly committedDate: string;
}

export type QueueState = "QUEUED" | "AWAITING_CHECKS" | "MERGEABLE" | "UNMERGEABLE" | "LOCKED";

export interface QueueEntry {
  readonly id: string;
  readonly position: number;
  readonly state: QueueState;
  readonly jump: boolean;
  readonly enqueuedAt: string;
}

export interface QueueRemoval {
  readonly at: string;
  /** Free text from GitHub. Seen: merge_conflict, failed_checks, checks_timed_out, manual. */
  readonly reason: string;
  readonly beforeCommit: Sha | null;
  /** True when the head has not changed since the removal. */
  readonly afterLastPush: boolean;
}

export interface LinkedIssue {
  readonly number: number;
  readonly state: "OPEN" | "CLOSED";
  readonly body: string;
  readonly via: "closing" | "body";
}

export interface RequiredCheck {
  readonly name: string;
  /** Numeric app id that the rule names. Null means any source. */
  readonly appId: number | null;
  readonly source: "ruleset" | "protection";
}

export interface RulesFacts {
  readonly requiredChecks: readonly RequiredCheck[];
  readonly strictUpToDate: boolean;
  readonly mergeQueue: boolean;
  readonly queueLength: number | null;
  readonly requiredApprovingReviewCount: number;
  readonly requireCodeOwnerReview: boolean;
  readonly dismissStaleReviewsOnPush: boolean;
  readonly threadResolutionRequired: boolean;
  readonly allowedMergeMethods: readonly string[];
  /** False when the rules could not be read. */
  readonly known: boolean;
}

export type CarryStep = "head" | "empty_commit" | "clean_base_merge" | "trailer_rewrite";

export interface GitFacts {
  /** False when any git step failed. Carry-over is then unknown. */
  readonly available: boolean;
  readonly unavailableBecause: string | null;
  /** [0] is the head. Each later entry says why it is review-equivalent. */
  readonly reviewEquivalentHeads: readonly { readonly sha: Sha; readonly via: CarryStep }[];
  readonly carryStoppedBecause: string | null;
}

export interface BodyTemplate {
  /** Headings of the template file at the default-branch commit (`defaultSha`). */
  readonly headings: readonly string[];
}

/**
 * Snapshot schema 2 added `defaultSha`. A schema 1 file still loads: its policy was read at the
 * base commit, so `parseSnapshot` sets `defaultSha` to `baseSha` for it. Every snapshot in memory is schema 2.
 */
export interface PrSnapshot {
  readonly schema: 2;
  readonly capturedAt: string;
  readonly repo: RepoSlug;
  readonly defaultBranch: string;
  readonly number: number;
  /** GraphQL node id. Writing skills need it. */
  readonly nodeId: string;
  readonly state: "OPEN" | "CLOSED" | "MERGED";
  readonly isDraft: boolean;
  readonly isCrossRepository: boolean;
  readonly author: string;
  readonly title: string;
  readonly body: string;
  readonly baseRef: string;
  readonly baseSha: Sha;
  /** The default branch tip when the PR was read. The policy comes from this commit, never from the base of a stacked PR. */
  readonly defaultSha: Sha;
  readonly headRef: string;
  readonly headSha: Sha;
  readonly mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  readonly mergeStateStatus: string;
  readonly reviewDecision: ReviewDecision | null;
  readonly behindBy: number | null;
  readonly labels: readonly string[];
  readonly checks: readonly CheckObservation[];
  readonly checksTruncated: boolean;
  readonly reviews: readonly ReviewObservation[];
  readonly reviewsTruncated: boolean;
  readonly latestOpinionatedReviews: readonly OpinionatedReview[];
  readonly threads: readonly ThreadObservation[];
  readonly threadsTruncated: boolean;
  readonly commits: readonly CommitObservation[];
  readonly commitsTruncated: boolean;
  readonly queueEntry: QueueEntry | null;
  readonly lastQueueRemoval: QueueRemoval | null;
  readonly linkedIssues: readonly LinkedIssue[];
  readonly parentPr: number | null;
  readonly rules: RulesFacts;
  readonly bodyTemplate: BodyTemplate | null;
  readonly git: GitFacts;
  /** Parse and read problems found while gathering. Any entry gives `unknown_state`. */
  readonly problems: readonly string[];
}

// ---------- Verdict ----------

export type VerdictState = "READY" | "BLOCKED" | "WAITING";

export type Owner =
  | "pr-status"
  | "pr-create"
  | "pr-refresh"
  | "pr-threads"
  | "pr-merge"
  | "reviewer"
  | "ci"
  | "human";

export type FindingKind = "blocker" | "wait" | "info";

export const FINDING_CODES = [
  "pr_not_open",
  "unknown_state",
  "draft",
  "stacked",
  "wrong_base",
  "conflict",
  "mergeability_pending",
  "behind_base",
  "check_failed",
  "check_flaky",
  "check_cancelled",
  "check_not_passing",
  "check_wrong_source",
  "check_stale_base",
  "check_missing",
  "checks_pending",
  "ci_label_needed",
  "review_missing",
  "review_changes_requested",
  "review_decision",
  "review_blocking_finding",
  "review_stale",
  "threads_unresolved",
  "dco_missing",
  "queued",
  "queued_while_blocked",
  "queue_unmergeable",
  "queue_ejected",
  "done_when_unchecked",
  "body_template",
  "gate_failed",
  "cross_repository",
  "non_required_failing",
  "github_disagrees",
] as const;

export type FindingCode = (typeof FINDING_CODES)[number];

export interface Finding {
  readonly code: FindingCode;
  readonly kind: FindingKind;
  readonly detail: string;
  readonly next: string;
  readonly owner: Owner;
  /** The full list behind a list-valued detail (the detail shows the first five). Empty otherwise. */
  readonly items: readonly string[];
}

export interface Verdict {
  readonly schema: 1;
  readonly repo: RepoSlug;
  readonly number: number;
  /** Null when no snapshot could be read. */
  readonly headSha: Sha | null;
  readonly state: VerdictState;
  readonly findings: readonly Finding[];
  readonly next: string;
  readonly policySource: PolicySource;
}
