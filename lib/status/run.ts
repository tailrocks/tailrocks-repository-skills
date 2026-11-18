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
  | { readonly ok: false; readonly errors: readonly PolicyError[] };

export type StatusResult =
  | { readonly kind: "verdict"; readonly verdict: Verdict; readonly snapshot: PrSnapshot | null }
  | { readonly kind: "policy-error"; readonly errors: readonly PolicyError[] };

export function policyFor(repo: RepoSlug, baseSha: Sha, config: StatusConfig, runGh: GhRun): Promise<PolicyLoad> {
  if (config.localPolicy !== undefined) {
    return Promise.resolve({ ok: true, policy: config.localPolicy.policy, source: "local" });
  }
  const key = `${repo}@${baseSha}`;
  const known = config.policies.get(key);
  if (known !== undefined) {
    return known;
  }
  const pending = fetchBasePolicy(repo, baseSha, { cwd: config.cwd, runGh }).then(
    (result): PolicyLoad => (result.ok ? { ok: true, policy: result.policy, source: result.source } : { ok: false, errors: result.errors }),
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
  const loaded = await policyFor(repo, snapshot.baseSha, config, runGh);
  if (!loaded.ok) {
    return { kind: "policy-error", errors: loaded.errors };
  }
  const { policy, source } = loaded;
  if (policy.pr_body.enforce) {
    snapshot = { ...snapshot, bodyTemplate: await gatherBodyTemplate(runGh, repo, snapshot.baseSha, policy.pr_body.template) };
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
