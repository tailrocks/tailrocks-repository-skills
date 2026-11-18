// Facts that only git can prove: the carry-over chain of review-equivalent
// heads (design section 5, "Reviews"). Any git failure sets `available: false`.

import { git } from "../git.ts";
import type { RunResult } from "../proc.ts";
import { parseSha, type Sha } from "../types.ts";
import type { CarryStep, GitFacts } from "../status/types.ts";
import { withoutSignoffs } from "../status/text.ts";

export type GitRun = (args: readonly string[]) => Promise<RunResult>;

export function defaultGit(cwd: string): GitRun {
  return (args) => git(args, { cwd });
}

export interface GitFactsRequest {
  readonly number: number;
  readonly headSha: Sha;
  readonly baseRef: string;
  readonly baseSha: Sha;
  /** Commits that reviews name. Candidates for a trailer-only rewrite. */
  readonly reviewedCommits: readonly Sha[];
  readonly carryOver: boolean;
  readonly maxCarryMerges: number;
  readonly remote?: string;
  /** False in tests that set up the objects by hand. */
  readonly fetch?: boolean;
  /** Fetch the base branch too. A caller that has fetched this base commit already passes false. */
  readonly fetchBase?: boolean;
}

const MAX_STEPS = 100;

class GitFailure extends Error {
  override readonly name = "GitFailure";
}

export function unavailable(reason: string, headSha: Sha): GitFacts {
  return {
    available: false,
    unavailableBecause: reason,
    reviewEquivalentHeads: [{ sha: headSha, via: "head" }],
    carryStoppedBecause: null,
  };
}

function asSha(text: string): Sha {
  const parsed = parseSha(text);
  if (!parsed.ok) {
    throw new GitFailure(`"${text}" is not a commit id`);
  }
  return parsed.value;
}

async function ok(run: GitRun, args: readonly string[]): Promise<string> {
  const result = await run(args);
  if (result.code !== 0) {
    throw new GitFailure(`git ${args[0] ?? ""} failed: ${result.stderr.trim().split("\n")[0] ?? `exit ${result.code}`}`);
  }
  return result.stdout.trim();
}

/** Exit 0 gives true, exit 1 gives false. Any other exit code is a failure. */
async function yesNo(run: GitRun, args: readonly string[]): Promise<boolean> {
  const result = await run(args);
  if (result.code === 0) {
    return true;
  }
  if (result.code === 1) {
    return false;
  }
  throw new GitFailure(`git ${args[0] ?? ""} failed: ${result.stderr.trim().split("\n")[0] ?? `exit ${result.code}`}`);
}

async function has(run: GitRun, sha: string): Promise<boolean> {
  return (await run(["cat-file", "-e", `${sha}^{commit}`])).code === 0;
}

async function tree(run: GitRun, sha: string): Promise<string> {
  return ok(run, ["rev-parse", `${sha}^{tree}`]);
}

async function parents(run: GitRun, sha: string): Promise<readonly string[]> {
  const line = await ok(run, ["rev-list", "--parents", "-n", "1", sha]);
  return line.split(/\s+/).slice(1).filter((p) => p !== "");
}

async function message(run: GitRun, sha: string): Promise<string> {
  const result = await run(["log", "-1", "--format=%B", sha]);
  if (result.code !== 0) {
    throw new GitFailure(`git log failed: ${result.stderr.trim().split("\n")[0] ?? ""}`);
  }
  return result.stdout;
}

interface Walk {
  readonly chain: { sha: Sha; via: CarryStep }[];
  stopped: string | null;
}

/** Walk back from the head over empty commits and clean merges of the base. */
async function walkChain(run: GitRun, request: GitFactsRequest): Promise<Walk> {
  const walk: Walk = { chain: [{ sha: request.headSha, via: "head" }], stopped: null };
  let current: string = request.headSha;
  let merges = 0;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const ps = await parents(run, current);
    if (ps.length === 0) {
      walk.stopped = `commit ${current.slice(0, 7)} is a root commit`;
      return walk;
    }
    const [first, second, extra] = ps;
    if (second === undefined && first !== undefined) {
      if ((await tree(run, current)) !== (await tree(run, first))) {
        walk.stopped = `commit ${current.slice(0, 7)} changes files; no carry-over across a code change`;
        return walk;
      }
      walk.chain.push({ sha: asSha(first), via: "empty_commit" });
      current = first;
      continue;
    }
    if (extra !== undefined || first === undefined || second === undefined) {
      walk.stopped = `commit ${current.slice(0, 7)} is not a two-parent merge`;
      return walk;
    }
    if (merges >= request.maxCarryMerges) {
      walk.stopped = `more than ${request.maxCarryMerges} base merges since the reviewed head`;
      return walk;
    }
    if (!(await has(run, second))) {
      walk.stopped = `merge ${current.slice(0, 7)}: second parent ${second.slice(0, 7)} is not available locally`;
      return walk;
    }
    if (!(await yesNo(run, ["merge-base", "--is-ancestor", second, request.baseSha]))) {
      walk.stopped = `merge ${current.slice(0, 7)} does not merge the base branch ${request.baseRef}`;
      return walk;
    }
    const merged = await run(["merge-tree", "--write-tree", first, second]);
    if (merged.code === 1) {
      walk.stopped = `merge ${current.slice(0, 7)} had conflicts to resolve; a merge that needed a hand edit is not clean`;
      return walk;
    }
    if (merged.code !== 0) {
      throw new GitFailure(`git merge-tree failed: ${merged.stderr.trim().split("\n")[0] ?? `exit ${merged.code}`}`);
    }
    const expected = merged.stdout.trim().split("\n")[0] ?? "";
    if (expected !== (await tree(run, current))) {
      walk.stopped = `merge ${current.slice(0, 7)} changed more than the base: its tree differs from a clean merge`;
      return walk;
    }
    merges += 1;
    walk.chain.push({ sha: asSha(first), via: "clean_base_merge" });
    current = first;
  }
  walk.stopped = "carry-over walk reached its step limit";
  return walk;
}

/** Add reviewed commits that differ from a chain element only by Signed-off-by lines. */
async function addTrailerRewrites(run: GitRun, walk: Walk, reviewed: readonly Sha[]): Promise<void> {
  const known = new Set<string>(walk.chain.map((c) => c.sha));
  for (const candidate of reviewed) {
    if (known.has(candidate) || !(await has(run, candidate))) {
      continue;
    }
    const candidateTree = await tree(run, candidate);
    const candidateMessage = withoutSignoffs(await message(run, candidate));
    for (const element of walk.chain) {
      if ((await tree(run, element.sha)) === candidateTree && withoutSignoffs(await message(run, element.sha)) === candidateMessage) {
        walk.chain.push({ sha: candidate, via: "trailer_rewrite" });
        known.add(candidate);
        break;
      }
    }
  }
}

/** Compute the carry-over chain. Never throws: a git failure gives `available: false`. */
export async function gatherGitFacts(run: GitRun, request: GitFactsRequest): Promise<GitFacts> {
  if (!request.carryOver) {
    return { available: true, unavailableBecause: null, reviewEquivalentHeads: [{ sha: request.headSha, via: "head" }], carryStoppedBecause: null };
  }
  try {
    const remote = request.remote ?? "origin";
    if (request.fetch !== false) {
      await ok(run, ["fetch", "--no-tags", "--quiet", remote, `refs/pull/${request.number}/head`]);
      if (request.fetchBase !== false) {
        await ok(run, ["fetch", "--no-tags", "--quiet", remote, request.baseRef]);
      }
    }
    if (!(await has(run, request.headSha)) || !(await has(run, request.baseSha))) {
      throw new GitFailure("the head or base commit is not in the local clone after the fetch");
    }
    const walk = await walkChain(run, request);
    await addTrailerRewrites(run, walk, request.reviewedCommits);
    return {
      available: true,
      unavailableBecause: null,
      reviewEquivalentHeads: walk.chain,
      carryStoppedBecause: walk.stopped,
    };
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : "git failed", request.headSha);
  }
}
