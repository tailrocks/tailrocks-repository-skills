// Read the policy file from the default branch at an exact commit.
// The policy never comes from the PR head or from the base of a stacked PR, so
// a PR cannot weaken its own gates.

import { gh } from "../gh.ts";
import type { RunResult } from "../proc.ts";
import { type RepoSlug, type Sha } from "../types.ts";
import { defaultPolicy, loadPolicy } from "./load.ts";
import type { PolicyResult } from "./types.ts";

export const POLICY_PATH = ".config/pr-policy.toml";

export type GhRun = (args: readonly string[]) => Promise<RunResult>;

export interface FetchPolicyOptions {
  readonly cwd: string;
  /** Test seam. Defaults to the guarded gh runner. */
  readonly runGh?: GhRun;
}

/**
 * Fetch and load the policy at `commit`, a commit of the default branch. A 404 means the repository has no
 * policy file: use the built-in defaults, with source "default".
 */
export async function fetchBasePolicy(
  repo: RepoSlug,
  commit: Sha,
  options: FetchPolicyOptions = { cwd: process.cwd() },
): Promise<PolicyResult> {
  const args = [
    "api",
    "-H",
    "Accept: application/vnd.github.raw+json",
    `repos/${repo}/contents/${POLICY_PATH}?ref=${commit}`,
  ];
  const result = await (options.runGh ?? ((a) => gh(a, { cwd: options.cwd })))(args);
  if (result.code === 0) {
    return loadPolicy({ text: result.stdout, source: "base-branch" });
  }
  if (/\bHTTP 404\b|Not Found/i.test(result.stderr)) {
    return defaultPolicy();
  }
  const detail = result.stderr.trim().split("\n")[0] ?? "";
  return {
    ok: false,
    unreadable: true,
    errors: [{ pointer: "", message: `could not read ${POLICY_PATH} at ${commit}: ${detail}` }],
  };
}
