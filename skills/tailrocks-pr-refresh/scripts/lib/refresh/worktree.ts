// A temporary worktree at an exact path under the OS temp directory (or the
// given root). It never touches the user's checkout. It is removed by its
// exact path when the work ends, also when the work throws.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Sha } from "../types.ts";
import { type GitRunner, repoAt, type Repo } from "./gitx.ts";

export interface WorktreeHandle {
  readonly path: string;
  readonly repo: Repo;
}

/** The admin directory that `git worktree add` made, read from the `.git` file of the worktree. */
function adminDirectoryOf(path: string): string | null {
  try {
    const line = readFileSync(join(path, ".git"), "utf8").trim();
    const match = /^gitdir:\s*(\/\S+)$/.exec(line);
    const dir = match?.[1] ?? "";
    return /\/worktrees\/[^/]+$/.test(dir) ? dir : null;
  } catch {
    return null;
  }
}

/**
 * Run `work` in a detached worktree at `sha`. The directory name is made by
 * mkdtemp, so no other process owns it. Cleanup first asks git to remove the
 * worktree. When git refuses (generated files make it dirty), cleanup deletes
 * the exact worktree path and the exact admin directory that git made for it.
 */
export async function withWorktree<T>(
  options: { readonly cwd: string; readonly root: string; readonly runner: GitRunner },
  sha: Sha,
  work: (worktree: WorktreeHandle) => Promise<T>,
): Promise<T> {
  const directory = mkdtempSync(join(options.root, "pr-refresh-"));
  const path = join(directory, "work");
  const origin = repoAt(options.cwd, options.runner);
  try {
    const added = await origin.run(["worktree", "add", "--detach", path, sha]);
    if (added.code !== 0) {
      throw new Error(`cannot create the temporary worktree: ${added.stderr.trim().split("\n")[0] ?? ""}`);
    }
    return await work({ path, repo: repoAt(path, options.runner) });
  } finally {
    const admin = adminDirectoryOf(path);
    const removed = existsSync(path) ? await origin.run(["worktree", "remove", path]) : { code: 0 };
    if (removed.code !== 0) {
      rmSync(path, { recursive: true, force: true });
      if (admin !== null) {
        rmSync(admin, { recursive: true, force: true });
      }
    }
    rmSync(directory, { recursive: true, force: true });
  }
}
