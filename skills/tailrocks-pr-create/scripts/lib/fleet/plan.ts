// Build the fleet plan: list the open PRs, load the default-branch policy, read
// each PR that is not held with the pr-status logic, and analyze the result.
// Everything here only reads.

import { newGatherCache } from "../github/gather.ts";
import { ESTIMATED_POINTS_PER_PR, ensureBudget } from "../github/rate-limit.ts";
import { matchesAnyGlob } from "../glob.ts";
import { formatPolicyErrors } from "../policy/load.ts";
import type { Policy } from "../policy/types.ts";
import { policyFor, statusFor, type StatusConfig } from "../status/run.ts";
import type { MergeIo, SharedState } from "../merge/types.ts";
import type { RepoSlug } from "../types.ts";
import { analyze, freezeSource, type Read } from "./analyze.ts";
import { listOpen, readOrphanRuns, type OpenPr } from "./list.ts";
import { EXIT, type Plan, type RefreshPort } from "./types.ts";

export interface FleetDeps {
  readonly cwd: string;
  readonly io: MergeIo;
  /** Absent until pr-refresh is on main. Refresh actions are then pending. */
  readonly refresh: RefreshPort | null;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly gitDir: string | null;
  /** A local policy file. The plan is then advisory and apply refuses it. */
  readonly localPolicy: Policy | null;
  readonly wait: boolean;
  readonly shared: SharedState;
}

export type PlanResult =
  | { readonly ok: true; readonly plan: Plan; readonly reads: readonly Read[] }
  | { readonly ok: false; readonly exit: number; readonly message: string };

const CONCURRENCY = 4;

export function statusConfig(deps: FleetDeps): StatusConfig {
  return {
    cwd: deps.cwd,
    runGh: deps.io.runGh,
    cache: newGatherCache(),
    policies: deps.shared.policies,
    fetchedBases: deps.shared.fetchedBases,
    gitQueue: deps.shared.gitQueue,
    ...(deps.gitDir === null ? {} : { gitDir: deps.gitDir }),
    ...(deps.localPolicy === null ? {} : { localPolicy: { policy: deps.localPolicy } }),
  };
}

type Collected = { readonly ok: true; readonly reads: readonly Read[] } | { readonly ok: false; readonly message: string };

/** Read the PRs with a small worker pool. The result keeps the order of `prs`. */
async function collect(repo: RepoSlug, prs: readonly OpenPr[], config: StatusConfig): Promise<Collected> {
  const results: (Read | undefined)[] = prs.map(() => undefined);
  let failure: string | null = null;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (failure === null) {
      const index = next;
      next += 1;
      const pr = prs[index];
      if (pr === undefined) {
        return;
      }
      const status = await statusFor(repo, pr.number, config);
      if (status.kind === "policy-error") {
        failure = `invalid policy:\n${formatPolicyErrors(status.errors)}`;
        return;
      }
      results[index] = { pr, verdict: status.verdict, snapshot: status.snapshot };
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, prs.length) }, worker));
  if (failure !== null) {
    return { ok: false, message: failure };
  }
  return { ok: true, reads: results.flatMap((r) => (r === undefined ? [] : [r])) };
}

export async function buildPlan(repo: RepoSlug, deps: FleetDeps): Promise<PlanResult> {
  const runGh = deps.io.runGh;
  const config = statusConfig(deps);
  let list: Awaited<ReturnType<typeof listOpen>>;
  try {
    list = await listOpen(runGh, repo);
  } catch (error) {
    return { ok: false, exit: EXIT.usage, message: error instanceof Error ? error.message : "cannot list the pull requests" };
  }

  // The fleet policy comes from the default branch at its current commit, and from no other source.
  const loaded = await policyFor(repo, list.defaultSha, config, runGh);
  if (!loaded.ok) {
    const prefix = loaded.unreadable ? "cannot read the policy" : "invalid policy";
    return { ok: false, exit: EXIT.usage, message: `${prefix}:\n${formatPolicyErrors(loaded.errors)}` };
  }
  const { policy, source } = loaded;
  // Every verdict of this run reads the policy by the key `repo@default sha`, so it reuses this load.
  const held = list.prs.filter((pr) => policy.fleet.hold.includes(pr.number)).map((pr) => pr.number);
  const readable = list.prs.filter((pr) => !held.includes(pr.number));

  try {
    const budget = await ensureBudget(runGh, (readable.length + 1) * ESTIMATED_POINTS_PER_PR, { wait: deps.wait });
    if (!budget.ok) {
      return { ok: false, exit: EXIT.usage, message: budget.message };
    }
  } catch (error) {
    return { ok: false, exit: EXIT.usage, message: error instanceof Error ? error.message : "cannot read the GraphQL budget" };
  }

  const collected = await collect(repo, readable, config);
  if (!collected.ok) {
    return { ok: false, exit: EXIT.usage, message: collected.message };
  }

  const orphanRuns = await readOrphanRuns(runGh, repo, {
    openBranches: new Set(list.prs.map((pr) => pr.headRef)),
    isBaseBranch: (branch) => branch === list.defaultBranch || matchesAnyGlob(policy.branches.protected, branch),
  });

  const plan = analyze({
    repo,
    defaultBranch: list.defaultBranch,
    fleet: { policy, source, sha: list.defaultSha },
    advisory: source === "local",
    frozen: freezeSource(policy, deps.env),
    open: list.prs.length,
    held,
    reads: collected.reads,
    orphanRuns,
    refreshAvailable: deps.refresh !== null,
  });
  return { ok: true, plan, reads: collected.reads };
}
