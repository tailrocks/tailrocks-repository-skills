// Small helpers around the guarded git runner. Every call still passes the
// allow-list in lib/safety-git.ts.

import { git, gitBytes } from "../git.ts";
import type { BytesResult, RunOptions, RunResult } from "../proc.ts";
import { parseSha, type Sha } from "../types.ts";

/** The guarded runner, or a test wrapper that delegates to it. */
export type GitRunner = (args: readonly string[], options: RunOptions) => Promise<RunResult>;

export const guardedGit: GitRunner = git;

export type GitBytesRunner = (args: readonly string[], options: RunOptions) => Promise<BytesResult>;

export const guardedGitBytes: GitBytesRunner = gitBytes;

// A refresh runs unattended in a temporary worktree. It never runs the hooks
// of the user's repository: the policy `[[prepush]]` steps replace them. It
// keeps the rest of the user's git configuration, so commit signing stays as
// the user set it.
export const REFRESH_GIT_ENV: Readonly<Record<string, string>> = {
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "core.hooksPath",
  GIT_CONFIG_VALUE_0: "/dev/null",
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
  /** Like `run`, with stdout as raw bytes. */
  readonly bytes: (args: readonly string[]) => Promise<BytesResult>;
}

export function repoAt(cwd: string, runner: GitRunner, bytesRunner: GitBytesRunner = guardedGitBytes): Repo {
  return {
    cwd,
    bytes: (args) => bytesRunner(args, { cwd, env: REFRESH_GIT_ENV }),
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
