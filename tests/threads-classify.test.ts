import { describe, expect, test } from "bun:test";
import { classifyThread, looksLikeClosing, looksLikeQuestion } from "../lib/threads/classify.ts";
import type { CommentView, ThreadDetail } from "../lib/threads/types.ts";
import { AGENT, PR_AUTHOR, POLICY_TOML } from "./helpers/threads-world.ts";
import { policyFromText } from "./helpers/status.ts";

const policy = policyFromText(POLICY_TOML);
const context = { policy, prAuthor: PR_AUTHOR, agent: AGENT };

let counter = 0;
function c(author: string, body: string, bot = false): CommentView {
  counter += 1;
  return { id: `c${counter}`, author, body, isBotAccount: bot, url: null, editedAt: null };
}

function thread(...comments: CommentView[]): ThreadDetail {
  const [first] = comments;
  if (first === undefined) throw new Error("a thread needs a comment");
  return { id: "T1", isResolved: false, isOutdated: false, path: "src/a.rs", line: 3, commentCount: comments.length, first, comments };
}

describe("looksLikeQuestion", () => {
  test("a question mark in prose counts", () => {
    expect(looksLikeQuestion("Why did you drop the check?")).toBe(true);
  });
  test("a review request counts", () => {
    expect(looksLikeQuestion("ptal when you can")).toBe(true);
    expect(looksLikeQuestion("Please re-review this")).toBe(true);
    expect(looksLikeQuestion("please take another look")).toBe(true);
  });
  test("a question mark in code, a quote, or a link does not count", () => {
    expect(looksLikeQuestion("Rename it.\n```ts\nconst x = a ? b : c;\n```")).toBe(false);
    expect(looksLikeQuestion("Use `a ? b : c` here.")).toBe(false);
    expect(looksLikeQuestion("> was this ok?\nYes, rename it.")).toBe(false);
    expect(looksLikeQuestion("See https://example.invalid/a?b=1 for the rule.")).toBe(false);
  });
  test("a plain statement is not a question", () => {
    expect(looksLikeQuestion("Please rename this function.")).toBe(false);
  });
  test("polite requests, a full-width question mark, and wondering count", () => {
    for (const body of [
      "Could you review this again.",
      "Please take a look when free",
      "Can you have another look",
      "Why is this needed？",
      "review again pls",
      "I wonder whether this leaks.",
      "Could you explain the locking.",
      "can you check the retry path",
      "PTAL",
      "I'd like to understand the locking here.",
    ]) {
      expect([body, looksLikeQuestion(body)]).toEqual([body, true]);
    }
  });
});

describe("looksLikeClosing", () => {
  test("a short thanks or ok closes", () => {
    for (const body of ["thanks, resolved", "ok", "LGTM", "Thanks, that works.", "Sounds good"]) {
      expect([body, looksLikeClosing(body)]).toEqual([body, true]);
    }
  });
  test("a closing word with a new request or a question does not close", () => {
    for (const body of ["ok, but rename m to mutex", "Thanks. Also nit: rename it", "ok?", "Also nit: rename `m` to `mutex`.", "thanks, why not a map", "Thanks for that. What about the other call site", "ok, which one is it", "Thanks. Where is it used"]) {
      expect([body, looksLikeClosing(body)]).toEqual([body, false]);
    }
  });
});

describe("classifyThread", () => {
  test("a bot thread that matches the fix pattern is fix", () => {
    const r = classifyThread(thread(c("review-bot", "P1: this loses data")), context);
    expect(r.class).toBe("fix");
    expect(r.isBot).toBe(true);
    expect(r.awaiting).toBe("agent");
  });

  test("a bot thread that does not match is defer", () => {
    const r = classifyThread(thread(c("review-bot", "P3: naming nit")), context);
    expect(r.class).toBe("defer");
    expect(r.awaiting).toBe("agent");
  });

  test("a GitHub bot account and a [bot] login count as bots without the policy list", () => {
    expect(classifyThread(thread(c("other-app", "nit", true)), context).isBot).toBe(true);
    expect(classifyThread(thread(c("dep-helper[bot]", "nit")), context).isBot).toBe(true);
    expect(classifyThread(thread(c("a-person", "nit")), context).isBot).toBe(false);
  });

  test("a person's question is human-question, whoever replied after", () => {
    const asked = classifyThread(thread(c("reviewer-1", "Why this way?")), context);
    expect(asked.class).toBe("human-question");
    expect(asked.awaiting).toBe("agent");
    const answered = classifyThread(thread(c("reviewer-1", "Why this way?"), c(AGENT, "Because of X.")), context);
    expect(answered.class).toBe("human-question");
    expect(answered.awaiting).toBe("human");
  });

  test("a question on a bot thread makes it human-question", () => {
    const r = classifyThread(thread(c("review-bot", "P1: bug"), c("reviewer-1", "Is this real?")), context);
    expect(r.class).toBe("human-question");
  });

  test("a question closes when the same person writes a closing reply", () => {
    const r = classifyThread(thread(c("reviewer-1", "Why this way?"), c(AGENT, "Because X."), c("reviewer-1", "Thanks, that works.")), context);
    expect(r.class).toBe("human-other");
    expect(r.awaiting).toBe("agent");
  });

  test("a follow-up that is not a closing reply does not hide the question", () => {
    const r = classifyThread(thread(c("reviewer-1", "Why do we need this lock at all?"), c("reviewer-1", "Also nit: rename `m` to `mutex`.")), context);
    expect(r.class).toBe("human-question");
  });

  test("a closing reply by another person does not close the question", () => {
    const r = classifyThread(thread(c("reviewer-1", "Why this way?"), c("reviewer-2", "ok")), context);
    expect(r.class).toBe("human-question");
  });

  test("an early question counts even in a long thread", () => {
    const filler = Array.from({ length: 60 }, (_, i) => c(i % 2 === 0 ? AGENT : "review-bot", `note ${i}`));
    const r = classifyThread(thread(c("reviewer-1", "Why this way?"), ...filler), context);
    expect(r.class).toBe("human-question");
  });

  test("a thread that a person wrote in involves a person, a bot-only thread does not", () => {
    expect(classifyThread(thread(c("review-bot", "P3: nit"), c("reviewer-1", "Agreed.")), context).involvesPerson).toBe(true);
    expect(classifyThread(thread(c("review-bot", "P3: nit"), c(AGENT, "Deferred.")), context).involvesPerson).toBe(false);
  });

  test("the PR author's own question is not a person's open question", () => {
    const r = classifyThread(thread(c("review-bot", "P3: nit"), c(PR_AUTHOR, "Is this ok?")), context);
    expect(r.class).toBe("defer");
  });

  test("a person's statement without a question is human-other", () => {
    const r = classifyThread(thread(c("reviewer-1", "Please rename this.")), context);
    expect(r.class).toBe("human-other");
    expect(r.isBot).toBe(false);
    expect(r.awaiting).toBe("agent");
  });

  test("a person's thread waits for that person after the agent replied", () => {
    const r = classifyThread(thread(c("reviewer-1", "Please rename this."), c(AGENT, "Done.")), context);
    expect(r.class).toBe("human-other");
    expect(r.awaiting).toBe("human");
  });

  test("a person's thread that matches the fix pattern is fix", () => {
    expect(classifyThread(thread(c("reviewer-1", "P1 this panics")), context).class).toBe("fix");
  });

  test("without a fix pattern no bot thread must be fixed", () => {
    const noFix = policyFromText('schema = 1\n[threads]\nbots = ["review-bot"]\n');
    const r = classifyThread(thread(c("review-bot", "P1: bug")), { ...context, policy: noFix });
    expect(r.class).toBe("defer");
  });

  test("an unknown agent login does not hide a person's question", () => {
    const r = classifyThread(thread(c("reviewer-1", "Why?"), c("some-account", "Because.")), { ...context, agent: null });
    expect(r.class).toBe("human-question");
    expect(r.awaiting).toBe("agent");
  });
});
