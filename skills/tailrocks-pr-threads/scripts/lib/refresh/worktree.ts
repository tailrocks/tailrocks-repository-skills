// A temporary worktree at an exact path under the OS temp directory (or the
// given root). It never touches the user's checkout.
//
// Cleanup deletes only paths that were recorded and checked right after
// `git worktree add`: the worktree path, the git admin directory that git made
// for it, and the mkdtemp directory. Nothing inside the worktree is trusted for
// a deletion, because policy steps and PR code run in that tree and can rewrite
// it. A kept worktree is described by a state file in a private directory
// outside the worktree (lib/refresh/state.ts). Before a delete, each recorded
// path is checked again with realpath and lstat: no symlink, inside its
// expected root, and the admin directory must link back to this exact worktree.

import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { type GitRunner, must, repoAt, type Repo } from "./gitx.ts";
import { findState, removeState, writeState, type KeptState } from "./state.ts";

const DIRECTORY_PREFIX = "pr-refresh-";

/** What the caller tells the state file about the PR. The rest comes from the recorded paths. */
export interface KeepInfo {
  readonly repo: string;
  readonly number: number;
  readonly remote: string;
  readonly headRef: string;
  readonly headSha: string;
  readonly baseRef: string;
  readonly baseSha: string;
  /** Paths that conflicted when the merge stopped, read from git. */
  readonly conflicts: readonly string[];
}

interface Recorded {
  /** realpath of the root that holds the mkdtemp directory. */
  readonly root: string;
  readonly directory: string;
  readonly path: string;
  readonly adminDir: string;
  /** realpath of the git common directory of the user's checkout. */
  readonly commonDir: string;
  /** The state file of a kept worktree. Null until the worktree is kept. */
  readonly stateFile: string | null;
}

export interface WorktreeHandle {
  readonly path: string;
  readonly repo: Repo;
  readonly recorded: Recorded;
  /** Keep the worktree after the work ends, with a marker that `continue` and `abort` check. */
  readonly keep: (info: KeepInfo) => { readonly id: string };
  /** True while git in the worktree still reads the recorded admin directory. */
  readonly intact: () => Promise<boolean>;
}

export interface WorktreeOptions {
  readonly cwd: string;
  readonly root: string;
  readonly runner: GitRunner;
  /** The private directory for the state of kept worktrees. */
  readonly stateRoot: string;
  /** Called with a note when cleanup refuses or fails to delete something. */
  readonly onProblem?: (note: string) => void;
}

function isInside(child: string, parent: string): boolean {
  return child.startsWith(`${parent}${sep}`);
}

function isPlainDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function realOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** The admin directory must be a direct child of `<common dir>/worktrees`, and not a link. */
function adminDirOk(recorded: Recorded): boolean {
  return (
    isPlainDirectory(recorded.adminDir) &&
    realOrNull(recorded.adminDir) === recorded.adminDir &&
    dirname(recorded.adminDir) === join(recorded.commonDir, "worktrees") &&
    adminLinksBack(recorded)
  );
}

/** Git writes `<admin dir>/gitdir` with the path of this worktree's `.git` file. It ties the admin dir to one worktree. */
function adminLinksBack(recorded: Recorded): boolean {
  try {
    return readFileSync(join(recorded.adminDir, "gitdir"), "utf8").trim() === join(recorded.path, ".git");
  } catch {
    return false;
  }
}

function worktreePathOk(recorded: Recorded): boolean {
  return (
    isPlainDirectory(recorded.path) &&
    realOrNull(recorded.path) === recorded.path &&
    dirname(recorded.path) === recorded.directory &&
    basename(recorded.path) === "work"
  );
}

function directoryOk(recorded: Recorded): boolean {
  return (
    isPlainDirectory(recorded.directory) &&
    realOrNull(recorded.directory) === recorded.directory &&
    dirname(recorded.directory) === recorded.root &&
    basename(recorded.directory).startsWith(DIRECTORY_PREFIX)
  );
}

async function currentAdminDir(repo: Repo): Promise<string> {
  return realpathSync((await must(repo, ["rev-parse", "--absolute-git-dir"])).trim());
}

async function commonDirOf(cwd: string, runner: GitRunner): Promise<string> {
  const origin = repoAt(cwd, runner);
  return realpathSync(resolve(cwd, (await must(origin, ["rev-parse", "--git-common-dir"])).trim()));
}

function handleFor(
  recorded: Recorded,
  options: WorktreeOptions,
  keepFlag: { kept: boolean; stateFile: string | null },
): WorktreeHandle {
  const repo = repoAt(recorded.path, options.runner);
  const handle: WorktreeHandle = {
    path: recorded.path,
    repo,
    get recorded() {
      return { ...recorded, stateFile: keepFlag.stateFile ?? recorded.stateFile };
    },
    keep: (info) => {
      const written = writeState(options.stateRoot, {
        ...info,
        worktreePath: recorded.path,
        directory: recorded.directory,
        root: recorded.root,
        adminDir: recorded.adminDir,
        commonDir: recorded.commonDir,
      });
      keepFlag.kept = true;
      keepFlag.stateFile = written.file;
      return { id: written.id };
    },
    intact: async () => {
      try {
        return (await currentAdminDir(repo)) === recorded.adminDir;
      } catch {
        return false;
      }
    },
  };
  return handle;
}

/** Remove the worktree by the recorded paths. Returns a note when something was refused. */
export async function removeWorktree(recorded: Recorded, options: WorktreeOptions): Promise<string | null> {
  const notes: string[] = [];
  const origin = repoAt(options.cwd, options.runner);
  if (existsSync(recorded.path)) {
    const removed = await origin.run(["worktree", "remove", recorded.path]);
    if (removed.code !== 0 && existsSync(recorded.path)) {
      // Git refuses a dirty worktree. Delete the recorded paths, after the checks.
      if (worktreePathOk(recorded)) {
        rmSync(recorded.path, { recursive: true, force: true });
      } else {
        notes.push(`left ${recorded.path}: it is not the worktree that was made (a link, or moved)`);
      }
      if (existsSync(recorded.adminDir)) {
        if (adminDirOk(recorded)) {
          rmSync(recorded.adminDir, { recursive: true, force: true });
        } else {
          notes.push(`left ${recorded.adminDir}: it is not a git admin directory of this repository`);
        }
      }
    }
  }
  if (existsSync(recorded.directory)) {
    if (directoryOk(recorded) && !existsSync(recorded.path)) {
      rmSync(recorded.directory, { recursive: true, force: true });
    } else {
      notes.push(`left ${recorded.directory}: it still holds files, or it is not the directory that was made`);
    }
  }
  if (recorded.stateFile !== null) {
    removeState(recorded.stateFile);
  }
  return notes.length === 0 ? null : `cleanup note: ${notes.join("; ")}`;
}

/**
 * Run `work` in a detached worktree at `sha`. The directory name is made by
 * mkdtemp, so no other process owns it. The work may call `handle.keep` to
 * leave the worktree in place; the caller then owns the cleanup.
 */
export async function withWorktree<T>(
  options: WorktreeOptions,
  sha: string,
  work: (worktree: WorktreeHandle) => Promise<T>,
): Promise<T> {
  const root = realpathSync(options.root);
  const directory = mkdtempSync(join(root, DIRECTORY_PREFIX));
  const path = join(directory, "work");
  const origin = repoAt(options.cwd, options.runner);
  let recorded: Recorded | null = null;
  const keepFlag: { kept: boolean; stateFile: string | null } = { kept: false, stateFile: null };
  try {
    const added = await origin.run(["worktree", "add", "--detach", path, sha]);
    if (added.code !== 0) {
      throw new Error(`cannot create the temporary worktree: ${added.stderr.trim().split("\n")[0] ?? ""}`);
    }
    const commonDir = await commonDirOf(options.cwd, options.runner);
    const adminDir = await currentAdminDir(repoAt(path, options.runner));
    const candidate: Recorded = { root, directory: realpathSync(directory), path: realpathSync(path), adminDir, commonDir, stateFile: null };
    recorded = candidate;
    if (!directoryOk(candidate) || !worktreePathOk(candidate) || !adminDirOk(candidate)) {
      throw new Error("the new worktree is not where it should be; the script made no change in it");
    }
    return await work(handleFor(candidate, options, keepFlag));
  } finally {
    if (!keepFlag.kept) {
      if (recorded !== null) {
        const note = await removeWorktree(recorded, options);
        if (note !== null) {
          options.onProblem?.(note);
        }
      } else if (isPlainDirectory(directory)) {
        // `worktree add` failed or the checks failed: the mkdtemp directory is the only thing made.
        rmSync(directory, { recursive: true, force: true });
      }
    }
  }
}

// ---------- A kept worktree ----------

export type OpenResult =
  | { readonly ok: true; readonly handle: WorktreeHandle; readonly state: KeptState }
  | { readonly ok: false; readonly reason: string };

/** The paths that `git worktree list --porcelain` reports for the main repository. */
async function listedWorktrees(options: WorktreeOptions): Promise<readonly string[]> {
  const origin = repoAt(options.cwd, options.runner);
  const text = await must(origin, ["worktree", "list", "--porcelain"]);
  return text
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => realOrNull(line.slice("worktree ".length)) ?? line.slice("worktree ".length));
}

/**
 * Check that `worktreePath` is a library worktree of this checkout, and read its
 * state from the private state directory. The state is looked up by the exact
 * path. The admin directory to delete must come from the state, lie directly
 * under `<git-common-dir>/worktrees`, link back to this path, and the main
 * repository must list this path as a worktree.
 */
export async function openKeptWorktree(options: WorktreeOptions, worktreePath: string, requireIntact: boolean): Promise<OpenResult> {
  const fail = (reason: string): OpenResult => ({ ok: false, reason });
  const path = realOrNull(worktreePath);
  const root = realOrNull(options.root);
  if (path === null || root === null) {
    return fail("the worktree path does not exist");
  }
  const found = findState(options.stateRoot, path);
  if (!found.ok) {
    return fail(found.reason);
  }
  const { state } = found;
  const directory = dirname(path);
  const recorded: Recorded = { root, directory, path, adminDir: state.adminDir, commonDir: state.commonDir, stateFile: found.file };
  if (state.directory !== directory || state.root !== root) {
    return fail("the worktree is not under the recorded directory");
  }
  let common: string;
  try {
    common = await commonDirOf(options.cwd, options.runner);
  } catch {
    return fail("the current directory is not a git checkout");
  }
  if (common !== state.commonDir) {
    return fail("the worktree belongs to another repository checkout");
  }
  if (!directoryOk(recorded) || !worktreePathOk(recorded) || !adminDirOk(recorded)) {
    return fail("the worktree paths are not the ones that were recorded, or the admin directory does not link back to this worktree");
  }
  if (!(await listedWorktrees(options)).includes(path)) {
    return fail("the main repository does not list this path as a worktree");
  }
  const handle = handleFor(recorded, options, { kept: false, stateFile: found.file });
  if (requireIntact && !(await handle.intact())) {
    return fail("git in the worktree no longer reads the recorded admin directory; run abort");
  }
  return { ok: true, handle, state };
}
