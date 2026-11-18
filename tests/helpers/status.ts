// Builders for status tests: a green snapshot, and policies from TOML text.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultPolicy, loadPolicy } from "../../lib/policy/load.ts";
import type { Policy } from "../../lib/policy/types.ts";
import type { CheckObservation, PrSnapshot, ReviewObservation } from "../../lib/status/types.ts";
import { parseRepoSlug, parseSha, type Sha } from "../../lib/types.ts";

export const root = join(import.meta.dir, "..", "..");

function must<T>(r: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }): T {
  if (!r.ok) {
    throw new Error(r.error);
  }
  return r.value;
}

export function sha(char: string): Sha {
  return must(parseSha(char.repeat(40)));
}

export const HEAD = sha("a");
export const OLD = sha("b");
export const BASE = sha("c");

export function policyFromText(text: string): Policy {
  const r = loadPolicy({ text, source: "local" });
  if (!r.ok) {
    throw new Error(r.errors.map((e) => e.message).join("; "));
  }
  return r.policy;
}

export function examplePolicy(): Policy {
  return policyFromText(readFileSync(join(root, "examples", "comment-verdict-merge-queue.toml"), "utf8"));
}

export function builtinPolicy(): Policy {
  const r = defaultPolicy();
  if (!r.ok) {
    throw new Error("default policy invalid");
  }
  return r.policy;
}

/** The example policy with extra TOML appended to a section list, for one-off changes. */
export function exampleWith(patch: (policy: Policy) => Policy): Policy {
  return patch(examplePolicy());
}

export function check(name: string, patch: Partial<CheckObservation> = {}): CheckObservation {
  return {
    name,
    kind: "check_run",
    status: "completed",
    conclusion: "success",
    isRequired: false,
    appId: 15368,
    workflow: "CI",
    event: "pull_request",
    startedAt: "2026-01-01T00:00:00Z",
    completedAt: "2026-01-01T00:01:00Z",
    attempts: 1,
    failedAttempts: 0,
    ...patch,
  };
}

export function verdictReview(author: string, body: string, commit: Sha, submittedAt: string): ReviewObservation {
  return { author, association: "MEMBER", state: "COMMENTED", body, commit, submittedAt };
}

/** A snapshot that the example policy accepts as READY. */
export function green(patch: Partial<PrSnapshot> = {}): PrSnapshot {
  return {
    schema: 1,
    capturedAt: "2026-01-02T00:00:00Z",
    repo: must(parseRepoSlug("example-org/example-repo")),
    defaultBranch: "main",
    number: 7,
    nodeId: "PR_example_7",
    state: "OPEN",
    isDraft: false,
    isCrossRepository: false,
    author: "user-a",
    title: "Example change 7",
    body: "",
    baseRef: "main",
    baseSha: BASE,
    headRef: "feature/7",
    headSha: HEAD,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: null,
    behindBy: 0,
    labels: ["ci:auto"],
    checks: [check("Required", { isRequired: true }), check("Required verdict", { isRequired: true })],
    checksTruncated: false,
    reviews: [verdictReview("user-b", "Verdict: approve\n\nLooks fine.", HEAD, "2026-01-01T12:00:00Z")],
    reviewsTruncated: false,
    latestOpinionatedReviews: [],
    threads: [],
    threadsTruncated: false,
    commits: [
      {
        oid: HEAD,
        parents: [OLD],
        tree: sha("1"),
        message: "commit aaaaaaa\n\nSigned-off-by: user-a <user-a@example.com>",
        authorLogin: "user-a",
        authorEmail: "user-a@example.com",
        committedDate: "2026-01-01T00:00:00Z",
      },
    ],
    commitsTruncated: false,
    queueEntry: null,
    lastQueueRemoval: null,
    linkedIssues: [],
    parentPr: null,
    rules: {
      requiredChecks: [
        { name: "Required", appId: null, source: "ruleset" },
        { name: "Required verdict", appId: null, source: "ruleset" },
      ],
      strictUpToDate: false,
      mergeQueue: true,
      queueLength: 3,
      requiredApprovingReviewCount: 0,
      requireCodeOwnerReview: false,
      dismissStaleReviewsOnPush: true,
      threadResolutionRequired: true,
      allowedMergeMethods: ["squash"],
      known: true,
    },
    bodyTemplate: null,
    git: {
      available: true,
      unavailableBecause: null,
      reviewEquivalentHeads: [{ sha: HEAD, via: "head" }],
      carryStoppedBecause: null,
    },
    problems: [],
    ...patch,
  };
}
