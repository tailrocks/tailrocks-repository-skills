// Local git reads of pr-create. All calls go through the guarded git runner.

import { parseSha, type Sha } from "../types.ts";
import type { GitRun } from "../github/git-facts.ts";
import type { CommitInfo } from "./checks.ts";
import { StepError } from "./github.ts";

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}

/** Run git and return stdout. A failure is a StepError. */
export async function gitOut(run: GitRun, args: readonly string[]): Promise<string> {
  const result = await run(args);
  if (result.code !== 0) {
    throw new StepError(`git ${args[0] ?? ""} failed: ${firstLine(result.stderr) || `exit ${result.code}`}`);
  }
  return result.stdout;
}

/** Exit 0 gives true and exit 1 gives false. Any other exit is a failure. */
export async function gitYesNo(run: GitRun, args: readonly string[]): Promise<boolean> {
  const result = await run(args);
  if (result.code === 0) {
    return true;
  }
  if (result.code === 1) {
    return false;
  }
  throw new StepError(`git ${args[0] ?? ""} failed: ${firstLine(result.stderr) || `exit ${result.code}`}`);
}

export async function gitSha(run: GitRun, args: readonly string[]): Promise<Sha> {
  const text = (await gitOut(run, args)).trim();
  const parsed = parseSha(text);
  if (!parsed.ok) {
    throw new StepError(`git ${args[0] ?? ""} did not print a commit id`);
  }
  return parsed.value;
}

export interface TreeState {
  /** Changed tracked entries: staged or unstaged. */
  readonly tracked: readonly string[];
  readonly untracked: readonly string[];
}

export async function readTreeState(run: GitRun): Promise<TreeState> {
  const lines = (await gitOut(run, ["status", "--porcelain"])).split("\n").filter((l) => l.trim() !== "");
  return {
    tracked: lines.filter((l) => !l.startsWith("??") && !l.startsWith("!!")),
    untracked: lines.filter((l) => l.startsWith("??")).map((l) => l.slice(3)),
  };
}

export async function remoteUrl(run: GitRun, remote: string): Promise<string | null> {
  const result = await run(["config", "--get", `remote.${remote}.url`]);
  if (result.code === 0) {
    return result.stdout.trim();
  }
  if (result.code === 1) {
    return null;
  }
  throw new StepError(`git config failed: ${firstLine(result.stderr) || `exit ${result.code}`}`);
}

export type FetchResult =
  | { readonly kind: "found"; readonly sha: Sha }
  | { readonly kind: "missing" };

/** Fetch one branch of the remote. A branch that does not exist is `missing`. */
export async function fetchBranch(run: GitRun, remote: string, branch: string): Promise<FetchResult> {
  const result = await run(["fetch", "--no-tags", "--quiet", remote, branch]);
  if (result.code !== 0) {
    if (/couldn't find remote ref/i.test(result.stderr)) {
      return { kind: "missing" };
    }
    throw new StepError(`git fetch ${branch} failed: ${firstLine(result.stderr) || `exit ${result.code}`}`);
  }
  return { kind: "found", sha: await gitSha(run, ["rev-parse", "FETCH_HEAD"]) };
}

export async function hasCommit(run: GitRun, sha: string): Promise<boolean> {
  return (await run(["cat-file", "-e", `${sha}^{commit}`])).code === 0;
}

export async function isAncestor(run: GitRun, ancestor: string, descendant: string): Promise<boolean> {
  return gitYesNo(run, ["merge-base", "--is-ancestor", ancestor, descendant]);
}

const RECORD = "\u0001";

/** The commits of `head` that `base` does not hold, merges left out, newest first. */
export async function listCommits(run: GitRun, head: string, base: string): Promise<readonly CommitInfo[]> {
  const text = await gitOut(run, ["log", "--no-merges", "--format=%x01%H%x00%an%x00%ae%x00%B", head, `^${base}`]);
  const commits: CommitInfo[] = [];
  for (const record of text.split(RECORD).filter((r) => r.trim() !== "")) {
    const [sha = "", authorName = "", authorEmail = "", ...rest] = record.split("\0");
    const parsed = parseSha(sha);
    if (!parsed.ok) {
      throw new StepError("git log gave a record that is not a commit");
    }
    const message = rest.join("\0").trim();
    commits.push({ sha: parsed.value, authorName, authorEmail, subject: message.split("\n")[0] ?? "", message });
  }
  return commits;
}

export interface ChangedPaths {
  readonly changed: readonly string[];
  readonly added: readonly string[];
}

function names(text: string): readonly string[] {
  return text.split("\0").filter((n) => n !== "");
}

/** Paths that the branch changed and added since it left the base. */
export async function changedPaths(run: GitRun, base: string, head: string): Promise<ChangedPaths> {
  const mergeBase = (await gitOut(run, ["merge-base", base, head])).trim();
  const changed = names(await gitOut(run, ["diff", "--name-only", "-z", "--no-renames", mergeBase, head]));
  const added = names(await gitOut(run, ["diff", "--name-only", "-z", "--no-renames", "--diff-filter=A", mergeBase, head]));
  return { changed, added };
}

/** True when merging the base into the head would conflict. Null when git cannot tell. */
export async function conflictsWithBase(run: GitRun, base: string, head: string): Promise<boolean | null> {
  const result = await run(["merge-tree", "--write-tree", base, head]);
  if (result.code === 0) {
    return false;
  }
  return result.code === 1 ? true : null;
}

/** The nearest common ancestor of two commits, or null when they share none. */
export async function mergeBaseOf(run: GitRun, a: string, b: string): Promise<Sha | null> {
  const result = await run(["merge-base", a, b]);
  if (result.code !== 0) {
    return null;
  }
  const parsed = parseSha(result.stdout.trim());
  return parsed.ok ? parsed.value : null;
}
