// Guarded `git` runner. Every call passes the allow-list first.

import type { DcoCapability } from "./dco-capability.ts";
import { assertAllowed } from "./guard.ts";
import { run, runBytes, type BytesResult, type RunOptions, type RunResult } from "./proc.ts";
import { checkGit, checkGitDcoPush } from "./safety-git.ts";

// Never wait for a prompt or an editor.
const GIT_ENV: Readonly<Record<string, string>> = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_EDITOR: "true",
  GIT_MERGE_AUTOEDIT: "no",
};

/** Run an allow-listed `git` command. Throws SafetyError on refusal. */
export async function git(args: readonly string[], options: RunOptions): Promise<RunResult> {
  assertAllowed(checkGit(args), `git ${args[0] ?? ""}`);
  return run(["git", ...args], { ...options, env: { ...GIT_ENV, ...options.env } });
}

/** Run an allow-listed `git` command and return stdout as raw bytes. */
export async function gitBytes(args: readonly string[], options: RunOptions): Promise<BytesResult> {
  assertAllowed(checkGit(args), `git ${args[0] ?? ""}`);
  return runBytes(["git", ...args], { ...options, env: { ...GIT_ENV, ...options.env } });
}

export interface DcoPushRequest {
  readonly remote: string;
}

/**
 * The only force-capable push. The capability fixes the branch, the old head
 * that the lease checks, and the new head. If the remote moved, git refuses.
 */
export async function pushDcoRewrite(
  capability: DcoCapability,
  request: DcoPushRequest,
  options: RunOptions,
): Promise<RunResult> {
  const { branch, oldHead, newHead } = capability.grant;
  const args = [
    "push",
    `--force-with-lease=${branch}:${oldHead}`,
    request.remote,
    `${newHead}:refs/heads/${branch}`,
  ];
  assertAllowed(checkGitDcoPush(args, capability), "git push (DCO rewrite)");
  return run(["git", ...args], { ...options, env: { ...GIT_ENV, ...options.env } });
}
