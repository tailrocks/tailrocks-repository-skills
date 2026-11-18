// A temporary worktree at an exact path under the OS temp directory (or the
// given root). It never touches the user's checkout.
//
// Cleanup deletes only paths that were recorded and checked right after
// `git worktree add`: the worktree path, the git admin directory that git made
// for it, and the mkdtemp directory. The `.git` file inside the worktree is
// never trusted for a deletion, because policy steps and PR code run in that
// tree and can rewrite it. Before a delete, each recorded path is checked again
// with realpath and lstat: no symlink, and inside its expected root.

import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { arr, member, num, obj, parseJson, ReadError, str } from "../github/read.ts";
import { type GitRunner, must, repoAt, type Repo } from "./gitx.ts";

const MARKER_FILE = "pr-refresh.json";
const MAX_MARKER_BYTES = 1_000_000;
const DIRECTORY_PREFIX = "pr-refresh-";

/** What a kept worktree remembers about the PR it was made for. */
export interface WorktreeMarker {
  readonly repo: string;
  readonly number: number;
  readonly remote: string;
  readonly headRef: string;
  readonly headSha: string;
  readonly baseRef: string;
  readonly baseSha: string;
  /** Paths that conflicted when the merge stopped. */
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
}

export interface WorktreeHandle {
  readonly path: string;
  readonly repo: Repo;
  readonly recorded: Recorded;
  /** Keep the worktree after the work ends, with a marker that `continue` and `abort` check. */
  readonly keep: (marker: WorktreeMarker) => void;
  /** True while git in the worktree still reads the recorded admin directory. */
  readonly intact: () => Promise<boolean>;
}

export interface WorktreeOptions {
  readonly cwd: string;
  readonly root: string;
  readonly runner: GitRunner;
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
    dirname(recorded.adminDir) === join(recorded.commonDir, "worktrees")
  );
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

function handleFor(recorded: Recorded, runner: GitRunner, keepFlag: { kept: boolean }): WorktreeHandle {
  const repo = repoAt(recorded.path, runner);
  return {
    path: recorded.path,
    repo,
    recorded,
    keep: (marker) => {
      writeFileSync(
        join(recorded.directory, MARKER_FILE),
        JSON.stringify({ schema: 1, ...marker, adminDir: recorded.adminDir, commonDir: recorded.commonDir }),
        { mode: 0o600 },
      );
      keepFlag.kept = true;
    },
    intact: async () => {
      try {
        return (await currentAdminDir(repo)) === recorded.adminDir;
      } catch {
        return false;
      }
    },
  };
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
  const keepFlag = { kept: false };
  try {
    const added = await origin.run(["worktree", "add", "--detach", path, sha]);
    if (added.code !== 0) {
      throw new Error(`cannot create the temporary worktree: ${added.stderr.trim().split("\n")[0] ?? ""}`);
    }
    const commonDir = await commonDirOf(options.cwd, options.runner);
    const adminDir = await currentAdminDir(repoAt(path, options.runner));
    const candidate: Recorded = { root, directory: realpathSync(directory), path: realpathSync(path), adminDir, commonDir };
    recorded = candidate;
    if (!directoryOk(candidate) || !worktreePathOk(candidate) || !adminDirOk(candidate)) {
      throw new Error("the new worktree is not where it should be; the script made no change in it");
    }
    return await work(handleFor(candidate, options.runner, keepFlag));
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
  | { readonly ok: true; readonly handle: WorktreeHandle; readonly marker: WorktreeMarker }
  | { readonly ok: false; readonly reason: string };

function parseMarker(text: string): (WorktreeMarker & { readonly adminDir: string; readonly commonDir: string }) | null {
  try {
    const o = obj(parseJson(text, "marker"), "marker");
    if (member(o, "schema") !== 1) {
      return null;
    }
    return {
      repo: str(member(o, "repo"), "repo"),
      number: num(member(o, "number"), "number"),
      remote: str(member(o, "remote"), "remote"),
      headRef: str(member(o, "headRef"), "headRef"),
      headSha: str(member(o, "headSha"), "headSha"),
      baseRef: str(member(o, "baseRef"), "baseRef"),
      baseSha: str(member(o, "baseSha"), "baseSha"),
      conflicts: arr(member(o, "conflicts"), "conflicts").map((c) => str(c, "conflict")),
      adminDir: str(member(o, "adminDir"), "adminDir"),
      commonDir: str(member(o, "commonDir"), "commonDir"),
    };
  } catch (error) {
    if (error instanceof ReadError) {
      return null;
    }
    throw error;
  }
}

/** Check that `worktreePath` is a library worktree of this checkout, and read its marker. */
export async function openKeptWorktree(options: WorktreeOptions, worktreePath: string, requireIntact: boolean): Promise<OpenResult> {
  const fail = (reason: string): OpenResult => ({ ok: false, reason });
  const path = realOrNull(worktreePath);
  const root = realOrNull(options.root);
  if (path === null || root === null) {
    return fail("the worktree path does not exist");
  }
  const directory = dirname(path);
  if (basename(path) !== "work" || dirname(directory) !== root || !basename(directory).startsWith(DIRECTORY_PREFIX)) {
    return fail("the path is not a worktree that this script made under the worktree root");
  }
  const markerFile = join(directory, MARKER_FILE);
  let text: string;
  try {
    const stat = lstatSync(markerFile);
    if (!stat.isFile() || stat.size > MAX_MARKER_BYTES) {
      return fail("the worktree has no valid marker");
    }
    text = readFileSync(markerFile, "utf8");
  } catch {
    return fail("the worktree has no marker; only a worktree kept by sync --keep-worktree can continue");
  }
  const marker = parseMarker(text);
  if (marker === null) {
    return fail("the worktree marker is not valid");
  }
  const recorded: Recorded = { root, directory, path, adminDir: marker.adminDir, commonDir: marker.commonDir };
  let common: string;
  try {
    common = await commonDirOf(options.cwd, options.runner);
  } catch {
    return fail("the current directory is not a git checkout");
  }
  if (common !== marker.commonDir) {
    return fail("the worktree belongs to another repository checkout");
  }
  if (!directoryOk(recorded) || !worktreePathOk(recorded) || !adminDirOk(recorded)) {
    return fail("the worktree paths are not the ones that were recorded");
  }
  const handle = handleFor(recorded, options.runner, { kept: false });
  if (requireIntact && !(await handle.intact())) {
    return fail("git in the worktree no longer reads the recorded admin directory; run abort");
  }
  return { ok: true, handle, marker };
}
