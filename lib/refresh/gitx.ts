// Small helpers around the guarded git runner. Every call still passes the
// allow-list in lib/safety-git.ts.

import { git } from "../git.ts";
import type { RunOptions, RunResult } from "../proc.ts";
import { parseSha, type Sha } from "../types.ts";

/** The guarded runner, or a test wrapper that delegates to it. */
export type GitRunner = (args: readonly string[], options: RunOptions) => Promise<RunResult>;

export const guardedGit: GitRunner = git;

// A refresh runs unattended in a temporary worktree. It never runs the hooks
// of the user's repository, and it never waits for a signing prompt.
export const REFRESH_GIT_ENV: Readonly<Record<string, string>> = {
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: "core.hooksPath",
  GIT_CONFIG_VALUE_0: "/dev/null",
  GIT_CONFIG_KEY_1: "commit.gpgsign",
  GIT_CONFIG_VALUE_1: "false",
};

export class GitFailure extends Error {
  override readonly name = "GitFailure";
}

export interface ExtraOptions {
  readonly stdin?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface Repo {
  readonly cwd: string;
  readonly run: (args: readonly string[], extra?: ExtraOptions) => Promise<RunResult>;
}

export function repoAt(cwd: string, runner: GitRunner): Repo {
  return {
    cwd,
    run: (args, extra = {}) =>
      runner(args, {
        cwd,
        env: { ...REFRESH_GIT_ENV, ...extra.env },
        ...(extra.stdin === undefined ? {} : { stdin: extra.stdin }),
      }),
  };
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}

/** Run git. Throws GitFailure on a non-zero exit. Returns stdout, untrimmed. */
export async function must(repo: Repo, args: readonly string[], extra?: ExtraOptions): Promise<string> {
  const result = await repo.run(args, extra);
  if (result.code !== 0) {
    throw new GitFailure(`git ${args[0] ?? ""} failed: ${firstLine(result.stderr) || `exit ${result.code}`}`);
  }
  return result.stdout;
}

export async function mustSha(repo: Repo, args: readonly string[]): Promise<Sha> {
  const text = (await must(repo, args)).trim();
  const parsed = parseSha(text);
  if (!parsed.ok) {
    throw new GitFailure(`git ${args[0] ?? ""} did not print a commit id`);
  }
  return parsed.value;
}

/** Exit 0 gives true, exit 1 gives false, anything else throws. */
export async function yesNo(repo: Repo, args: readonly string[]): Promise<boolean> {
  const result = await repo.run(args);
  if (result.code === 0) {
    return true;
  }
  if (result.code === 1) {
    return false;
  }
  throw new GitFailure(`git ${args[0] ?? ""} failed: ${firstLine(result.stderr) || `exit ${result.code}`}`);
}

/** Split NUL-separated git output (`-z`) into names. */
export function splitNul(text: string): readonly string[] {
  return text.split("\0").filter((name) => name !== "");
}

export function parseShaOrThrow(text: string): Sha {
  const parsed = parseSha(text);
  if (!parsed.ok) {
    throw new GitFailure(`"${text}" is not a commit id`);
  }
  return parsed.value;
}
