import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate } from "../lib/status/evaluate.ts";
import { FINDING_CODES, type Finding, type FindingCode, type PrSnapshot, type Verdict } from "../lib/status/types.ts";
import { parseSnapshot } from "../lib/status/snapshot-io.ts";
import { parseJson, obj, member, str, arr } from "../lib/github/read.ts";
import { BASE, builtinPolicy, check, examplePolicy, green, HEAD, OLD, policyFromText, root, sha, verdictReview } from "./helpers/status.ts";

const example = examplePolicy();

function run(snapshot: PrSnapshot, policy = example): Verdict {
  return evaluate(snapshot, policy, "local");
}

function codes(verdict: Verdict): readonly string[] {
  return [...new Set(verdict.findings.map((f) => f.code))].sort();
}

function find(verdict: Verdict, code: FindingCode): Finding {
  const hit = verdict.findings.find((f) => f.code === code);
  if (hit === undefined) {
    throw new Error(`no ${code} in ${codes(verdict).join(",")}`);
  }
  return hit;
}

describe("recorded fixtures", () => {
  const dir = join(root, "tests", "fixtures", "status");
  const names = readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".expected.json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();

  test("the required fixtures exist", () => {
    for (const name of ["unresolved-bot-threads", "queued-with-unresolved-thread", "stale-approval", "ejected-merge-conflict", "stacked", "bot-unsigned"]) {
      expect(names).toContain(name);
    }
    expect(names.some((n) => n === "ready" || n === "synthetic-ready")).toBe(true);
    expect(names.includes("ready") ? "ready" : "synthetic-ready").toBeTruthy();
  });

  for (const name of names) {
    test(`${name} gives its expected verdict`, () => {
      const snapshot = parseSnapshot(readFileSync(join(dir, `${name}.json`), "utf8"));
      const expected = obj(parseJson(readFileSync(join(dir, `${name}.expected.json`), "utf8"), "expected"), "expected");
      const verdict = evaluate(snapshot, example, "local");
      expect<string>(verdict.state).toBe(str(member(expected, "state"), "state"));
      expect(codes(verdict)).toEqual(arr(member(expected, "codes"), "codes").map((c) => str(c, "code")));
    });
  }
});

describe("baseline", () => {
  test("a green snapshot is READY under the example policy", () => {
    const verdict = run(green());
    expect(verdict.state).toBe("READY");
    expect(verdict.findings).toEqual([]);
    expect(verdict.next).toContain("pr-merge");
    expect(verdict.policySource).toBe("local");
  });

  test("a green snapshot is READY under the built-in policy with github-approval", () => {
    const verdict = evaluate(green({ checks: [check("Required", { isRequired: true }), check("Required verdict", { isRequired: true })] }), builtinPolicy());
    expect(verdict.state).toBe("READY");
  });

  test("every finding code has an owner and a place in the table", () => {
    expect(new Set(FINDING_CODES).size).toBe(FINDING_CODES.length);
    expect(FINDING_CODES.length).toBe(32);
  });

  test("blockers sort before waits before info", () => {
    const verdict = run(green({ isCrossRepository: true, behindBy: 2, threads: [], mergeable: "UNKNOWN", isDraft: true }));
    expect(verdict.findings.map((f) => f.kind)).toEqual(["blocker", "wait", "info", "info"]);
    expect(verdict.next).toBe(find(verdict, "draft").next);
  });
});

describe("state of the PR", () => {
  test("pr_not_open for closed and merged", () => {
    for (const state of ["CLOSED", "MERGED"] as const) {
      const verdict = run(green({ state }));
      expect(verdict.state).toBe("BLOCKED");
      expect(codes(verdict)).toEqual(["pr_not_open"]);
    }
  });
  test("draft", () => {
    expect(codes(run(green({ isDraft: true, mergeStateStatus: "DRAFT" })))).toEqual(["draft"]);
  });
  test("stacked beats wrong_base when a parent PR exists", () => {
    const verdict = run(green({ baseRef: "feature/3", parentPr: 3 }));
    expect(codes(verdict)).toEqual(["stacked"]);
    expect(find(verdict, "stacked").next).toContain("#3");
  });
  test("wrong_base when the base is not the default and not allowed", () => {
    expect(codes(run(green({ baseRef: "topic/x" })))).toEqual(["wrong_base"]);
  });
  test("a base in branches.bases is allowed", () => {
    expect(run(green({ baseRef: "release/1.0" })).state).toBe("READY");
  });
  test("conflict", () => {
    const verdict = run(green({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }));
    expect(codes(verdict)).toEqual(["conflict"]);
    expect(find(verdict, "conflict").owner).toBe("pr-refresh");
  });
  test("mergeability_pending is a wait, never READY", () => {
    const verdict = run(green({ mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN" }));
    expect(verdict.state).toBe("WAITING");
    expect(codes(verdict)).toEqual(["mergeability_pending"]);
  });
  test("behind_base is info without a strict rule", () => {
    const verdict = run(green({ behindBy: 5 }));
    expect(verdict.state).toBe("READY");
    expect(find(verdict, "behind_base").kind).toBe("info");
  });
  test("behind_base blocks when mergeStateStatus is BEHIND", () => {
    const verdict = run(green({ behindBy: 5, mergeStateStatus: "BEHIND" }));
    expect(verdict.state).toBe("BLOCKED");
    expect(find(verdict, "behind_base").kind).toBe("blocker");
  });
  test("behind_base blocks on a strict rule without a merge queue", () => {
    const base = green();
    const verdict = run(green({ behindBy: 1, rules: { ...base.rules, strictUpToDate: true, mergeQueue: false } }));
    expect(find(verdict, "behind_base").kind).toBe("blocker");
  });
  test("cross_repository is info", () => {
    const verdict = run(green({ isCrossRepository: true }));
    expect(verdict.state).toBe("READY");
    expect(find(verdict, "cross_repository").kind).toBe("info");
  });
});

describe("checks", () => {
  const required = (patch: Parameters<typeof check>[1], name = "Required") => [
    check(name, { isRequired: true, ...patch }),
    check(name === "Required" ? "Required verdict" : "Required", { isRequired: true }),
  ];
  const withChecks = (checks: readonly ReturnType<typeof check>[], extra: Partial<PrSnapshot> = {}) => green({ checks, ...extra });

  for (const conclusion of ["failure", "timed_out", "startup_failure", "action_required"] as const) {
    test(`check_failed on ${conclusion}`, () => {
      expect(codes(run(withChecks(required({ conclusion }))))).toEqual(["check_failed"]);
    });
  }
  test("check_failed for a status context in ERROR", () => {
    const failed = check("Required", { kind: "status_context", isRequired: true, conclusion: "failure", appId: null, workflow: null });
    expect(codes(run(withChecks([failed, check("Required verdict", { isRequired: true })])))).toEqual(["check_failed"]);
  });
  test("check_flaky inside the rerun allowance, check_failed beyond it", () => {
    const policy = { ...example, checks: { ...example.checks, flaky: ["Required"], flaky_reruns: 1 } };
    const once = withChecks(required({ conclusion: "failure", attempts: 1, failedAttempts: 1 }));
    expect(codes(run(once, policy))).toEqual(["check_flaky"]);
    const twice = withChecks(required({ conclusion: "failure", attempts: 2, failedAttempts: 2 }));
    expect(codes(run(twice, policy))).toEqual(["check_failed"]);
  });
  test("check_cancelled when cancellation is load, check_failed when it is not", () => {
    const snapshot = withChecks(required({ conclusion: "cancelled" }));
    expect(codes(run(snapshot))).toEqual(["check_cancelled"]);
    const policy = { ...example, checks: { ...example.checks, cancellation_is_load: false } };
    expect(codes(run(snapshot, policy))).toEqual(["check_failed"]);
    expect(codes(run(withChecks(required({ conclusion: "stale" }))))).toEqual(["check_cancelled"]);
  });
  test("check_not_passing for skipped, and accept_skipped allows it", () => {
    const snapshot = withChecks(required({ conclusion: "skipped" }));
    expect(codes(run(snapshot))).toEqual(["check_not_passing"]);
    const policy = { ...example, checks: { ...example.checks, accept_skipped: ["Required"] } };
    expect(run(snapshot, policy).state).toBe("READY");
  });
  test("check_wrong_source when the app differs from the rule", () => {
    const base = green();
    const snapshot = withChecks(required({ appId: 999 }), {
      rules: { ...base.rules, requiredChecks: [{ name: "Required", appId: 15368, source: "ruleset" }, { name: "Required verdict", appId: null, source: "ruleset" }] },
    });
    expect(codes(run(snapshot))).toEqual(["check_wrong_source"]);
  });
  test("check_stale_base when a base-sensitive check fails while behind", () => {
    const snapshot = withChecks(required({ conclusion: "failure" }), { behindBy: 3 });
    expect(codes(run(snapshot))).toEqual(["behind_base", "check_stale_base"]);
    expect(find(run(snapshot), "check_stale_base").owner).toBe("pr-refresh");
    expect(codes(run(withChecks(required({ conclusion: "failure" }), { behindBy: 0 })))).toEqual(["check_failed"]);
  });
  test("check_missing when a required check has no run", () => {
    const verdict = run(withChecks([check("Required", { isRequired: true })]));
    expect(codes(verdict)).toEqual(["check_missing"]);
    expect(find(verdict, "check_missing").detail).toContain("Required verdict");
  });
  test("a policy requirement adds to the union and cannot remove one", () => {
    const policy = { ...example, checks: { ...example.checks, required: ["Extra"] } };
    expect(codes(run(green(), policy))).toEqual(["check_missing"]);
    const lean = { ...example, checks: { ...example.checks, required: [] } };
    expect(codes(run(withChecks([check("Required", { isRequired: true })]), lean))).toEqual(["check_missing"]);
  });
  test("isRequired on a check alone makes it required", () => {
    const base = green();
    const snapshot = withChecks([...base.checks, check("Only GitHub knows", { isRequired: true, conclusion: "failure" })]);
    expect(codes(run(snapshot))).toEqual(["check_failed"]);
  });
  test("a check that is not required never blocks", () => {
    const base = green();
    expect(run(withChecks([...base.checks, check("Optional", { conclusion: "failure" })])).state).toBe("READY");
  });
  test("checks_pending for queued, in-progress, and EXPECTED or PENDING contexts", () => {
    for (const status of ["queued", "in_progress", "waiting", "pending", "requested"] as const) {
      const verdict = run(withChecks(required({ status, conclusion: null })));
      expect(verdict.state).toBe("WAITING");
      expect(codes(verdict)).toEqual(["checks_pending"]);
    }
    const context = check("Required", { kind: "status_context", isRequired: true, status: "pending", conclusion: null, appId: null, workflow: null });
    expect(codes(run(withChecks([context, check("Required verdict", { isRequired: true })])))).toEqual(["checks_pending"]);
  });
  test("checks_pending for an unfinished run of a watched workflow", () => {
    const policy = { ...example, checks: { ...example.checks, watched_workflows: ["Nightly"] } };
    const base = green();
    const running = check("Slow", { workflow: "Nightly", status: "in_progress", conclusion: null });
    const verdict = run(withChecks([...base.checks, running]), policy);
    expect(verdict.state).toBe("WAITING");
    expect(codes(verdict)).toEqual(["checks_pending"]);
  });
  test("a failure outranks a pending check", () => {
    const verdict = run(withChecks([check("Required", { isRequired: true, conclusion: "failure" }), check("Required verdict", { isRequired: true, status: "queued", conclusion: null })]));
    expect(verdict.state).toBe("BLOCKED");
    expect(codes(verdict)).toEqual(["check_failed", "checks_pending"]);
  });
  test("ci_label_needed when label mode is on and no run label is present", () => {
    const snapshot = green({ labels: [], checks: [] });
    const verdict = run(snapshot);
    expect(codes(verdict)).toEqual(["ci_label_needed"]);
    expect(find(verdict, "ci_label_needed").next).toContain("ci:run");
  });
  test("check_missing, not ci_label_needed, when the label is already present", () => {
    expect(codes(run(green({ labels: ["ci:run"], checks: []})))).toEqual(["check_missing"]);
  });
  test("an unreadable conclusion is unknown_state", () => {
    const broken = check("Required", { isRequired: true, conclusion: null });
    expect(codes(run(withChecks([broken, check("Required verdict", { isRequired: true })])))).toEqual(["unknown_state"]);
  });
});

describe("reviews: comment-verdict", () => {
  const approve = (commit = HEAD, at = "2026-01-01T12:00:00Z", author = "user-b") => verdictReview(author, "Verdict: approve\n", commit, at);

  test("review_missing without any verdict", () => {
    expect(codes(run(green({ reviews: [] })))).toEqual(["review_missing"]);
  });
  test("a comment without a verdict line is not a verdict", () => {
    expect(codes(run(green({ reviews: [verdictReview("user-b", "looks good to me", HEAD, "2026-01-01T12:00:00Z")] })))).toEqual(["review_missing"]);
  });
  test("a bot or outside commenter is not a counted reviewer", () => {
    const outsider = { ...approve(), association: "NONE" as const };
    expect(codes(run(green({ reviews: [outsider] })))).toEqual(["review_missing"]);
  });
  test("review.reviewers narrows the counted set", () => {
    const policy = { ...example, review: { ...example.review, reviewers: ["user-z"] } };
    expect(codes(run(green(), policy))).toEqual(["review_missing"]);
    expect(run(green({ reviews: [approve(HEAD, "2026-01-01T12:00:00Z", "user-z")] }), policy).state).toBe("READY");
  });
  test("the PR author may be the reviewer", () => {
    expect(run(green({ author: "user-b" })).state).toBe("READY");
  });
  test("review_changes_requested: the latest verdict wins", () => {
    const changes = verdictReview("user-b", "Verdict: changes needed", HEAD, "2026-01-01T13:00:00Z");
    expect(codes(run(green({ reviews: [approve(), changes] })))).toEqual(["review_changes_requested"]);
    expect(run(green({ reviews: [changes, approve(HEAD, "2026-01-01T14:00:00Z")] })).state).toBe("READY");
  });
  test("one reviewer asking for changes blocks even when another approves", () => {
    const changes = verdictReview("user-c", "Verdict: changes needed", HEAD, "2026-01-01T13:00:00Z");
    expect(codes(run(green({ reviews: [approve(), changes] })))).toEqual(["review_changes_requested"]);
  });
  test("review_blocking_finding: an approval that lists a P1 is not an approval", () => {
    const body = "Verdict: approve\n\n- P1, `src/a.rs:1`. Broken.";
    expect(codes(run(green({ reviews: [verdictReview("user-b", body, HEAD, "2026-01-01T12:00:00Z")] })))).toEqual(["review_blocking_finding"]);
  });
  test("review_blocking_finding: a later review lists a P1", () => {
    const later = verdictReview("user-b", "- P1, `src/a.rs:9`. New finding.", HEAD, "2026-01-01T13:00:00Z");
    expect(codes(run(green({ reviews: [approve(), later] })))).toEqual(["review_blocking_finding"]);
  });
  test("review_stale: approval on an older head, carry-over does not reach it", () => {
    const snapshot = green({
      reviews: [approve(OLD)],
      git: { available: true, unavailableBecause: null, reviewEquivalentHeads: [{ sha: HEAD, via: "head" }], carryStoppedBecause: "merge abc changed more than the base" },
    });
    const verdict = run(snapshot);
    expect(codes(verdict)).toEqual(["review_stale"]);
    expect(find(verdict, "review_stale").detail).toContain("changed more than the base");
  });
  test("review_stale and never READY when git facts are unavailable", () => {
    const snapshot = green({
      reviews: [approve(OLD)],
      git: { available: false, unavailableBecause: "fetch failed", reviewEquivalentHeads: [{ sha: HEAD, via: "head" }], carryStoppedBecause: null },
    });
    const verdict = run(snapshot);
    expect(verdict.state).toBe("BLOCKED");
    expect(find(verdict, "review_stale").detail).toContain("unavailable");
  });
  test("carry-over: an approval on a review-equivalent commit counts", () => {
    const snapshot = green({
      reviews: [approve(OLD)],
      git: {
        available: true,
        unavailableBecause: null,
        reviewEquivalentHeads: [{ sha: HEAD, via: "head" }, { sha: sha("d"), via: "clean_base_merge" }, { sha: OLD, via: "empty_commit" }],
        carryStoppedBecause: null,
      },
    });
    expect(run(snapshot).state).toBe("READY");
  });
  test("carry-over is ignored when the policy turns it off", () => {
    const policy = { ...example, review: { ...example.review, carry_over: "none" as const } };
    const snapshot = green({
      reviews: [approve(OLD)],
      git: { available: true, unavailableBecause: null, reviewEquivalentHeads: [{ sha: HEAD, via: "head" }, { sha: OLD, via: "empty_commit" }], carryStoppedBecause: null },
    });
    expect(codes(run(snapshot, policy))).toEqual(["review_stale"]);
  });
  test("a dismissed or pending review is ignored", () => {
    expect(codes(run(green({ reviews: [{ ...approve(), state: "DISMISSED" }] })))).toEqual(["review_missing"]);
  });
});

describe("reviews: github-approval", () => {
  const policy = builtinPolicy();
  const strict = (patch: Partial<PrSnapshot["rules"]>): Partial<PrSnapshot> => ({ rules: { ...green().rules, ...patch } });

  test("no approval is needed when the rules ask for none", () => {
    expect(evaluate(green({ reviews: [] }), policy).state).toBe("READY");
  });
  test("review_changes_requested from a counted CHANGES_REQUESTED", () => {
    const snapshot = green({ latestOpinionatedReviews: [{ author: "user-b", association: "MEMBER", state: "CHANGES_REQUESTED", commit: HEAD }] });
    expect(codes(evaluate(snapshot, policy))).toEqual(["review_changes_requested"]);
  });
  test("review_decision when approvals are required and the decision is not APPROVED", () => {
    for (const decision of [null, "REVIEW_REQUIRED"] as const) {
      const snapshot = green({ reviewDecision: decision, ...strict({ requiredApprovingReviewCount: 1 }) });
      expect(codes(evaluate(snapshot, policy))).toEqual(["review_decision"]);
    }
    expect(evaluate(green({ reviewDecision: "APPROVED", ...strict({ requiredApprovingReviewCount: 1 }) }), policy).state).toBe("READY");
  });
  test("review_decision for a code-owner rule", () => {
    expect(codes(evaluate(green({ reviewDecision: "REVIEW_REQUIRED", ...strict({ requireCodeOwnerReview: true }) }), policy))).toEqual(["review_decision"]);
  });
});

describe("threads, DCO, queue, issues, body, gates", () => {
  const thread = (n: number, patch = {}) => ({
    id: `thread-${n}`, isResolved: false, isOutdated: false, path: "src/a.rs", line: 1,
    firstAuthor: "chatgpt-codex-connector", firstBody: "P1 Fix this", lastAuthor: "chatgpt-codex-connector", commentCount: 1, ...patch,
  });

  test("threads_unresolved counts bots and people, resolved threads do not count", () => {
    const verdict = run(green({ threads: [thread(1), thread(2, { firstAuthor: "user-c", firstBody: "nit" }), thread(3, { isResolved: true })] }));
    expect(codes(verdict)).toEqual(["threads_unresolved"]);
    expect(find(verdict, "threads_unresolved").detail).toContain("2 unresolved");
    expect(find(verdict, "threads_unresolved").detail).toContain("1 from review bots");
  });
  test("an outdated unresolved thread still blocks", () => {
    expect(codes(run(green({ threads: [thread(1, { isOutdated: true })] })))).toEqual(["threads_unresolved"]);
  });

  const unsigned = (login: string | null, parents = 1) => ({
    oid: sha("e"), parents: parents === 1 ? [OLD] : [OLD, BASE], tree: sha("1"), message: "chore: update", authorLogin: login, authorEmail: "x@example.com", committedDate: "2026-01-01T00:00:00Z",
  });
  test("dco_missing for an unsigned commit", () => {
    const verdict = run(green({ commits: [unsigned("user-a")] }));
    expect(codes(verdict)).toEqual(["dco_missing"]);
    expect(find(verdict, "dco_missing").detail).toContain("user-a");
  });
  test("a merge commit is exempt from the sign-off scan", () => {
    expect(run(green({ commits: [unsigned("user-a", 2)] })).state).toBe("READY");
  });
  test("bot commits are exempt under bot_commits = exempt, and not under rewrite", () => {
    const snapshot = green({ commits: [unsigned("renovate[bot]")] });
    expect(run(snapshot).state).toBe("READY");
    const rewrite = { ...example, dco: { ...example.dco, bot_commits: "rewrite" as const } };
    expect(codes(run(snapshot, rewrite))).toEqual(["dco_missing"]);
    expect(run(green({ commits: [unsigned("app/renovate")] })).state).toBe("READY");
  });
  test("dco.required = false turns the scan off", () => {
    const policy = { ...example, dco: { ...example.dco, required: false } };
    expect(run(green({ commits: [unsigned("user-a")] }), policy).state).toBe("READY");
  });

  test("queued is a wait", () => {
    const entry = { id: "MQE_1", position: 2, state: "AWAITING_CHECKS" as const, jump: false, enqueuedAt: "2026-01-01T00:00:00Z" };
    for (const state of ["QUEUED", "AWAITING_CHECKS", "MERGEABLE", "LOCKED"] as const) {
      const verdict = run(green({ queueEntry: { ...entry, state } }));
      expect(verdict.state).toBe("WAITING");
      expect(codes(verdict)).toEqual(["queued"]);
    }
  });
  test("a queued PR with an unresolved thread is BLOCKED and still shows queued", () => {
    const entry = { id: "MQE_1", position: 2, state: "QUEUED" as const, jump: false, enqueuedAt: "2026-01-01T00:00:00Z" };
    const verdict = run(green({ queueEntry: entry, threads: [thread(1)] }));
    expect(verdict.state).toBe("BLOCKED");
    expect(codes(verdict)).toEqual(["queued", "threads_unresolved"]);
  });
  test("queue_unmergeable is a blocker", () => {
    const entry = { id: "MQE_1", position: 1, state: "UNMERGEABLE" as const, jump: false, enqueuedAt: "2026-01-01T00:00:00Z" };
    const verdict = run(green({ queueEntry: entry }));
    expect(codes(verdict)).toEqual(["queue_unmergeable"]);
    expect(find(verdict, "queue_unmergeable").owner).toBe("pr-merge");
  });
  test("queue_ejected is info only when the head did not change since", () => {
    const removal = { at: "2026-01-01T10:00:00Z", reason: "merge_conflict", beforeCommit: HEAD, afterLastPush: true };
    expect(codes(run(green({ lastQueueRemoval: removal })))).toEqual(["queue_ejected"]);
    expect(codes(run(green({ lastQueueRemoval: { ...removal, afterLastPush: false } })))).toEqual([]);
  });

  const issueBody = "## Done when\n\n- [x] first\n- [ ] second\n";
  test("done_when_unchecked is info under warn and a blocker under block", () => {
    const issues = [{ number: 5, state: "OPEN" as const, body: issueBody, via: "body" as const }];
    expect(find(run(green({ linkedIssues: issues })), "done_when_unchecked").kind).toBe("info");
    const block = { ...example, issues: { ...example.issues, done_when: "block" as const } };
    const verdict = run(green({ linkedIssues: issues }), block);
    expect(verdict.state).toBe("BLOCKED");
    expect(find(verdict, "done_when_unchecked").detail).toContain("#5");
    const off = { ...example, issues: { ...example.issues, done_when: "off" as const } };
    expect(codes(run(green({ linkedIssues: issues }), off))).toEqual([]);
  });
  test("a closed issue and a ticked list do not count", () => {
    const block = { ...example, issues: { ...example.issues, done_when: "block" as const } };
    const closed = [{ number: 5, state: "CLOSED" as const, body: issueBody, via: "closing" as const }];
    const ticked = [{ number: 6, state: "OPEN" as const, body: "## Done when\n- [x] a\n", via: "closing" as const }];
    expect(run(green({ linkedIssues: [...closed, ...ticked] }), block).state).toBe("READY");
  });

  test("body_template needs enforce = true", () => {
    const body = "## Why\n\nBecause.\n\n## What\n\n## Proof\n";
    expect(run(green({ body })).state).toBe("READY");
    const enforce = { ...example, pr_body: { ...example.pr_body, enforce: true } };
    const verdict = run(green({ body }), enforce);
    expect(codes(verdict)).toEqual(["body_template"]);
    expect(find(verdict, "body_template").detail).toContain('empty section "What"');
    expect(find(verdict, "body_template").detail).toContain('missing section "Done when"');
    const full = "## Why\nx\n## What\ny\n## Proof\nz\n## Done when\n- [x] w\n";
    expect(run(green({ body: full }), enforce).state).toBe("READY");
  });
  test("body_template reads the template headings when the snapshot holds them", () => {
    const enforce = { ...example, pr_body: { ...example.pr_body, enforce: true } };
    const snapshot = green({ body: "## Summary\ntext\n", bodyTemplate: { headings: ["Summary", "Risk"] } });
    expect(find(run(snapshot, enforce), "body_template").detail).toContain('missing section "Risk"');
  });

  test("gate_failed for each gate kind", () => {
    const gates = (kind: "label-absent" | "label-present" | "check-pass", value: string) => ({ ...example, gates: [{ name: "g", kind, value }] });
    expect(codes(run(green({ labels: ["ci:auto", "hold"] }), gates("label-absent", "hold")))).toEqual(["gate_failed"]);
    expect(run(green(), gates("label-absent", "hold")).state).toBe("READY");
    expect(codes(run(green(), gates("label-present", "approved")))).toEqual(["gate_failed"]);
    expect(codes(run(green(), gates("check-pass", "Extra")))).toEqual(["gate_failed"]);
    expect(run(green(), gates("check-pass", "Required")).state).toBe("READY");
    const running = green({ checks: [...green().checks, check("Extra", { status: "in_progress", conclusion: null })] });
    expect(codes(run(running, gates("check-pass", "Extra")))).toEqual(["checks_pending"]);
  });
});

describe("GitHub must agree", () => {
  test("READY needs CLEAN or HAS_HOOKS", () => {
    expect(run(green({ mergeStateStatus: "HAS_HOOKS" })).state).toBe("READY");
    for (const status of ["BLOCKED", "UNSTABLE", "DIRTY", "DRAFT", "SOMETHING_NEW"]) {
      const verdict = run(green({ mergeStateStatus: status }));
      expect(verdict.state).toBe("BLOCKED");
      expect(codes(verdict)).toContain("github_disagrees");
    }
  });
  test("github_disagrees names GitHub's status", () => {
    expect(find(run(green({ mergeStateStatus: "BLOCKED" })), "github_disagrees").detail).toContain("BLOCKED");
  });
  test("github_disagrees is not added when another blocker explains the state", () => {
    expect(codes(run(green({ mergeStateStatus: "BLOCKED", threads: [{ id: "t", isResolved: false, isOutdated: false, path: null, line: null, firstAuthor: "a", firstBody: "x", lastAuthor: "a", commentCount: 1 }] })))).toEqual(["threads_unresolved"]);
  });
});

describe("fail closed", () => {
  test("every truncation is an unknown_state blocker", () => {
    for (const patch of [{ threadsTruncated: true }, { commitsTruncated: true }, { checksTruncated: true }, { reviewsTruncated: true }] as const) {
      const verdict = run(green(patch));
      expect(verdict.state).toBe("BLOCKED");
      expect(codes(verdict)).toEqual(["unknown_state"]);
    }
  });
  test("a problem from gathering is an unknown_state blocker", () => {
    const verdict = run(green({ problems: ["check Foo status: unexpected value \"WEIRD\""] }));
    expect(codes(verdict)).toEqual(["unknown_state"]);
    expect(find(verdict, "unknown_state").detail).toContain("WEIRD");
  });
  test("unreadable branch rules are an unknown_state blocker", () => {
    expect(codes(run(green({ rules: { ...green().rules, known: false } })))).toEqual(["unknown_state"]);
  });
  test("an unknown queue state is not a pass", () => {
    const entry = { id: "x", position: 1, state: "WEIRD" as never, jump: false, enqueuedAt: "t" };
    expect(run(green({ queueEntry: entry })).state).toBe("BLOCKED");
  });
  test("evaluate never throws on odd data", () => {
    const odd = green({ commits: null as never, checks: "nope" as never, reviews: undefined as never });
    const verdict = evaluate(odd, example);
    expect(verdict.state).toBe("BLOCKED");
    expect(codes(verdict)).toEqual(["unknown_state"]);
  });
  test("evaluate never throws on an empty object", () => {
    const verdict = evaluate({} as never, example);
    expect(verdict.state).toBe("BLOCKED");
  });
  test("READY needs no blocker, no wait, and no problem together", () => {
    expect(run(green({ problems: ["x"] })).state).not.toBe("READY");
    expect(run(green({ mergeable: "UNKNOWN" })).state).not.toBe("READY");
  });
});

describe("policy by name", () => {
  test("a policy that needs a bad regex fails at load, not in evaluate", () => {
    expect(() => policyFromText('schema = 1\n[review]\nsource = "comment-verdict"\napprove_pattern = "("\nchanges_pattern = "x"\n')).toThrow();
  });
});
