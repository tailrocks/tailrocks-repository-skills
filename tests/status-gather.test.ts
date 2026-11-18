import { describe, expect, test } from "bun:test";
import { gatherBodyTemplate, gatherPr, newGatherCache } from "../lib/github/gather.ts";
import { parseClassicProtection, parseRulesetRules, gatherRules } from "../lib/github/rules.ts";
import { baseResponse, commitNode, ctxRun, fail, fakeGh, prResponse, thread } from "./helpers/fake-gh.ts";
import { BASE, HEAD, OLD } from "./helpers/status.ts";
import { parseRepoSlug } from "../lib/types.ts";

const repo = (() => {
  const r = parseRepoSlug("example-org/example-repo");
  if (!r.ok) throw new Error("slug");
  return r.value;
})();

const noSleep = async (): Promise<void> => undefined;
const rulesReply = [
  { type: "pull_request", parameters: { required_approving_review_count: 1, require_code_owner_review: false, dismiss_stale_reviews_on_push: true, required_review_thread_resolution: true, allowed_merge_methods: ["squash"] } },
  { type: "required_status_checks", parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: "Required", integration_id: 15368 }, { context: "Other" }] } },
  { type: "merge_queue", parameters: {} },
  { type: "deletion" },
];

function gh(pr: unknown = prResponse(), base: unknown = baseResponse(), extra: Record<string, (v: Record<string, string>) => unknown> = {}) {
  return fakeGh(
    { pr: () => pr, base: () => base, issue: () => ({ data: { repository: { issueOrPullRequest: null } } }), ...extra },
    { "repos/example-org/example-repo/rules/branches/main": rulesReply, "repos/example-org/example-repo/branches/main": { protected: true, protection: { enabled: false } } },
  );
}

async function gather(fake = gh(), options = {}) {
  return gatherPr(repo, 7, { cwd: "/", run: fake.run, sleep: noSleep, ...options });
}

describe("gatherPr", () => {
  test("reads a pull request into a snapshot", async () => {
    const result = await gather();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const s = result.snapshot;
    expect(s.number).toBe(7);
    expect(s.headSha).toBe(HEAD);
    expect(s.baseSha).toBe(BASE);
    expect(s.labels).toEqual(["ci:auto"]);
    expect(s.behindBy).toBe(3);
    expect(s.rules.mergeQueue).toBe(true);
    expect(s.rules.queueLength).toBe(4);
    expect(s.rules.requiredApprovingReviewCount).toBe(1);
    expect(s.rules.strictUpToDate).toBe(true);
    expect(s.rules.threadResolutionRequired).toBe(true);
    expect(s.rules.requiredChecks.map((c) => [c.name, c.appId])).toEqual([["Required", 15368], ["Other", null]]);
    expect(s.problems).toEqual([]);
    expect(result.cost).toBe(2);
  });

  test("every gh call passes the real allow-list and no call writes", async () => {
    const fake = gh();
    await gather(fake);
    expect(fake.calls.length).toBeGreaterThan(3);
    for (const args of fake.calls) {
      expect(args.includes("-X") ? args[args.indexOf("-X") + 1] : "GET").toBe("GET");
    }
  });

  test("keeps the latest attempt per (workflow, check) and counts attempts", async () => {
    const nodes = [
      ctxRun("Build", { startedAt: "2026-01-01T00:00:00Z", conclusion: "FAILURE" }),
      ctxRun("Build", { startedAt: "2026-01-01T00:10:00Z", conclusion: "SUCCESS" }),
      ctxRun("Build", { startedAt: "2026-01-01T00:05:00Z", conclusion: "FAILURE" }),
      ctxRun("Build", { checkSuite: { app: { databaseId: 15368 }, workflowRun: { event: "push", workflow: { name: "Other" } } } }),
      { __typename: "StatusContext", context: "legacy/ci", state: "EXPECTED", createdAt: "2026-01-01T00:00:00Z", isRequired: true },
      { __typename: "StatusContext", context: "legacy/done", state: "ERROR", createdAt: "2026-01-01T00:00:00Z", isRequired: false },
    ];
    const pr = prResponse({
      latestCommit: { nodes: [{ commit: { id: "C", oid: HEAD, statusCheckRollup: { contexts: { totalCount: 6, pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } }] },
    });
    const result = await gather(gh(pr));
    if (!result.ok) throw new Error(result.error);
    const byKey = new Map(result.snapshot.checks.map((c) => [`${c.workflow ?? ""}/${c.name}`, c]));
    const ci = byKey.get("CI/Build");
    expect([ci?.conclusion, ci?.attempts, ci?.failedAttempts]).toEqual(["success", 3, 2]);
    expect(byKey.get("Other/Build")?.attempts).toBe(1);
    const expected = byKey.get("/legacy/ci");
    expect([expected?.status, expected?.conclusion, expected?.kind, expected?.isRequired, expected?.appId]).toEqual(["pending", null, "status_context", true, null]);
    expect([byKey.get("/legacy/done")?.status, byKey.get("/legacy/done")?.conclusion]).toEqual(["completed", "failure"]);
  });

  test("an unreadable check becomes a problem and the others stay", async () => {
    const nodes = [ctxRun("Good"), ctxRun("Bad", { status: "WEIRD" }), { __typename: "Mystery" }];
    const pr = prResponse({
      latestCommit: { nodes: [{ commit: { id: "C", oid: HEAD, statusCheckRollup: { contexts: { totalCount: 3, pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } }] },
    });
    const result = await gather(gh(pr));
    if (!result.ok) throw new Error(result.error);
    expect(result.snapshot.checks.map((c) => c.name)).toEqual(["Good"]);
    expect(result.snapshot.problems.length).toBe(2);
    expect(result.snapshot.problems.join(" ")).toContain("WEIRD");
  });

  test("follows thread pages", async () => {
    const first = prResponse({ reviewThreads: { totalCount: 3, pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [thread(1), thread(2)] } });
    const fake = gh(first, baseResponse(), {
      threads: (v) => ({ data: { node: { reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: v["after"] === "c1" ? [thread(3)] : [] } } } }),
    });
    const result = await gather(fake);
    if (!result.ok) throw new Error(result.error);
    expect(result.snapshot.threads.map((t) => t.id)).toEqual(["T1", "T2", "T3"]);
    expect(result.snapshot.threadsTruncated).toBe(false);
    expect(result.snapshot.threads[0]?.firstAuthor).toBe("some-bot");
  });

  test("marks threads truncated when pages never end", async () => {
    const forever = { pageInfo: { hasNextPage: true, endCursor: "c" }, nodes: [thread(1)] };
    const fake = gh(prResponse({ reviewThreads: { totalCount: 999, ...forever } }), baseResponse(), { threads: () => ({ data: { node: { reviewThreads: forever } } }) });
    const result = await gather(fake);
    if (!result.ok) throw new Error(result.error);
    expect(result.snapshot.threadsTruncated).toBe(true);
    expect(fake.calls.filter((c) => c.some((a) => a.startsWith("after="))).length).toBe(9);
  });

  test("follows check pages and marks them truncated when they never end", async () => {
    const pr = prResponse({
      latestCommit: { nodes: [{ commit: { id: "C", oid: HEAD, statusCheckRollup: { contexts: { totalCount: 2, pageInfo: { hasNextPage: true, endCursor: "k" }, nodes: [ctxRun("One")] } } } }] },
    });
    const ok = await gather(gh(pr, baseResponse(), { contexts: () => ({ data: { node: { statusCheckRollup: { contexts: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [ctxRun("Two")] } } } } }) }));
    if (!ok.ok) throw new Error(ok.error);
    expect(ok.snapshot.checks.map((c) => c.name)).toEqual(["One", "Two"]);
    expect(ok.snapshot.checksTruncated).toBe(false);
    const endless = await gather(gh(pr, baseResponse(), { contexts: () => ({ data: { node: { statusCheckRollup: { contexts: { pageInfo: { hasNextPage: true, endCursor: "k" }, nodes: [] } } } } }) }));
    if (!endless.ok) throw new Error(endless.error);
    expect(endless.snapshot.checksTruncated).toBe(true);
  });

  const reviewNode = (n: number) => ({ author: { login: `dev-${n}` }, authorAssociation: "MEMBER", state: "COMMENTED", body: `r${n}`, submittedAt: "2026-01-01T00:00:00Z", commit: { oid: HEAD } });
  const sha40 = (n: number) => n.toString(16).padStart(40, "0");

  test("follows review and commit pages backward past 100", async () => {
    const last = Array.from({ length: 100 }, (_, i) => reviewNode(150 + i));
    const earlier = Array.from({ length: 50 }, (_, i) => reviewNode(100 + i));
    const lastCommits = Array.from({ length: 100 }, (_, i) => commitNode(sha40(1000 + i), [OLD]));
    const earlierCommits = Array.from({ length: 20 }, (_, i) => commitNode(sha40(900 + i), [OLD]));
    const pr = prResponse({
      reviews: { totalCount: 150, pageInfo: { hasPreviousPage: true, startCursor: "r1" }, nodes: last },
      commits: { totalCount: 120, pageInfo: { hasPreviousPage: true, startCursor: "c1" }, nodes: lastCommits },
    });
    const fake = gh(pr, baseResponse(), {
      reviews: (v) => ({ data: { node: { reviews: { pageInfo: { hasPreviousPage: false, startCursor: null }, nodes: v["before"] === "r1" ? earlier : [] } } } }),
      commits: (v) => ({ data: { node: { commits: { pageInfo: { hasPreviousPage: false, startCursor: null }, nodes: v["before"] === "c1" ? earlierCommits : [] } } } }),
    });
    const result = await gather(fake);
    if (!result.ok) throw new Error(result.error);
    expect(result.snapshot.reviews.length).toBe(150);
    expect(result.snapshot.reviews[0]?.author).toBe("dev-100");
    expect(result.snapshot.reviews.at(-1)?.author).toBe("dev-249");
    expect(result.snapshot.commits.length).toBe(120);
    expect<string | undefined>(result.snapshot.commits[0]?.oid).toBe(sha40(900));
    expect(result.snapshot.reviewsTruncated).toBe(false);
    expect(result.snapshot.commitsTruncated).toBe(false);
  });

  test("marks reviews and commits truncated only when the hard cap is hit", async () => {
    const page = (n: number) => Array.from({ length: 100 }, (_, i) => reviewNode(n + i));
    const pr = prResponse({
      reviews: { totalCount: 5000, pageInfo: { hasPreviousPage: true, startCursor: "r" }, nodes: page(0) },
      commits: { totalCount: 5000, pageInfo: { hasPreviousPage: true, startCursor: "c" }, nodes: [commitNode(HEAD, [OLD])] },
    });
    const fake = gh(pr, baseResponse(), {
      reviews: () => ({ data: { node: { reviews: { pageInfo: { hasPreviousPage: true, startCursor: "r" }, nodes: page(0) } } } }),
      commits: () => ({ data: { node: { commits: { pageInfo: { hasPreviousPage: true, startCursor: "c" }, nodes: [commitNode(HEAD, [OLD])] } } } }),
    });
    const result = await gather(fake);
    if (!result.ok) throw new Error(result.error);
    expect(result.snapshot.reviewsTruncated).toBe(true);
    expect(result.snapshot.commitsTruncated).toBe(true);
    expect(result.snapshot.reviews.length).toBe(1000);
  });

  test("reads reviews with author association and the writers-only list", async () => {
    const review = (login: string, assoc: string, state: string, body: string) => ({ author: { login }, authorAssociation: assoc, state, body, submittedAt: "2026-01-01T00:00:00Z", commit: { oid: HEAD } });
    const pr = prResponse({
      reviews: { totalCount: 2, pageInfo: { hasPreviousPage: false, startCursor: null }, nodes: [review("dev-b", "MEMBER", "COMMENTED", "Verdict: approve"), { ...review("x", "NONE", "COMMENTED", ""), author: null }] },
      latestOpinionatedReviews: { totalCount: 1, nodes: [{ author: { login: "dev-b" }, authorAssociation: "MEMBER", state: "APPROVED", commit: { oid: HEAD } }] },
      reviewDecision: "APPROVED",
    });
    const result = await gather(gh(pr));
    if (!result.ok) throw new Error(result.error);
    expect(result.snapshot.reviews.map((r) => [r.author, r.association])).toEqual([["dev-b", "MEMBER"], ["ghost", "NONE"]]);
    expect(result.snapshot.latestOpinionatedReviews[0]?.state).toBe("APPROVED");
    expect(result.snapshot.reviewDecision).toBe("APPROVED");
  });

  test("reads linked issues from closing references and from the body", async () => {
    const pr = prResponse({
      body: "Part of #12\nRefs other-org/other#99\nCloses #7\n```\nCloses #40\n```",
      closingIssuesReferences: { nodes: [{ number: 11, repository: { nameWithOwner: "example-org/example-repo" } }, { number: 98, repository: { nameWithOwner: "other-org/other" } }] },
    });
    const asked: string[] = [];
    const fake = gh(pr, baseResponse(), {
      issue: (v) => {
        asked.push(v["number"] ?? "");
        return { data: { repository: { issueOrPullRequest: v["number"] === "12" ? { __typename: "PullRequest" } : { __typename: "Issue", number: Number(v["number"]), state: "OPEN", body: `## Done when\n- [ ] a (${v["number"]})` } } } };
      },
    });
    const result = await gather(fake);
    if (!result.ok) throw new Error(result.error);
    expect(asked.sort()).toEqual(["11", "12"]);
    expect(result.snapshot.linkedIssues.map((i) => [i.number, i.via])).toEqual([[11, "closing"]]);
  });

  test("an unreadable linked issue is a problem", async () => {
    const pr = prResponse({ body: "Part of #12" });
    const result = await gather(gh(pr, baseResponse(), { issue: () => fail("boom") }));
    if (!result.ok) throw new Error(result.error);
    expect(result.snapshot.problems.join(" ")).toContain("#12");
  });

  test("reads the queue entry and the last removal", async () => {
    const removal = (at: string, before: string | null, reason = "merge_conflict") => ({ __typename: "RemovedFromMergeQueueEvent", createdAt: at, reason, beforeCommit: before === null ? null : { oid: before } });
    const entry = { id: "MQE_1", position: 3, state: "AWAITING_CHECKS", enqueuedAt: "2026-01-01T00:00:00Z", jump: false };
    const head = await gather(gh(prResponse({ mergeQueueEntry: entry, timelineItems: { nodes: [removal("2026-01-01T01:00:00Z", OLD, "manual"), removal("2026-01-01T02:00:00Z", HEAD)] } })));
    if (!head.ok) throw new Error(head.error);
    expect(head.snapshot.queueEntry?.state).toBe("AWAITING_CHECKS");
    expect(head.snapshot.lastQueueRemoval).toEqual({ at: "2026-01-01T02:00:00Z", reason: "merge_conflict", beforeCommit: HEAD, afterLastPush: true });
    const pushed = await gather(gh(prResponse({ timelineItems: { nodes: [removal("2026-01-01T02:00:00Z", OLD)] } })));
    if (!pushed.ok) throw new Error(pushed.error);
    expect(pushed.snapshot.lastQueueRemoval?.afterLastPush).toBe(false);
    const dated = await gather(gh(prResponse({ timelineItems: { nodes: [removal("2026-01-01T02:00:00Z", null)] } })));
    if (!dated.ok) throw new Error(dated.error);
    expect(dated.snapshot.lastQueueRemoval?.afterLastPush).toBe(true);
  });

  test("finds the parent PR of a stacked PR in the same repository only", async () => {
    const own = { number: 3, headRepository: { nameWithOwner: "example-org/example-repo" } };
    const fork = { number: 4, headRepository: { nameWithOwner: "fork-owner/example-repo" } };
    const stacked = await gather(gh(prResponse({ baseRefName: "topic-base" }), baseResponse({ pullRequests: { nodes: [fork, own] } }), {}));
    if (!stacked.ok) throw new Error(stacked.error);
    expect(stacked.snapshot.parentPr).toBe(3);
    const none = await gather(gh(prResponse(), baseResponse({ pullRequests: { nodes: [fork] } })));
    if (!none.ok) throw new Error(none.error);
    expect(none.snapshot.parentPr).toBeNull();
  });

  test("re-reads mergeability while it is UNKNOWN", async () => {
    let reads = 0;
    const fake = gh(prResponse({ mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }), baseResponse(), {
      mergeability: () => {
        reads += 1;
        return { data: { repository: { pullRequest: reads < 2 ? { mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN", headRefOid: HEAD } : { mergeable: "CONFLICTING", mergeStateStatus: "DIRTY", headRefOid: HEAD } } } };
      },
    });
    const result = await gather(fake);
    if (!result.ok) throw new Error(result.error);
    expect(reads).toBe(2);
    expect([result.snapshot.mergeable, result.snapshot.mergeStateStatus]).toEqual(["CONFLICTING", "DIRTY"]);
    const stuck = await gather(gh(prResponse({ mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }), baseResponse(), { mergeability: () => ({ data: { repository: { pullRequest: { mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN", headRefOid: HEAD } } } }) }));
    if (!stuck.ok) throw new Error(stuck.error);
    expect(stuck.snapshot.mergeable).toBe("UNKNOWN");
  });

  test("stops when the head moves while mergeability is re-read", async () => {
    const fake = gh(prResponse({ mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }), baseResponse(), {
      mergeability: () => ({ data: { repository: { pullRequest: { mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", headRefOid: OLD } } } }),
    });
    const result = await gather(fake);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("head moved");
  });

  test("the latest attempt is the one with the highest check-run id, even when its start time is older", async () => {
    const nodes = [
      ctxRun("Build", { databaseId: 20, startedAt: "2026-01-01T00:10:00Z", conclusion: "FAILURE" }),
      ctxRun("Build", { databaseId: 31, startedAt: "2026-01-01T00:02:00Z", conclusion: "SUCCESS" }),
      ctxRun("Build", { databaseId: 25, startedAt: "2026-01-01T00:20:00Z", conclusion: "FAILURE" }),
    ];
    const pr = prResponse({
      latestCommit: { nodes: [{ commit: { id: "C", oid: HEAD, statusCheckRollup: { contexts: { totalCount: 3, pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } }] },
    });
    const result = await gather(gh(pr));
    if (!result.ok) throw new Error(result.error);
    const build = result.snapshot.checks.find((c) => c.name === "Build");
    expect([build?.conclusion, build?.runId, build?.attempts, build?.failedAttempts]).toEqual(["success", 31, 3, 2]);
  });

  test("a queued re-run with no start time is the newest attempt and the check is pending", async () => {
    const nodes = [
      ctxRun("Build", { startedAt: "2026-01-01T00:00:00Z", conclusion: "FAILURE" }),
      ctxRun("Build", { status: "QUEUED", conclusion: null, startedAt: null, completedAt: null }),
    ];
    const pr = prResponse({
      latestCommit: { nodes: [{ commit: { id: "C", oid: HEAD, statusCheckRollup: { contexts: { totalCount: 2, pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } }] },
    });
    const result = await gather(gh(pr));
    if (!result.ok) throw new Error(result.error);
    const build = result.snapshot.checks.find((c) => c.name === "Build");
    expect([build?.status, build?.conclusion, build?.attempts, build?.failedAttempts]).toEqual(["queued", null, 2, 1]);
  });

  test("checks with one name from two apps stay apart", async () => {
    const other = { checkSuite: { app: { databaseId: 99 }, workflowRun: { event: "push", workflow: { name: "CI" } } } };
    const nodes = [ctxRun("Build"), ctxRun("Build", other)];
    const pr = prResponse({
      latestCommit: { nodes: [{ commit: { id: "C", oid: HEAD, statusCheckRollup: { contexts: { totalCount: 2, pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } }] },
    });
    const result = await gather(gh(pr));
    if (!result.ok) throw new Error(result.error);
    expect(result.snapshot.checks.map((c) => c.appId).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([99, 15368]);
  });

  test("a commit list cut at GitHub's limit is truncated and says that DCO is unknown", async () => {
    const nodes = Array.from({ length: 100 }, (_, i) => commitNode(`${(i + 1).toString(16).padStart(40, "0")}`, [OLD]));
    const pr = prResponse({ commits: { totalCount: 300, pageInfo: { hasPreviousPage: false, startCursor: null }, nodes } });
    const result = await gather(gh(pr));
    if (!result.ok) throw new Error(result.error);
    expect(result.snapshot.commitsTruncated).toBe(true);
    expect(result.snapshot.problems.join(" ")).toContain("DCO");
  });

  test("a review list shorter than its total is truncated", async () => {
    const pr = prResponse({ reviews: { totalCount: 7, pageInfo: { hasPreviousPage: false, startCursor: null }, nodes: [] } });
    const result = await gather(gh(pr));
    if (!result.ok) throw new Error(result.error);
    expect(result.snapshot.reviewsTruncated).toBe(true);
  });

  test("notes a head that moved during the read", async () => {
    const moved = prResponse({
      latestCommit: { nodes: [{ commit: { id: "C", oid: OLD, statusCheckRollup: null } }] },
    });
    const result = await gather(gh(moved));
    if (!result.ok) throw new Error(result.error);
    expect(result.snapshot.problems.join(" ")).toContain("head changed");
  });

  test("returns an error, not an exception, for a missing PR, a GraphQL error, and a gh failure", async () => {
    const missing = await gather(gh({ data: { repository: { nameWithOwner: "example-org/example-repo", defaultBranchRef: { name: "main" }, pullRequest: null } } }));
    expect(missing.ok).toBe(false);
    const errors = await gather(gh({ errors: [{ message: "Something broke" }] }));
    expect(errors.ok).toBe(false);
    if (!errors.ok) expect(errors.error).toContain("Something broke");
    const dead = await gather(fakeGh({ pr: () => fail("network down") }));
    expect(dead.ok).toBe(false);
    const garbage = await gather(gh("not json"));
    expect(garbage.ok).toBe(false);
  });

  test("branch rules are read once per base through the cache", async () => {
    const cache = newGatherCache();
    const fake = gh();
    await gather(fake, { cache });
    await gather(fake, { cache });
    const ruleCalls = fake.calls.filter((c) => c.some((a) => a.includes("/rules/branches/")));
    expect(ruleCalls.length).toBe(1);
  });
});

describe("branch rules", () => {
  test("parses ruleset rules", () => {
    const facts = parseRulesetRules(JSON.stringify(rulesReply));
    expect(facts.requiredApprovingReviewCount).toBe(1);
    expect(facts.mergeQueue).toBe(true);
    expect(facts.allowedMergeMethods).toEqual(["squash"]);
  });

  test("parses classic protection and ignores an absent protection object", () => {
    const facts = parseClassicProtection(
      JSON.stringify({ protection: { required_status_checks: { strict: true, checks: [{ context: "Build", app_id: 15368 }, { context: "Lint", app_id: -1 }] }, required_pull_request_reviews: { required_approving_review_count: 2, require_code_owner_reviews: true }, required_conversation_resolution: { enabled: true } } }),
    );
    expect(facts.requiredChecks?.map((c) => [c.name, c.appId])).toEqual([["Build", 15368], ["Lint", null]]);
    expect(facts.requiredApprovingReviewCount).toBe(2);
    expect(facts.requireCodeOwnerReview).toBe(true);
    expect(facts.threadResolutionRequired).toBe(true);
    expect(parseClassicProtection(JSON.stringify({ name: "main" }))).toEqual({});
  });

  test("a 404 means no rules, another failure means unknown", async () => {
    const none = await gatherRules(fakeGh({}, {}).run, repo, "main");
    expect(none.rules.known).toBe(true);
    expect(none.rules.requiredChecks).toEqual([]);
    const broken = await gatherRules(fakeGh({}, { "repos/example-org/example-repo/rules/branches/main": fail("HTTP 500: Server Error") }).run, repo, "main");
    expect(broken.rules.known).toBe(false);
    expect(broken.problems.length).toBe(1);
    const garbage = await gatherRules(fakeGh({}, { "repos/example-org/example-repo/rules/branches/main": "oops" }).run, repo, "main");
    expect(garbage.rules.known).toBe(false);
  });

  test("a 403 on classic protection is tolerated, on the rules API it is not", async () => {
    const ok = await gatherRules(fakeGh({}, { "repos/example-org/example-repo/rules/branches/main": [], "repos/example-org/example-repo/branches/main": fail("HTTP 403: Forbidden") }).run, repo, "main");
    expect(ok.rules.known).toBe(true);
    const bad = await gatherRules(fakeGh({}, { "repos/example-org/example-repo/rules/branches/main": fail("HTTP 403: Forbidden") }).run, repo, "main");
    expect(bad.rules.known).toBe(false);
  });

  test("a branch name with a slash is encoded per segment", async () => {
    const fake = fakeGh({}, { "repos/example-org/example-repo/rules/branches/release/1.0": [] });
    await gatherRules(fake.run, repo, "release/1.0");
    expect(fake.calls[0]?.at(-1)).toBe("repos/example-org/example-repo/rules/branches/release/1.0");
  });
});

describe("body template", () => {
  test("reads the headings at the base commit, null when absent", async () => {
    const fake = fakeGh({}, { "repos/example-org/example-repo/contents/.github/PULL_REQUEST_TEMPLATE.md": "## Why\n\n<!-- hint -->\n\n## What\n" });
    const template = await gatherBodyTemplate(fake.run, repo, BASE, ".github/PULL_REQUEST_TEMPLATE.md");
    expect(template).toEqual({ headings: ["Why", "What"] });
    expect(await gatherBodyTemplate(fakeGh({}).run, repo, BASE, ".github/PULL_REQUEST_TEMPLATE.md")).toBeNull();
  });
});
