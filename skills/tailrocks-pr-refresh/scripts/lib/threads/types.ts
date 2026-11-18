// Types of the review-thread triage (tailrocks-pr-threads).

import type { Sha } from "../types.ts";

/** One comment of a review thread, as read from GitHub. The text is untrusted. */
export interface CommentView {
  /** The GraphQL node id of the comment. */
  readonly id: string;
  readonly author: string;
  /** True when GitHub types the account as a bot (its login has no `[bot]` suffix then). */
  readonly isBotAccount: boolean;
  readonly body: string;
  readonly url: string | null;
}

export interface ThreadDetail {
  readonly id: string;
  readonly isResolved: boolean;
  readonly isOutdated: boolean;
  readonly path: string | null;
  readonly line: number | null;
  /** The number of comments that GitHub reports. */
  readonly commentCount: number;
  readonly first: CommentView;
  /** Every comment of the thread, oldest first. The last entry is the last comment. */
  readonly comments: readonly CommentView[];
}

/**
 * - `fix`: the policy says the thread must be fixed.
 * - `defer`: a bot thread that the policy does not require to fix.
 * - `human-question`: a person asked a question or asked for a review. The skill replies and never resolves.
 * - `human-other`: any other thread of a person. A reply with the reason is required.
 */
export type ThreadClass = "fix" | "defer" | "human-question" | "human-other";

/** Who must act next on the thread. */
export type Awaiting = "agent" | "human";

export interface ClassifiedThread {
  readonly detail: ThreadDetail;
  readonly class: ThreadClass;
  readonly awaiting: Awaiting;
  readonly isBot: boolean;
  /** True when a person (not a bot, not the PR author, not the agent) wrote a comment in the thread. */
  readonly involvesPerson: boolean;
  /** One short reason for the class. */
  readonly reason: string;
}

/**
 * - `fix`: reply with the fix commit, then resolve.
 * - `defer`: reply with the policy text, then resolve.
 * - `reply-only`: reply. The thread stays open.
 * - `reply-resolve`: reply, then resolve. For a `human-other` thread only.
 */
export type Action = "fix" | "defer" | "reply-only" | "reply-resolve";

export interface Decision {
  readonly id: string;
  readonly action: Action;
  readonly reply: string;
  readonly fixCommit: Sha | null;
  /** The agent read the whole thread: no person waits for an answer. Needed to resolve a thread that a person wrote in. */
  readonly confirmedNoOpenQuestion: boolean;
  /**
   * The id of the last comment of the thread when the agent read it (plan prints it).
   * Needed for every resolving action. A newer comment from anyone but our own reply stops the resolve.
   */
  readonly lastCommentId: string | null;
}

export interface DecisionFile {
  /** When set, the head of the PR must equal it. */
  readonly expectHead: Sha | null;
  readonly decisions: readonly Decision[];
}
