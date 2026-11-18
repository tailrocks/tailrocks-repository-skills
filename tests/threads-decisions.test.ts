import { describe, expect, test } from "bun:test";
import { classifyThread } from "../lib/threads/classify.ts";
import { commitUrl, composeReply, parseDecisions, planWrites } from "../lib/threads/decisions.ts";
import type { ClassifiedThread, CommentView, Decision, DecisionFile } from "../lib/threads/types.ts";
import { sameLogin } from "../lib/status/text.ts";
import { AGENT, FIX_COMMIT, PR_AUTHOR, POLICY_TOML, REPO } from "./helpers/threads-world.ts";
import { policyFromText } from "./helpers/status.ts";

const policy = policyFromText(POLICY_TOML);
const classifyContext = { policy, prAuthor: PR_AUTHOR, agent: AGENT };
const context = { policy, repo: REPO, isSelf: (login: string) => sameLogin(login, PR_AUTHOR) || sameLogin(login, AGENT) };

function c(author: string, body: string, bot = false): CommentView {
  return { author, body, isBotAccount: bot, url: null };
}

function classified(id: string, resolved: boolean, ...comments: CommentView[]): ClassifiedThread {
  const [first] = comments;
  if (first === undefined) throw new Error("comment");
  return classifyThread(
    { id, isResolved: resolved, isOutdated: false, path: "a.rs", line: 1, commentCount: comments.length, first, recent: comments },
    classifyContext,
  );
}

const fixBot = classified("T-fix", false, c("review-bot", "P1: data loss"));
const deferBot = classified("T-defer", false, c("review-bot", "P3: nit"));
const question = classified("T-question", false, c("reviewer-1", "Why this way?"));
const other = classified("T-other", false, c("reviewer-1", "Please rename."));
const threads = [fixBot, deferBot, question, other];

function d(id: string, action: Decision["action"], reply = "", fixCommit: Decision["fixCommit"] = null): Decision {
  return { id, action, reply, fixCommit };
}

function plan(...decisions: Decision[]) {
  const file: DecisionFile = { expectHead: null, decisions };
  return planWrites(file, threads, context);
}

describe("parseDecisions", () => {
  const good = JSON.stringify({ schema: 1, expectHead: "a".repeat(40), decisions: [{ id: "T1", action: "fix", reply: " Done ", fixCommit: "b".repeat(40) }] });

  test("reads a valid file and trims the reply", () => {
    const r = parseDecisions(good);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(String(r.value.expectHead)).toBe("a".repeat(40));
    expect(r.value.decisions.map((x) => [x.id, x.action, x.reply, String(x.fixCommit)])).toEqual([["T1", "fix", "Done", "b".repeat(40)]]);
  });

  test("a missing reply and fixCommit read as empty and null", () => {
    const r = parseDecisions(JSON.stringify({ schema: 1, decisions: [{ id: "T1", action: "defer" }] }));
    expect(r.ok && r.value.decisions[0]).toEqual({ id: "T1", action: "defer", reply: "", fixCommit: null });
  });

  const bad: readonly (readonly [string, string])[] = [
    ["not JSON", "{nope"],
    ["an array", "[]"],
    ["no schema", JSON.stringify({ decisions: [] })],
    ["an unknown top key", JSON.stringify({ schema: 1, decisions: [], extra: 1 })],
    ["an unknown decision key", JSON.stringify({ schema: 1, decisions: [{ id: "T1", action: "fix", resolve: true }] })],
    ["a bad action", JSON.stringify({ schema: 1, decisions: [{ id: "T1", action: "resolve" }] })],
    ["a short fixCommit", JSON.stringify({ schema: 1, decisions: [{ id: "T1", action: "fix", fixCommit: "abc123" }] })],
    ["an empty id", JSON.stringify({ schema: 1, decisions: [{ id: "", action: "defer" }] })],
    ["a bad expectHead", JSON.stringify({ schema: 1, expectHead: "x", decisions: [] })],
    ["a NUL in the reply", JSON.stringify({ schema: 1, decisions: [{ id: "T1", action: "defer", reply: "a\0b" }] })],
  ];
  for (const [name, text] of bad) {
    test(`refuses ${name}`, () => {
      expect(parseDecisions(text).ok).toBe(false);
    });
  }
});

describe("composeReply", () => {
  test("a fix reply names the commit link", () => {
    const body = composeReply(d("T-fix", "fix", "Guarded the write.", FIX_COMMIT), fixBot, context);
    expect(body).toBe(`Guarded the write.\n\nFixed in ${commitUrl(REPO, FIX_COMMIT)}`);
  });

  test("a bot fix without text still gets a reply", () => {
    expect(composeReply(d("T-fix", "fix", "", FIX_COMMIT), fixBot, context)).toBe(`Fixed.\n\nFixed in ${commitUrl(REPO, FIX_COMMIT)}`);
  });

  test("a defer reply starts with the policy text", () => {
    expect(composeReply(d("T-defer", "defer"), deferBot, context)).toBe(policy.threads.defer_reply);
    expect(composeReply(d("T-defer", "defer", "Tracked later."), deferBot, context)).toBe(`${policy.threads.defer_reply}\n\nTracked later.`);
  });

  test("a thread of a person always needs a reply text", () => {
    expect(composeReply(d("T-other", "defer"), other, context)).toBeNull();
    expect(composeReply(d("T-other", "fix", "", FIX_COMMIT), other, context)).toBeNull();
    expect(composeReply(d("T-other", "reply-only"), other, context)).toBeNull();
    expect(composeReply(d("T-other", "reply-only", "Because X."), other, context)).toBe("Because X.");
  });
});

describe("planWrites", () => {
  test("accepts one decision per class and decides what resolves", () => {
    const r = plan(
      d("T-fix", "fix", "", FIX_COMMIT),
      d("T-defer", "defer"),
      d("T-question", "reply-only", "Because of X."),
      d("T-other", "fix", "Renamed.", FIX_COMMIT),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.writes.map((w) => [w.thread.detail.id, w.post, w.resolve])).toEqual([
      ["T-fix", true, true],
      ["T-defer", true, true],
      ["T-question", true, false],
      ["T-other", true, true],
    ]);
  });

  test("never resolves a person's open question: fix and defer are refused", () => {
    for (const action of ["fix", "defer"] as const) {
      const r = plan(d("T-question", action, "Reason.", action === "fix" ? FIX_COMMIT : null));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.refusals[0]).toContain("open question");
    }
  });

  test("a reply-only decision on a question may name the fix commit and stays open", () => {
    const r = plan(d("T-question", "reply-only", "Changed it.", FIX_COMMIT));
    expect(r.ok && r.writes[0]?.body).toBe(`Changed it.\n\nFixed in ${commitUrl(REPO, FIX_COMMIT)}`);
    expect(r.ok && r.writes[0]?.resolve).toBe(false);
  });

  test("refuses to defer a thread that the policy says must be fixed", () => {
    const r = plan(d("T-fix", "defer"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusals[0]).toContain("requires a fix");
  });

  test("refuses a fix without a commit and a defer with a commit", () => {
    expect(plan(d("T-fix", "fix")).ok).toBe(false);
    expect(plan(d("T-defer", "defer", "", FIX_COMMIT)).ok).toBe(false);
  });

  test("refuses an unknown thread and a duplicate decision", () => {
    expect(plan(d("T-none", "defer")).ok).toBe(false);
    expect(plan(d("T-defer", "defer"), d("T-defer", "defer")).ok).toBe(false);
  });

  test("one refusal refuses the whole file", () => {
    const r = plan(d("T-defer", "defer"), d("T-none", "defer"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusals).toHaveLength(1);
  });

  test("refuses a decision for a resolved thread, unless the reply is already there", () => {
    const resolved = classified("T-done", true, c("review-bot", "P3: nit"));
    const file: DecisionFile = { expectHead: null, decisions: [d("T-done", "defer")] };
    expect(planWrites(file, [resolved], context).ok).toBe(false);
    const replied = classified("T-done", true, c("review-bot", "P3: nit"), c(AGENT, policy.threads.defer_reply));
    const r = planWrites(file, [replied], context);
    expect(r.ok && r.writes[0]).toMatchObject({ post: false, resolve: false });
  });

  test("skips a reply that an earlier run already posted, and still resolves", () => {
    const partial = classified("T-p", false, c("review-bot", "P3: nit"), c(AGENT, policy.threads.defer_reply));
    const file: DecisionFile = { expectHead: null, decisions: [d("T-p", "defer")] };
    const r = planWrites(file, [partial], context);
    expect(r.ok && r.writes[0]).toMatchObject({ post: false, resolve: true });
  });

  test("a different reply text from the same author is posted", () => {
    const partial = classified("T-p", false, c("review-bot", "P3: nit"), c(AGENT, "Something else."));
    const file: DecisionFile = { expectHead: null, decisions: [d("T-p", "defer")] };
    const r = planWrites(file, [partial], context);
    expect(r.ok && r.writes[0]).toMatchObject({ post: true });
  });
});
