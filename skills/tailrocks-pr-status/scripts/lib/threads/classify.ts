// Classify review threads. Pure: no I/O. The class is a heuristic. It finds most
// open questions of people, not all. The agent must back it with judgement, and
// `apply` asks for that judgement in writing (`confirmedNoOpenQuestion`).

import type { Policy } from "../policy/types.ts";
import { sameLogin } from "../status/text.ts";
import type { Awaiting, ClassifiedThread, CommentView, ThreadClass, ThreadDetail } from "./types.ts";

export interface ClassifyContext {
  readonly policy: Policy;
  readonly prAuthor: string;
  /** The login of the current gh user. Null when unknown. */
  readonly agent: string | null;
}

// A false positive only forces `reply-only`. A false negative lets a question be resolved.
const ASKS =
  /\b(?:ptal|re-?review|review again|look again|(?:take|have) (?:a|another) (?:quick )?look|(?:could|can|would|will) you|please (?:re-?)?(?:review|check|look|take)|requesting (?:a )?review|needs? (?:a )?(?:re-?)?review|(?:i|we)(?:'m|'d| am| would)? (?:wonder|wondering|like to understand|not sure|don'?t understand)|not sure (?:why|whether|if|how)|(?:explain|clarify)\b)/i;

/** A short reply that closes a question: "thanks", "ok", "lgtm", "resolved". It must not add a new request. */
const CLOSING = /^\W*(?:ok(?:ay)?|thanks?(?: you)?|thx|lgtm|resolved|done|sounds good|got it|makes sense|looks good|ack(?:nowledged)?|\+1|no worries|all good)\b/i;
const NOT_CLOSING = /\b(?:but|however|also|nit|still|instead|please|should|need|rename|change|remove|add|why|how|what|which|where|when|whether)\b/i;
const MAX_CLOSING_LENGTH = 80;

/** Text that a person writes, without code, quotes, or links. */
function prose(body: string): string {
  return body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/^\s*>.*$/gm, " ")
    .replace(/https?:\/\/\S+/g, " ");
}

/** True when the comment asks a question or asks for a review or a look. */
export function looksLikeQuestion(body: string): boolean {
  const text = prose(body);
  return text.includes("?") || text.includes("？") || ASKS.test(text);
}

/** True when the comment is a short closing reply, such as "thanks, resolved". */
export function looksLikeClosing(body: string): boolean {
  const text = prose(body).trim();
  return text.length > 0 && text.length <= MAX_CLOSING_LENGTH && !looksLikeQuestion(text) && CLOSING.test(text) && !NOT_CLOSING.test(text);
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
export function isOtherHuman(comment: CommentView, context: ClassifyContext): boolean {
  return !isBotComment(comment, context.policy) && !isSelf(comment.author, context);
}

/**
 * The first comment of a person that asks something and that the same person did not
 * close with a later closing reply. Any comment of the thread counts, not only the latest.
 */
export function openQuestion(comments: readonly CommentView[], context: ClassifyContext): CommentView | undefined {
  const byPerson = new Map<string, CommentView[]>();
  for (const c of comments) {
    if (isOtherHuman(c, context)) {
      const key = c.author.toLowerCase();
      byPerson.set(key, [...(byPerson.get(key) ?? []), c]);
    }
  }
  for (const own of byPerson.values()) {
    const open = own.find((c, index) => looksLikeQuestion(c.body) && !own.slice(index + 1).some((later) => looksLikeClosing(later.body)));
    if (open !== undefined) {
      return open;
    }
  }
  return undefined;
}

/** The policy fix pattern. `invalid` is true when it does not compile: then every thread counts as a match (fail closed). */
function fixPattern(policy: Policy): { readonly regex: RegExp | null; readonly invalid: boolean } {
  if (policy.threads.fix_pattern === "") {
    return { regex: null, invalid: false };
  }
  try {
    return { regex: new RegExp(policy.threads.fix_pattern, policy.review.flags), invalid: false };
  } catch {
    return { regex: null, invalid: true };
  }
}

export function classifyThread(thread: ThreadDetail, context: ClassifyContext): ClassifiedThread {
  const { policy } = context;
  const last = thread.comments[thread.comments.length - 1] ?? thread.first;
  const isBot = isBotComment(thread.first, policy);
  const involvesPerson = thread.comments.some((c) => isOtherHuman(c, context));
  // Only a thread of a person can wait for that person, and only after the author or the agent spoke last.
  const waitsForPerson = (threadClass: ThreadClass): Awaiting =>
    threadClass !== "defer" && !(threadClass === "fix" && isBot) && isSelf(last.author, context) ? "human" : "agent";
  const result = (threadClass: ThreadClass, reason: string): ClassifiedThread => ({
    detail: thread,
    isBot,
    involvesPerson,
    class: threadClass,
    awaiting: waitsForPerson(threadClass),
    reason,
  });

  const asker = openQuestion(thread.comments, context);
  if (asker !== undefined) {
    return result("human-question", `${asker.author} asked a question or asked for a review; only that person closes it`);
  }
  const fix = fixPattern(policy);
  if (fix.invalid) {
    return result("fix", "the policy fix_pattern does not compile; every thread must be fixed");
  }
  if (fix.regex?.test(thread.first.body) === true) {
    return result("fix", "the first comment matches threads.fix_pattern (P1: must fix)");
  }
  if (isBot) {
    return result("defer", "a bot thread that the policy does not require to fix");
  }
  return result("human-other", "a thread of a person with no open question that the script can see; a reply with the reason is required");
}

export function classifyAll(threads: readonly ThreadDetail[], context: ClassifyContext): readonly ClassifiedThread[] {
  return threads.map((t) => classifyThread(t, context));
}
