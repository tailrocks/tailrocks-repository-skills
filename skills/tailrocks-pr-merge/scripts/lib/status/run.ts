// One verdict for one PR: gather, load the policy, add git facts, evaluate.

import { gatherBodyTemplate, gatherPr, type GatherCache } from "../github/gather.ts";
import { defaultGit, gatherGitFacts, unavailable, type GitRun } from "../github/git-facts.ts";
import { defaultGh, type GhRun } from "../github/graphql.ts";
import { fetchBasePolicy } from "../policy/fetch.ts";
import type { Policy, PolicyError, PolicySource } from "../policy/types.ts";
import type { RepoSlug, Sha } from "../types.ts";
import { evaluate, unknownVerdict } from "./evaluate.ts";
import type { PrSnapshot, Verdict } from "./types.ts";

export interface LocalPolicy {
  readonly policy: Policy;
}

export interface StatusConfig {
  readonly cwd: string;
  /** A local clone for git facts. Absent: carry-over is unknown. */
  readonly gitDir?: string;
  readonly localPolicy?: LocalPolicy;
  readonly cache: GatherCache;
  readonly policies: Map<string, Promise<PolicyLoad>>;
  /** Base commits already fetched into the local clone, as `branch@sha`. */
  readonly fetchedBases: Set<string>;
  /** Serializes git work in the one local clone. */
  readonly gitQueue: { tail: Promise<unknown> };
  readonly runGh?: GhRun;
  readonly runGit?: GitRun;
  readonly remote?: string;
}

export type PolicyLoad =
  | { readonly ok: true; readonly policy: Policy; readonly source: PolicySource }
  | { readonly ok: false; readonly unreadable: boolean; readonly errors: readonly PolicyError[] };

export type StatusResult =
  | { readonly kind: "verdict"; readonly verdict: Verdict; readonly snapshot: PrSnapshot | null }
  | { readonly kind: "policy-error"; readonly errors: readonly PolicyError[] };

/** Load the policy at one commit of the default branch. */
export function policyFor(repo: RepoSlug, defaultSha: Sha, config: StatusConfig, runGh: GhRun): Promise<PolicyLoad> {
  if (config.localPolicy !== undefined) {
    return Promise.resolve({ ok: true, policy: config.localPolicy.policy, source: "local" });
  }
  const key = `${repo}@${defaultSha}`;
  const known = config.policies.get(key);
  if (known !== undefined) {
    return known;
  }
  // A load that failed to read is never kept: the next read tries again.
  const unreadable = (message: string): PolicyLoad => {
    config.policies.delete(key);
    return { ok: false, unreadable: true, errors: [{ pointer: "", message }] };
  };
  const pending = fetchBasePolicy(repo, defaultSha, { cwd: config.cwd, runGh }).then(
    (result): PolicyLoad => {
      if (result.ok) {
        return { ok: true, policy: result.policy, source: result.source };
      }
      return result.unreadable === true
        ? unreadable(result.errors[0]?.message ?? "the policy could not be read")
        : { ok: false, unreadable: false, errors: result.errors };
    },
    (error: unknown): PolicyLoad => unreadable(`could not read the policy: ${error instanceof Error ? error.message : "unknown error"}`),
  );
  config.policies.set(key, pending);
  return pending;
}

/** Run git work one job at a time: parallel fetches in one clone would fight over its locks. */
function exclusive<T>(queue: { tail: Promise<unknown> }, job: () => Promise<T>): Promise<T> {
  const result = queue.tail.then(job, job);
  queue.tail = result.catch(() => undefined);
  return result;
}

export async function statusFor(repo: RepoSlug, number: number, config: StatusConfig): Promise<StatusResult> {
  const runGh = config.runGh ?? defaultGh(config.cwd);
  const gathered = await gatherPr(repo, number, { cwd: config.cwd, run: runGh, cache: config.cache });
  if (!gathered.ok) {
    return { kind: "verdict", verdict: unknownVerdict(repo, number, gathered.error), snapshot: null };
  }
  let snapshot = gathered.snapshot;
  // The policy comes from the default branch, never from the base of a stacked PR.
  const loaded = await policyFor(repo, snapshot.defaultSha, config, runGh);
  if (!loaded.ok) {
    if (loaded.unreadable) {
      // A failed read is not a verdict on the policy. Report it as an unknown state, so a caller can try again.
      const reason = loaded.errors[0]?.message ?? "the policy could not be read";
      return { kind: "verdict", verdict: unknownVerdict(repo, number, reason), snapshot: null };
    }
    return { kind: "policy-error", errors: loaded.errors };
  }
  const { policy, source } = loaded;
  if (policy.pr_body.enforce) {
    snapshot = { ...snapshot, bodyTemplate: await gatherBodyTemplate(runGh, repo, snapshot.defaultSha, policy.pr_body.template) };
  }
  const carryOver = policy.review.source === "comment-verdict" && policy.review.carry_over === "clean-base-merge";
  const git =
    config.gitDir === undefined && carryOver
      ? unavailable("no local clone was given (--git-dir)", snapshot.headSha)
      : await exclusive(config.gitQueue, () => gatherGitFacts(config.runGit ?? defaultGit(config.gitDir ?? config.cwd), {
          number,
          headSha: snapshot.headSha,
          baseRef: snapshot.baseRef,
          baseSha: snapshot.baseSha,
          reviewedCommits: snapshot.reviews.flatMap((r) => (r.commit === null ? [] : [r.commit])),
          carryOver,
          maxCarryMerges: policy.review.max_carry_merges,
          fetchBase: !config.fetchedBases.has(`${snapshot.baseRef}@${snapshot.baseSha}`),
          ...(config.remote === undefined ? {} : { remote: config.remote }),
        }));
  if (git.available) {
    config.fetchedBases.add(`${snapshot.baseRef}@${snapshot.baseSha}`);
  }
  snapshot = { ...snapshot, git };
  return { kind: "verdict", verdict: evaluate(snapshot, policy, source), snapshot };
}
