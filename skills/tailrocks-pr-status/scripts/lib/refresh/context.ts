// Load the facts that every mode needs: the snapshot, the default-branch policy,
// and the gh user. Writing modes read the snapshot again before and after
// each write (`reread`).

import { gatherPr } from "../github/gather.ts";
import type { GhRun } from "../github/graphql.ts";
import type { GhMutation } from "../safety-gh.ts";
import { fetchBasePolicy } from "../policy/fetch.ts";
import { formatPolicyErrors } from "../policy/load.ts";
import type { Policy, PolicySource } from "../policy/types.ts";
import type { RunResult } from "../proc.ts";
import type { PrSnapshot } from "../status/types.ts";
import { parseRepoSlug, type Parsed, type RepoSlug, type Sha } from "../types.ts";
import type { GitRunner } from "./gitx.ts";
import { blocked, usage, type Outcome } from "./outcome.ts";

export interface RefreshDeps {
  /** The user's checkout. The script reads and fetches here. It never writes to its work tree. */
  readonly cwd: string;
  readonly remote: string;
  readonly worktreeRoot: string;
  /** Private directory for the state of kept worktrees. */
  readonly stateRoot: string;
  readonly runGh: GhRun;
  readonly mutate: (op: GhMutation) => Promise<RunResult>;
  readonly git: GitRunner;
  readonly sleep: (ms: number) => Promise<void>;
  /** Test seam: runs just before a push, after all checks. */
  readonly beforePush?: () => Promise<void>;
  /** Test seam: runs just before the DCO lease push, after the last remote check. */
  readonly beforeLease?: () => Promise<void>;
}

export interface PrContext {
  readonly repo: RepoSlug;
  readonly number: number;
  readonly snapshot: PrSnapshot;
  readonly policy: Policy;
  readonly policySource: PolicySource;
  readonly ghUser: string;
}

export type Loaded =
  | { readonly ok: true; readonly ctx: PrContext }
  | { readonly ok: false; readonly outcome: Outcome };

export async function resolveRepo(explicit: string | null, run: GhRun): Promise<Parsed<RepoSlug>> {
  if (explicit !== null) {
    return parseRepoSlug(explicit);
  }
  const result = await run(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
  const parsed = parseRepoSlug(result.stdout.trim());
  return result.code === 0 && parsed.ok ? parsed : { ok: false, error: "cannot find the repository; pass --repo owner/name" };
}

export async function readGhUser(run: GhRun): Promise<string | null> {
  const result = await run(["api", "user", "--jq", ".login"]);
  const login = result.stdout.trim();
  return result.code === 0 && /^[A-Za-z0-9][A-Za-z0-9[\]-]*$/.test(login) ? login : null;
}

/**
 * Read the PR. A writing mode is strict: any gather problem blocks it, because
 * the script does not write on a guess. The metadata mode needs only the title,
 * body, and head, so it tolerates problems in unrelated data (checks, rules).
 */
export async function readSnapshot(
  deps: RefreshDeps,
  repo: RepoSlug,
  number: number,
  strict = true,
): Promise<{ readonly ok: true; readonly snapshot: PrSnapshot } | { readonly ok: false; readonly outcome: Outcome }> {
  const gathered = await gatherPr(repo, number, { cwd: deps.cwd, run: deps.runGh, sleep: deps.sleep });
  if (!gathered.ok) {
    return { ok: false, outcome: blocked("unknown_state", `cannot read the PR: ${gathered.error}`, "run pr-status, then try again") };
  }
  if (strict && gathered.snapshot.problems.length > 0) {
    return {
      ok: false,
      outcome: blocked(
        "unknown_state",
        "the PR state is incomplete; the script does not write on a guess",
        "run pr-status, then try again",
        gathered.snapshot.problems.slice(0, 5),
      ),
    };
  }
  return { ok: true, snapshot: gathered.snapshot };
}

/** Read the PR, the policy at the base commit, and the gh user. */
export async function loadContext(deps: RefreshDeps, repo: RepoSlug, number: number, writesBranch = true): Promise<Loaded> {
  const read = await readSnapshot(deps, repo, number, writesBranch);
  if (!read.ok) {
    return read;
  }
  const { snapshot } = read;
  // The policy comes from the default branch at its current commit, never from the base of a stacked PR.
  const policy = await fetchBasePolicy(repo, snapshot.defaultSha, { cwd: deps.cwd, runGh: deps.runGh });
  if (!policy.ok) {
    return { ok: false, outcome: usage("the repository policy is invalid", formatPolicyErrors(policy.errors).split("\n")) };
  }
  const ghUser = writesBranch ? await readGhUser(deps.runGh) : "";
  if (ghUser === null) {
    return { ok: false, outcome: blocked("unknown_state", "cannot read the gh user", "run gh auth status") };
  }
  return { ok: true, ctx: { repo, number, snapshot, policy: policy.policy, policySource: policy.source, ghUser } };
}

/** Read the PR again and compare it with the plan. A head change gives a blocked outcome. */
export async function reread(
  deps: RefreshDeps,
  ctx: PrContext,
  expectedHead: string,
  allowQueued: boolean,
): Promise<{ readonly ok: true; readonly snapshot: PrSnapshot } | { readonly ok: false; readonly outcome: Outcome }> {
  const read = await readSnapshot(deps, ctx.repo, ctx.number);
  if (!read.ok) {
    return read;
  }
  const { snapshot } = read;
  if (snapshot.headSha !== expectedHead) {
    return {
      ok: false,
      outcome: blocked(
        "head_moved",
        `the PR head changed from ${expectedHead.slice(0, 7)} to ${snapshot.headSha.slice(0, 7)} during the run; nothing was written`,
        "run the mode again",
      ),
    };
  }
  if (snapshot.state !== "OPEN") {
    return { ok: false, outcome: blocked("pr_not_open", `the PR is ${snapshot.state.toLowerCase()}`, "none; report the state") };
  }
  if (snapshot.queueEntry !== null && !allowQueued) {
    return {
      ok: false,
      outcome: blocked("queued", "the PR entered the merge queue during the run; nothing was written", "run pr-merge dequeue, then run the mode again"),
    };
  }
  return { ok: true, snapshot };
}

/** After a push: wait a little for GitHub to show the new head. Returns a note when it does not. */
export async function confirmHead(deps: RefreshDeps, ctx: PrContext, expected: Sha): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const read = await readSnapshot(deps, ctx.repo, ctx.number, false);
    if (read.ok && read.snapshot.headSha === expected) {
      return null;
    }
    if (attempt < 2) {
      await deps.sleep(2000);
    }
  }
  return `GitHub did not show the new head ${expected.slice(0, 7)} yet; run pr-status later`;
}
