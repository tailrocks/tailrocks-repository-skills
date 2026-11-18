// Guarded `gh` runner. Every call passes the allow-list first.

import { assertAllowed } from "./guard.ts";
import { run, type RunOptions, type RunResult } from "./proc.ts";
import { checkGh, ghMutationArgv, type GhMutation } from "./safety-gh.ts";

// Never wait for a prompt or an update check.
const GH_ENV: Readonly<Record<string, string>> = {
  GH_PROMPT_DISABLED: "1",
  GH_NO_UPDATE_NOTIFIER: "1",
};

export type GhRunner = (args: readonly string[], cwd: string) => Promise<RunResult>;

/** Run an allow-listed `gh` command. Throws SafetyError on refusal. */
export async function gh(args: readonly string[], options: RunOptions): Promise<RunResult> {
  assertAllowed(checkGh(args), `gh ${args.slice(0, 2).join(" ")}`);
  return run(["gh", ...args], { ...options, env: { ...GH_ENV, ...options.env } });
}

/** Run one typed mutation. The argv comes from `ghMutationArgv`, never from free text. */
export async function ghMutate(op: GhMutation, options: RunOptions): Promise<RunResult> {
  return run(["gh", ...ghMutationArgv(op)], { ...options, env: { ...GH_ENV, ...options.env } });
}
