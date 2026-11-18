// Read the full thread state of one PR: the snapshot of pr-status, the base-branch
// policy, the threads with their comments, and the classes.

import { gatherPr, type GatherCache } from "../github/gather.ts";
import type { GitRun } from "../github/git-facts.ts";
import type { GhRun } from "../github/graphql.ts";
import { fetchBasePolicy } from "../policy/fetch.ts";
import type { Policy, PolicyError } from "../policy/types.ts";
import type { PrSnapshot } from "../status/types.ts";
import type { RepoSlug } from "../types.ts";
import { classifyAll, type ClassifyContext } from "./classify.ts";
import { readAgentLogin, readThreads } from "./read.ts";
import type { ClassifiedThread } from "./types.ts";

export interface ThreadsConfig {
  readonly cwd: string;
  readonly runGh: GhRun;
  /** A local clone. With it, `apply` proves that a fix commit is an ancestor of the head. */
  readonly gitDir?: string;
  readonly runGit?: GitRun;
  readonly cache?: GatherCache;
  /** Test seam for the wait between mergeability reads. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface ThreadState {
  readonly snapshot: PrSnapshot;
  readonly policy: Policy;
  readonly agent: string | null;
  /** All threads, resolved and unresolved. */
  readonly threads: readonly ClassifiedThread[];
  /** Problems that make a write unsafe. */
  readonly problems: readonly string[];
}

export type StateResult =
  | { readonly ok: true; readonly state: ThreadState }
  | { readonly ok: false; readonly kind: "policy"; readonly errors: readonly PolicyError[] }
  | { readonly ok: false; readonly kind: "unreadable"; readonly error: string };

export function unresolved(state: ThreadState): readonly ClassifiedThread[] {
  return state.threads.filter((t) => !t.detail.isResolved);
}

export async function readThreadState(repo: RepoSlug, number: number, config: ThreadsConfig): Promise<StateResult> {
  const gathered = await gatherPr(repo, number, {
    cwd: config.cwd,
    run: config.runGh,
    ...(config.cache === undefined ? {} : { cache: config.cache }),
    ...(config.sleep === undefined ? {} : { sleep: config.sleep }),
  });
  if (!gathered.ok) {
    return { ok: false, kind: "unreadable", error: gathered.error };
  }
  const { snapshot } = gathered;
  const loaded = await fetchBasePolicy(repo, snapshot.defaultSha, { cwd: config.cwd, runGh: config.runGh });
  if (!loaded.ok) {
    return { ok: false, kind: "policy", errors: loaded.errors };
  }
  const policy = loaded.policy;
  const problems = [...snapshot.problems];
  let read;
  try {
    read = await readThreads(config.runGh, snapshot.nodeId);
  } catch (error) {
    return { ok: false, kind: "unreadable", error: error instanceof Error ? error.message : "cannot read the review threads" };
  }
  problems.push(...read.problems);
  if (snapshot.threadsTruncated) {
    problems.push("review threads are truncated");
  }
  // The two reads must agree on the open threads, or the PR changed between them.
  const fromSnapshot = snapshot.threads.filter((t) => !t.isResolved).map((t) => t.id).sort();
  const fromDetails = read.threads.filter((t) => !t.isResolved).map((t) => t.id).sort();
  if (fromSnapshot.join("\n") !== fromDetails.join("\n")) {
    problems.push("the open review threads changed while they were read; run the script again");
  }
  const agent = await readAgentLogin(config.runGh);
  const context: ClassifyContext = { policy, prAuthor: snapshot.author, agent };
  return {
    ok: true,
    state: {
      snapshot,
      policy,
      agent,
      threads: classifyAll(read.threads, context),
      problems,
    },
  };
}
