// Pure checks of the plan: branch names, remote URLs, sign-off, inventories.

import { matchesAnyGlob } from "../glob.ts";
import type { Policy } from "../policy/types.ts";
import { signoffRequired } from "../policy-steps.ts";
import { normalizeLogin } from "../status/text.ts";
import type { Sha } from "../types.ts";

export interface CommitInfo {
  readonly sha: Sha;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly subject: string;
  readonly message: string;
}

// ---------- Branch ----------

export interface BranchProblem {
  readonly code: "on_protected_branch" | "branch_name";
  readonly detail: string;
}

/** A reason that the branch name breaks the policy, or null. */
export function branchProblem(branch: string, policy: Policy, defaultBranch: string): BranchProblem | null {
  if (branch === defaultBranch || matchesAnyGlob(policy.branches.protected, branch)) {
    return { code: "on_protected_branch", detail: `the branch ${branch} is the default branch or a protected branch` };
  }
  if (policy.branches.name_pattern !== "" && !new RegExp(policy.branches.name_pattern).test(branch)) {
    return {
      code: "branch_name",
      detail: `the branch name ${branch} does not match branches.name_pattern ${policy.branches.name_pattern}`,
    };
  }
  return null;
}

// ---------- Remote ----------

const URL_FORMS: readonly RegExp[] = [
  /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?[^/:]+(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  /^(?:[^@/\s]+@)?[^/:\s]+:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/,
];

/** owner/name that a remote URL names. Null for a local path or an unknown form. */
export function remoteRepoSlug(url: string): string | null {
  const text = url.trim();
  if (text.startsWith("/") || text.startsWith(".") || text.startsWith("file:")) {
    return null;
  }
  for (const form of URL_FORMS) {
    const match = form.exec(text);
    if (match !== null) {
      return `${match[1] ?? ""}/${match[2] ?? ""}`;
    }
  }
  return null;
}

// ---------- Sign-off ----------

function localPart(email: string): string {
  const name = email.split("@")[0] ?? "";
  // GitHub noreply addresses read id+login@users.noreply.github.com.
  return name.includes("+") ? (name.split("+")[1] ?? "") : name;
}

function isBotAuthor(commit: CommitInfo, bots: readonly string[]): boolean {
  const names = [normalizeLogin(commit.authorName), normalizeLogin(localPart(commit.authorEmail))];
  return bots.some((bot) => names.includes(normalizeLogin(bot)));
}

/** True when the policy wants a Signed-off-by line on this commit and it has none. */
export function needsSignoff(commit: CommitInfo, policy: Policy): boolean {
  return signoffRequired(policy, commit.message, isBotAuthor(commit, policy.dco.bot_authors));
}

/** Commits without a Signed-off-by trailer that the DCO policy does not exempt. */
export function unsignedCommits(commits: readonly CommitInfo[], policy: Policy): readonly CommitInfo[] {
  return commits.filter((commit) => needsSignoff(commit, policy));
}
