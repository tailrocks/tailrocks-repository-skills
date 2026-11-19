// GraphQL rate-limit guard (replaces requeue.sh). Before a multi-PR run, read
// the budget. When it is too low, report and stop. `--wait` sleeps until the
// reset, bounded by a maximum.

import { type GhRun, isNotFound } from "./graphql.ts";
import { member, num, obj, parseJson, path, ReadError } from "./read.ts";

/** GraphQL points that one pull request read uses, with room for paging. */
export const ESTIMATED_POINTS_PER_PR = 8;
export const MAX_WAIT_SECONDS = 3600;

export interface RateLimit {
  readonly remaining: number;
  readonly limit: number;
  /** Epoch seconds. */
  readonly resetAt: number;
}

export async function readGraphqlLimit(run: GhRun): Promise<RateLimit> {
  const result = await run(["api", "-X", "GET", "rate_limit"]);
  if (result.code !== 0) {
    throw new ReadError(`rate_limit could not be read${isNotFound(result) ? " (not found)" : ""}: ${result.stderr.trim().split("\n")[0] ?? ""}`);
  }
  const graphql = path(obj(parseJson(result.stdout, "rate_limit"), "rate_limit"), "resources", "graphql");
  const o = obj(graphql, "rate_limit.graphql");
  return {
    remaining: num(member(o, "remaining"), "remaining"),
    limit: num(member(o, "limit"), "limit"),
    resetAt: num(member(o, "reset"), "reset"),
  };
}

export type Budget =
  | { readonly ok: true; readonly remaining: number }
  | { readonly ok: false; readonly message: string };

export interface BudgetOptions {
  readonly wait: boolean;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Check that `needed` points are left. Without `wait`, a low budget stops the run.
 * With `wait`, sleep until the reset when that is within MAX_WAIT_SECONDS.
 */
export async function ensureBudget(run: GhRun, needed: number, options: BudgetOptions): Promise<Budget> {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => Bun.sleep(ms));
  const first = await readGraphqlLimit(run);
  if (first.remaining >= needed) {
    return { ok: true, remaining: first.remaining };
  }
  const seconds = Math.max(0, Math.ceil(first.resetAt - now() / 1000));
  const when = new Date(first.resetAt * 1000).toISOString();
  const report = `GraphQL budget is ${first.remaining} of ${first.limit}; this run needs about ${needed}. The budget resets at ${when} (in ${seconds} seconds).`;
  if (!options.wait) {
    return { ok: false, message: `${report} Run again after the reset, or pass --wait.` };
  }
  if (seconds > MAX_WAIT_SECONDS) {
    return { ok: false, message: `${report} The wait is longer than ${MAX_WAIT_SECONDS} seconds, so the run stops.` };
  }
  await sleep((seconds + 2) * 1000);
  const second = await readGraphqlLimit(run);
  return second.remaining >= needed
    ? { ok: true, remaining: second.remaining }
    : { ok: false, message: `${report} The budget was still low after the wait.` };
}
