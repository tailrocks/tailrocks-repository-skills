// Types of the plan that pr-create builds before it writes anything.

import type { GhRun } from "../github/graphql.ts";
import type { GitRun } from "../github/git-facts.ts";
import type { RunResult } from "../proc.ts";
import type { GhMutation } from "../safety-gh.ts";
import type { Policy, PolicyError, PolicySource } from "../policy/types.ts";
import type { RepoSlug, Sha } from "../types.ts";

export type FindingKind = "blocker" | "refusal" | "info";

export interface Finding {
  readonly code: string;
  /** blocker: the agent can fix it. refusal: only the user can decide. info: no action needed. */
  readonly kind: FindingKind;
  readonly detail: string;
  readonly next: string;
  readonly items: readonly string[];
}

export interface CreateArgs {
  readonly mode: "plan" | "open";
  readonly repo: string | null;
  readonly base: string | null;
  readonly branch: string | null;
  readonly issue: number | null;
  readonly title: string | null;
  readonly bodyFile: string | null;
  readonly expectHead: string | null;
  readonly partOf: boolean;
  readonly runCi: boolean;
  readonly labels: readonly string[];
  readonly allowUnsignedPushed: boolean;
  readonly remote: string;
  readonly json: boolean;
}

export interface OpenPr {
  readonly number: number;
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly headRef: string;
  readonly headSha: Sha;
  readonly baseRef: string;
  readonly isDraft: boolean;
  readonly isCrossRepository: boolean;
  readonly author: string;
}

export interface IssueFacts {
  readonly number: number;
  readonly state: string;
  readonly title: string;
  readonly url: string;
  /** The unchecked Done-when boxes of the issue. */
  readonly unchecked: readonly string[];
  readonly hasDoneWhen: boolean;
}

export type RemoteRelation = "absent" | "same" | "behind" | "diverged";

export interface LinkDecision {
  readonly kind: "Closes" | "Part of";
  /** The exact line that the final body holds. */
  readonly line: string;
  readonly unmapped: readonly string[];
  readonly reason: string;
  /** True when the body already holds the line, so the script adds nothing. */
  readonly present: boolean;
}

export interface Plan {
  readonly repo: RepoSlug;
  readonly user: string;
  readonly defaultBranch: string;
  readonly headBranch: string | null;
  readonly headSha: Sha;
  readonly base: {
    readonly ref: string;
    readonly sha: Sha;
    readonly stackedOn: { readonly number: number; readonly ref: string } | null;
  };
  readonly policy: Policy;
  readonly policySource: PolicySource;
  readonly remote: string;
  readonly remoteHead: Sha | null;
  readonly relation: RemoteRelation;
  readonly commitCount: number;
  readonly existing: OpenPr | null;
  readonly title: string | null;
  readonly draft: boolean;
  readonly labels: readonly string[];
  readonly issue: IssueFacts | null;
  readonly link: LinkDecision | null;
  readonly requiredHeadings: readonly string[];
  readonly skeleton: string | null;
  /** The body that open posts, when a body file was given and valid. */
  readonly finalBody: string | null;
  readonly prepushRan: readonly string[];
  readonly findings: readonly Finding[];
  readonly exit: 0 | 3 | 20;
  readonly next: string;
}

export type PlanResult =
  | { readonly kind: "plan"; readonly plan: Plan }
  | { readonly kind: "policy-error"; readonly errors: readonly PolicyError[] }
  | { readonly kind: "failed"; readonly error: string };

// ---------- Run configuration ----------


/** Runs one policy command (an argument array, never a shell string) in a directory. */
export type CommandRun = (argv: readonly string[], cwd: string) => Promise<RunResult>;
export type MutateRun = (op: GhMutation) => Promise<RunResult>;

export interface CreateConfig {
  readonly cwd: string;
  readonly runGh: GhRun;
  readonly runGit: GitRun;
  readonly runCommand: CommandRun;
  readonly mutate: MutateRun;
}
