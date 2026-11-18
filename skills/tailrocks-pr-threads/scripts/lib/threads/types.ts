// Types of the review-thread triage (tailrocks-pr-threads).

import type { Sha } from "../types.ts";

/** One comment of a review thread, as read from GitHub. The text is untrusted. */
export interface CommentView {
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
  readonly commentCount: number;
  readonly first: CommentView;
  /** The latest comments, oldest first. The last entry is the last comment of the thread. */
  readonly recent: readonly CommentView[];
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
  /** One short reason for the class. */
  readonly reason: string;
}

export type Action = "fix" | "defer" | "reply-only";

export interface Decision {
  readonly id: string;
  readonly action: Action;
  readonly reply: string;
  readonly fixCommit: Sha | null;
}

export interface DecisionFile {
  /** When set, the head of the PR must equal it. */
  readonly expectHead: Sha | null;
  readonly decisions: readonly Decision[];
}
