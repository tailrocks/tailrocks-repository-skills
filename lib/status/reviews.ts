// Review findings for both sources (design section 5, "Reviews").

import type { Policy } from "../policy/types.ts";
import { finding, short } from "./findings.ts";
import { sameLogin } from "./text.ts";
import type { Finding, PrSnapshot, ReviewObservation } from "./types.ts";

const WRITER_ASSOCIATIONS: ReadonlySet<string> = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

function compile(pattern: string, flags: string): RegExp | null {
  if (pattern === "") {
    return null;
  }
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

function isAuthor(login: string, snapshot: PrSnapshot): boolean {
  return sameLogin(login, snapshot.author);
}

function counted(review: ReviewObservation, snapshot: PrSnapshot, policy: Policy): boolean {
  if (!policy.review.count_author && isAuthor(review.author, snapshot)) {
    return false;
  }
  const reviewers = policy.review.reviewers;
  return reviewers.length > 0
    ? reviewers.some((login) => sameLogin(login, review.author))
    : WRITER_ASSOCIATIONS.has(review.association);
}

interface Verdict {
  readonly kind: "approve" | "changes";
  readonly review: ReviewObservation;
  readonly blocking: boolean;
}

function githubApproval(snapshot: PrSnapshot, policy: Policy): readonly Finding[] {
  const out: Finding[] = [];
  const asking = snapshot.latestOpinionatedReviews.filter(
    (r) => r.state === "CHANGES_REQUESTED" && (policy.review.count_author || !isAuthor(r.author, snapshot)),
  );
  if (asking.length > 0) {
    out.push(
      finding(
        "review_changes_requested",
        "blocker",
        `changes requested by ${asking.map((r) => r.author).join(", ")}`,
        "Triage the review threads with pr-threads, fix, then ask for a new review",
      ),
    );
  }
  const { requiredApprovingReviewCount: count, requireCodeOwnerReview: owners } = snapshot.rules;
  if ((count > 0 || owners) && snapshot.reviewDecision !== "APPROVED") {
    out.push(
      finding(
        "review_decision",
        "blocker",
        `branch rules need ${count > 0 ? `${count} approval${count === 1 ? "" : "s"}` : "a code-owner review"}; reviewDecision is ${snapshot.reviewDecision ?? "empty"}`,
        "Request a review from an eligible reviewer",
      ),
    );
  }
  return out;
}

function commentVerdict(snapshot: PrSnapshot, policy: Policy): readonly Finding[] {
  const { review: rule } = policy;
  const approve = compile(rule.approve_pattern, rule.flags);
  const changes = compile(rule.changes_pattern, rule.flags);
  const blocking = compile(rule.blocking_pattern, rule.flags);
  if (approve === null || changes === null) {
    return [
      finding("unknown_state", "blocker", "the review patterns of the policy are not usable", "Fix the policy with validate, then run pr-status again"),
    ];
  }
  const equivalent = new Set<string>([snapshot.headSha]);
  if (rule.carry_over === "clean-base-merge") {
    for (const step of snapshot.git.reviewEquivalentHeads) {
      equivalent.add(step.sha);
    }
  }

  const reviews = snapshot.reviews
    .filter((r) => counted(r, snapshot, policy) && r.state !== "DISMISSED" && r.state !== "PENDING")
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));

  const latest = new Map<string, Verdict>();
  for (const review of reviews) {
    const key = review.author.toLowerCase();
    if (changes.test(review.body)) {
      latest.set(key, { kind: "changes", review, blocking: false });
    } else if (approve.test(review.body)) {
      latest.set(key, { kind: "approve", review, blocking: blocking?.test(review.body) ?? false });
    }
  }

  const out: Finding[] = [];
  const verdicts = [...latest.values()];
  const asking = verdicts.filter((v) => v.kind === "changes");
  if (asking.length > 0) {
    out.push(
      finding(
        "review_changes_requested",
        "blocker",
        `latest verdict asks for changes: ${asking.map((v) => `${v.review.author} on ${short(v.review.commit ?? "unknown")}`).join(", ")}`,
        "Triage the review threads with pr-threads, fix, then ask for a new review",
      ),
    );
    return out;
  }

  const approvals = verdicts.filter((v) => v.kind === "approve");
  const onHead = approvals.filter((v) => v.review.commit !== null && equivalent.has(v.review.commit));
  const clean = onHead.filter((v) => !v.blocking);

  const laterBlocking: ReviewObservation[] = [];
  if (blocking !== null) {
    for (const approval of clean) {
      for (const review of reviews) {
        if (review.submittedAt > approval.review.submittedAt && blocking.test(review.body) && !approve.test(review.body)) {
          laterBlocking.push(review);
        }
      }
    }
  }
  if (onHead.some((v) => v.blocking) && clean.length === 0) {
    out.push(
      finding(
        "review_blocking_finding",
        "blocker",
        `the approval by ${onHead.map((v) => v.review.author).join(", ")} also lists a blocking finding`,
        "Fix or defer the finding with pr-threads, then ask for a new review",
      ),
    );
    return out;
  }
  if (laterBlocking.length > 0) {
    out.push(
      finding(
        "review_blocking_finding",
        "blocker",
        `a review after the approval lists a blocking finding: ${[...new Set(laterBlocking.map((r) => r.author))].join(", ")}`,
        "Fix or defer the finding with pr-threads, then ask for a new review",
      ),
    );
    return out;
  }
  if (clean.length > 0) {
    return out;
  }
  if (approvals.length > 0) {
    const why =
      rule.carry_over !== "clean-base-merge"
        ? "carry-over is off"
        : !snapshot.git.available
          ? `carry-over is unknown because git facts are unavailable (${snapshot.git.unavailableBecause ?? "no reason"})`
          : (snapshot.git.carryStoppedBecause ?? "carry-over does not reach the reviewed head");
    out.push(
      finding(
        "review_stale",
        "blocker",
        `the approval is on ${approvals.map((v) => short(v.review.commit ?? "unknown")).join(", ")}, not on ${short(snapshot.headSha)}; ${why}`,
        "Request a review of the current head",
      ),
    );
    return out;
  }
  out.push(finding("review_missing", "blocker", `no approving verdict on ${short(snapshot.headSha)}`, "Request a review of the current head"));
  return out;
}

export function reviewFindings(snapshot: PrSnapshot, policy: Policy): readonly Finding[] {
  return policy.review.source === "github-approval" ? githubApproval(snapshot, policy) : commentVerdict(snapshot, policy);
}
