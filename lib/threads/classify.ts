// Classify review threads. Pure: no I/O. The class is advice for the agent,
// except where `apply` enforces it (see decisions.ts).

import type { Policy } from "../policy/types.ts";
import { sameLogin } from "../status/text.ts";
import type { Awaiting, ClassifiedThread, CommentView, ThreadClass, ThreadDetail } from "./types.ts";

export interface ClassifyContext {
  readonly policy: Policy;
  readonly prAuthor: string;
  /** The login of the current gh user. Null when unknown. */
  readonly agent: string | null;
}

const REVIEW_REQUEST =
  /\b(?:ptal|re-?review|take another look|look again|please (?:re-?)?review|can you (?:re-?)?review|requesting (?:a )?review|needs? (?:a )?(?:re-?)?review)\b/i;

/** Text that a person writes to ask, without code, quotes, or links. */
function prose(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/^\s*>.*$/gm, " ")
    .replace(/https?:\/\/\S+/g, " ");
}

/** True when the comment asks a question or asks for a new review. */
export function looksLikeQuestion(body: string): boolean {
  const text = prose(body);
  return text.includes("?") || REVIEW_REQUEST.test(text);
}

export function isBotComment(comment: CommentView, policy: Policy): boolean {
  return (
    comment.isBotAccount ||
    /\[bot\]$/i.test(comment.author) ||
    policy.threads.bots.some((bot) => sameLogin(bot, comment.author))
  );
}

function isSelf(login: string, context: ClassifyContext): boolean {
  return sameLogin(login, context.prAuthor) || (context.agent !== null && sameLogin(login, context.agent));
}

/** A comment from a person who is neither a bot, nor the PR author, nor the agent. */
function isOtherHuman(comment: CommentView, context: ClassifyContext): boolean {
  return !isBotComment(comment, context.policy) && !isSelf(comment.author, context);
}

/** The policy fix pattern. `invalid` is true when it does not compile: then every thread counts as a match (fail closed). */
function fixPattern(policy: Policy): { readonly regex: RegExp | null; readonly invalid: boolean } {
  if (policy.threads.fix_pattern === "") {
    return { regex: null, invalid: false };
  }
  try {
    // `g` and `y` make `test` stateful.
    return { regex: new RegExp(policy.threads.fix_pattern, policy.review.flags.replace(/[gy]/g, "")), invalid: false };
  } catch {
    return { regex: null, invalid: true };
  }
}

export function classifyThread(thread: ThreadDetail, context: ClassifyContext): ClassifiedThread {
  const { policy } = context;
  const last = thread.recent[thread.recent.length - 1] ?? thread.first;
  const isBot = isBotComment(thread.first, policy);
  // Only a thread of a person can wait for that person, and only after the author or the agent spoke last.
  const waitsForPerson = (threadClass: ThreadClass): Awaiting =>
    threadClass !== "defer" && !(threadClass === "fix" && isBot) && isSelf(last.author, context) ? "human" : "agent";
  const result = (threadClass: ThreadClass, reason: string): ClassifiedThread => ({
    detail: thread,
    isBot,
    class: threadClass,
    awaiting: waitsForPerson(threadClass),
    reason,
  });

  // A person's question stays open until that person writes again without asking.
  // Each person counts by their own latest comment, so a reply by an account that is
  // not known as the agent cannot hide the question.
  const latestByPerson = new Map<string, CommentView>();
  for (const c of thread.recent) {
    if (isOtherHuman(c, context)) {
      latestByPerson.set(c.author.toLowerCase(), c);
    }
  }
  const asker = [...latestByPerson.values()].find((c) => looksLikeQuestion(c.body));
  if (asker !== undefined) {
    return result("human-question", `${asker.author} asked a question or asked for a review; only that person closes it`);
  }
  const fix = fixPattern(policy);
  if (fix.invalid) {
    return result("fix", "the policy fix_pattern does not compile; every thread must be fixed");
  }
  if (fix.regex?.test(thread.first.body) === true) {
    return result("fix", "the first comment matches threads.fix_pattern");
  }
  if (isBot) {
    return result("defer", "a bot thread that the policy does not require to fix");
  }
  return result("human-other", "a thread of a person; a reply with the reason is required");
}

export function classifyAll(threads: readonly ThreadDetail[], context: ClassifyContext): readonly ClassifiedThread[] {
  return threads.map((t) => classifyThread(t, context));
}
