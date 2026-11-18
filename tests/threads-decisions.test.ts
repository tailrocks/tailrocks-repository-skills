import { describe, expect, test } from "bun:test";
import { classifyThread } from "../lib/threads/classify.ts";
import { commitUrl, composeReply, hasReply, parseDecisions, planWrites, replyMarker } from "../lib/threads/decisions.ts";
import type { ClassifiedThread, CommentView, Decision, DecisionFile } from "../lib/threads/types.ts";
import { AGENT, FIX_COMMIT, PR_AUTHOR, POLICY_TOML, REPO } from "./helpers/threads-world.ts";
import { policyFromText } from "./helpers/status.ts";

const policy = policyFromText(POLICY_TOML);
const classifyContext = { policy, prAuthor: PR_AUTHOR, agent: AGENT };
const context = { policy, repo: REPO };

function c(author: string, body: string, bot = false): CommentView {
  return { author, body, isBotAccount: bot, url: null };
}

function classified(id: string, resolved: boolean, ...comments: CommentView[]): ClassifiedThread {
  const [first] = comments;
  if (first === undefined) throw new Error("comment");
  return classifyThread(
    { id, isResolved: resolved, isOutdated: false, path: "a.rs", line: 1, commentCount: comments.length, first, comments },
    classifyContext,
  );
}

const fixBot = classified("T-fix", false, c("review-bot", "P1: data loss"));
const deferBot = classified("T-defer", false, c("review-bot", "P3: nit"));
const question = classified("T-question", false, c("reviewer-1", "Why this way?"));
const other = classified("T-other", false, c("reviewer-1", "Please rename."));
const praise = classified("T-praise", false, c("reviewer-1", "Nice cleanup."));
const threads = [fixBot, deferBot, question, other, praise];

function d(id: string, action: Decision["action"], reply = "", fixCommit: Decision["fixCommit"] = null, confirmedNoOpenQuestion = false): Decision {
  return { id, action, reply, fixCommit, confirmedNoOpenQuestion };
}

function plan(...decisions: Decision[]) {
  return planWrites({ expectHead: null, decisions }, threads, context);
}

function refusal(...decisions: Decision[]): string {
  const r = plan(...decisions);
  if (r.ok) throw new Error("expected a refusal");
  return r.refusals.join(" | ");
}

describe("parseDecisions", () => {
  const good = JSON.stringify({ schema: 1, expectHead: "a".repeat(40), decisions: [{ id: "T1", action: "fix", reply: " Done ", fixCommit: "b".repeat(40), confirmedNoOpenQuestion: true }] });

  test("reads a valid file and trims the reply", () => {
    const r = parseDecisions(good);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(String(r.value.expectHead)).toBe("a".repeat(40));
    expect(r.value.decisions.map((x) => [x.id, x.action, x.reply, String(x.fixCommit), x.confirmedNoOpenQuestion])).toEqual([["T1", "fix", "Done", "b".repeat(40), true]]);
  });

  test("a missing reply, fixCommit, and confirmation read as empty, null, and false", () => {
    const r = parseDecisions(JSON.stringify({ schema: 1, decisions: [{ id: "T1", action: "defer" }] }));
    expect(r.ok && r.value.decisions[0]).toEqual({ id: "T1", action: "defer", reply: "", fixCommit: null, confirmedNoOpenQuestion: false });
  });

  test("reads the reply-resolve action", () => {
    const r = parseDecisions(JSON.stringify({ schema: 1, decisions: [{ id: "T1", action: "reply-resolve", reply: "Thanks." }] }));
    expect(r.ok && r.value.decisions[0]?.action).toBe("reply-resolve");
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
    ["a confirmation that is not a boolean", JSON.stringify({ schema: 1, decisions: [{ id: "T1", action: "defer", confirmedNoOpenQuestion: "yes" }] })],
  ];
  for (const [name, text] of bad) {
    test(`refuses ${name}`, () => {
      expect(parseDecisions(text).ok).toBe(false);
    });
  }
});

describe("composeReply", () => {
  test("a fix reply names the commit link", () => {
    expect(composeReply(d("T-fix", "fix", "Guarded the write.", FIX_COMMIT), fixBot, context)).toBe(`Guarded the write.\n\nFixed in ${commitUrl(REPO, FIX_COMMIT)}`);
  });

  test("a bot fix without text still gets a reply", () => {
    expect(composeReply(d("T-fix", "fix", "", FIX_COMMIT), fixBot, context)).toBe(`Fixed.\n\nFixed in ${commitUrl(REPO, FIX_COMMIT)}`);
  });

  test("a defer reply starts with the policy text", () => {
    expect(composeReply(d("T-defer", "defer"), deferBot, context)).toBe(policy.threads.defer_reply);
    expect(composeReply(d("T-defer", "defer", "Tracked later."), deferBot, context)).toBe(`${policy.threads.defer_reply}\n\nTracked later.`);
  });

  test("an empty text gives null", () => {
    const noDefer = { ...context, policy: { ...policy, threads: { ...policy.threads, defer_reply: "" } } };
    expect(composeReply(d("T-defer", "defer"), deferBot, noDefer)).toBeNull();
    expect(composeReply(d("T-other", "reply-only"), other, context)).toBeNull();
  });
});

describe("planWrites", () => {
  test("accepts one decision per class and decides what resolves", () => {
    const r = plan(
      d("T-fix", "fix", "", FIX_COMMIT),
      d("T-defer", "defer"),
      d("T-question", "reply-only", "Because of X."),
      d("T-other", "fix", "Renamed.", FIX_COMMIT, true),
      d("T-praise", "reply-resolve", "Thanks.", null, true),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.writes.map((w) => [w.thread.detail.id, w.post, w.resolve])).toEqual([
      ["T-fix", true, true],
      ["T-defer", true, true],
      ["T-question", true, false],
      ["T-other", true, true],
      ["T-praise", true, true],
    ]);
  });

  test("reply-only never resolves, even on a human-other thread", () => {
    const r = plan(d("T-other", "reply-only", "Will do later."));
    expect(r.ok && r.writes[0]?.resolve).toBe(false);
  });

  test("never resolves a person's open question: fix, defer, and reply-resolve are refused", () => {
    for (const action of ["fix", "defer", "reply-resolve"] as const) {
      expect(refusal(d("T-question", action, "Reason.", action === "fix" ? FIX_COMMIT : null, true))).toMatch(/open question|human-other thread only/);
    }
  });

  test("resolving a thread that a person wrote in needs confirmedNoOpenQuestion", () => {
    for (const [action, fixCommit] of [["fix", FIX_COMMIT], ["defer", null], ["reply-resolve", null]] as const) {
      const text = refusal(d("T-other", action, "Reason.", fixCommit, false));
      expect(text).toContain("confirmedNoOpenQuestion");
      expect(plan(d("T-other", action, "Reason.", fixCommit, true)).ok).toBe(true);
    }
  });

  test("a bot-only thread resolves without the confirmation", () => {
    expect(plan(d("T-defer", "defer")).ok).toBe(true);
    expect(plan(d("T-fix", "fix", "", FIX_COMMIT)).ok).toBe(true);
  });

  test("a bot thread that a person answered needs the confirmation too", () => {
    const answered = classified("T-b", false, c("review-bot", "P3: nit"), c("reviewer-1", "Agreed, please fix."));
    const file: DecisionFile = { expectHead: null, decisions: [d("T-b", "defer", "Later.")] };
    expect(planWrites(file, [answered], context).ok).toBe(false);
    const ok: DecisionFile = { expectHead: null, decisions: [d("T-b", "defer", "Later.", null, true)] };
    expect(planWrites(ok, [answered], context).ok).toBe(true);
  });

  test("reply-resolve is for human-other threads only", () => {
    expect(refusal(d("T-defer", "reply-resolve", "Thanks.", null, true))).toContain("human-other thread only");
    expect(refusal(d("T-fix", "reply-resolve", "Thanks.", null, true))).toContain("human-other thread only");
  });

  test("reply-resolve needs a reply text and a confirmation", () => {
    expect(refusal(d("T-praise", "reply-resolve", "", null, true))).toContain("reply text is required");
    expect(refusal(d("T-praise", "reply-resolve", "Thanks.", null, false))).toContain("confirmedNoOpenQuestion");
  });

  test("a reply-only decision on a question may name the fix commit and stays open", () => {
    const r = plan(d("T-question", "reply-only", "Changed it.", FIX_COMMIT));
    expect(r.ok && r.writes[0]?.visible).toBe(`Changed it.\n\nFixed in ${commitUrl(REPO, FIX_COMMIT)}`);
    expect(r.ok && r.writes[0]?.resolve).toBe(false);
  });

  test("refuses to defer a thread that the policy says must be fixed", () => {
    expect(refusal(d("T-fix", "defer"))).toContain("requires a fix");
  });

  test("refuses a fix without a commit, and a commit on defer or reply-resolve", () => {
    expect(plan(d("T-fix", "fix")).ok).toBe(false);
    expect(plan(d("T-defer", "defer", "", FIX_COMMIT)).ok).toBe(false);
    expect(plan(d("T-praise", "reply-resolve", "Thanks.", FIX_COMMIT, true)).ok).toBe(false);
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

  test("an empty policy defer_reply is a validation error before any write", () => {
    const noDefer = { ...context, policy: { ...policy, threads: { ...policy.threads, defer_reply: "" } } };
    const file: DecisionFile = { expectHead: null, decisions: [d("T-fix", "fix", "", FIX_COMMIT), d("T-defer", "defer")] };
    const r = planWrites(file, threads, noDefer);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusals.join(" ")).toContain("defer_reply is empty");
    const withText: DecisionFile = { expectHead: null, decisions: [d("T-defer", "defer", "Later.")] };
    expect(planWrites(withText, threads, noDefer).ok).toBe(true);
  });

  test("a reply that is too long is refused before any write", () => {
    const big = { ...context, policy: { ...policy, threads: { ...policy.threads, defer_reply: "y".repeat(10_000) } } };
    const file: DecisionFile = { expectHead: null, decisions: [d("T-defer", "defer", "x".repeat(59_000))] };
    const r = planWrites(file, threads, big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusals.join(" ")).toContain("too long");
  });
});

describe("re-run dedupe", () => {
  const visible = `${policy.threads.defer_reply}\n\nLater.`;
  const file: DecisionFile = { expectHead: null, decisions: [d("T-p", "defer", "Later.", null, true)] };

  test("every reply ends with a hidden marker line", () => {
    const r = planWrites(file, [classified("T-p", false, c("review-bot", "P3: nit"))], context);
    expect(r.ok && r.writes[0]?.body).toBe(`${visible}\n\n${replyMarker("T-p", visible)}`);
    expect(replyMarker("T-p", visible)).toMatch(/^<!-- pr-threads:[0-9a-f]{16} -->$/);
  });

  test("the marker depends on the thread and on the text", () => {
    expect(replyMarker("T-a", "x")).not.toBe(replyMarker("T-b", "x"));
    expect(replyMarker("T-a", "x")).not.toBe(replyMarker("T-a", "y"));
  });

  test("a reply that is there with the marker is not posted again, whoever wrote after, whoever wrote it", () => {
    const posted = c("some-account", `${visible}\n\n${replyMarker("T-p", visible)}`);
    const t = classified("T-p", false, c("review-bot", "P3: nit"), posted, c("review-bot", "Thanks!", true));
    expect(hasReply(t, visible)).toBe(true);
    const r = planWrites(file, [t], context);
    expect(r.ok && r.writes[0]).toMatchObject({ post: false, resolve: true });
  });

  test("the exact reply text from any author also counts", () => {
    const t = classified("T-p", false, c("review-bot", "P3: nit"), c("unknown-login", visible), c("review-bot", "Thanks!", true));
    const r = planWrites(file, [t], context);
    expect(r.ok && r.writes[0]).toMatchObject({ post: false });
  });

  test("a different reply text is posted", () => {
    const t = classified("T-p", false, c("review-bot", "P3: nit"), c(AGENT, "Something else."));
    const r = planWrites(file, [t], context);
    expect(r.ok && r.writes[0]).toMatchObject({ post: true });
  });

  test("a resolved thread with our reply anywhere in it is done; without it, it is refused", () => {
    const done = classified("T-p", true, c("review-bot", "P3: nit"), c(AGENT, `${visible}\n\n${replyMarker("T-p", visible)}`), c("review-bot", "Thanks!", true));
    const r = planWrites(file, [done], context);
    expect(r.ok && r.writes[0]).toMatchObject({ post: false, resolve: false });
    expect(planWrites(file, [classified("T-p", true, c("review-bot", "P3: nit"))], context).ok).toBe(false);
  });
});
