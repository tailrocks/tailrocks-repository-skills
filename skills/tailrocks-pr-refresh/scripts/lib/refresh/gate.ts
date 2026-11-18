// Refusals shared by every mode that writes to a PR branch. Pure functions:
// each takes facts and returns the first reason to refuse, or null.

import { matchesAnyGlob } from "../glob.ts";
import type { Policy } from "../policy/types.ts";
import type { PrSnapshot } from "../status/types.ts";
import { sameLogin } from "../status/text.ts";

export interface Refusal {
  readonly code: string;
  readonly headline: string;
  readonly next: string;
}

export interface GateOptions {
  /** True when the caller may handle a queued PR (the DCO fix with `dco.dequeue_for_fix`). */
  readonly allowQueued: boolean;
}

export function isProtectedBranch(snapshot: PrSnapshot, policy: Policy): boolean {
  return snapshot.headRef === snapshot.defaultBranch || matchesAnyGlob(policy.branches.protected, snapshot.headRef);
}

/** The first reason that a script may not write to this PR branch. */
export function writeRefusal(
  snapshot: PrSnapshot,
  policy: Policy,
  ghUser: string,
  options: GateOptions,
): Refusal | null {
  if (snapshot.state !== "OPEN") {
    return { code: "pr_not_open", headline: `the PR is ${snapshot.state.toLowerCase()}`, next: "none; report the state" };
  }
  if (snapshot.isCrossRepository) {
    return {
      code: "cross_repository",
      headline: "the PR head is in another repository; a script never writes to a fork",
      next: "ask the PR author to update the branch",
    };
  }
  if (isProtectedBranch(snapshot, policy)) {
    return {
      code: "protected_branch",
      headline: `branch ${snapshot.headRef} is the default branch or matches branches.protected`,
      next: "none; a script never pushes to a protected branch",
    };
  }
  const ownedByBot = policy.dco.bot_authors.some((bot) => sameLogin(bot, snapshot.author));
  if (!sameLogin(snapshot.author, ghUser) && !ownedByBot) {
    return {
      code: "not_owner",
      headline: `the PR author ${snapshot.author} is not the gh user ${ghUser} and not in dco.bot_authors`,
      next: "ask the PR author, or run the script as the author",
    };
  }
  if (snapshot.queueEntry !== null && !options.allowQueued) {
    return {
      code: "queued",
      headline: "the PR is in the merge queue; a push removes it from the queue",
      next: "run pr-merge dequeue first, then run this mode again",
    };
  }
  return null;
}
