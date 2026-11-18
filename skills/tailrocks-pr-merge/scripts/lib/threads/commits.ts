// Prove that a fix commit belongs to the PR: GitHub lists it among the PR commits,
// and (with a local clone) git says it is an ancestor of the head.

import type { GitRun } from "../github/git-facts.ts";
import type { PrSnapshot } from "../status/types.ts";
import type { Sha } from "../types.ts";

/** Exit 0 gives true, exit 1 gives false. Any other exit code is an error. */
export async function isAncestor(run: GitRun, commit: Sha, head: Sha): Promise<boolean | string> {
  const have = await run(["cat-file", "-e", `${head}^{commit}`]);
  if (have.code !== 0) {
    return `the local clone does not hold the head ${head.slice(0, 7)}; fetch it first`;
  }
  const result = await run(["merge-base", "--is-ancestor", commit, head]);
  if (result.code === 0) {
    return true;
  }
  if (result.code === 1) {
    return false;
  }
  return `git merge-base failed: ${result.stderr.trim().split("\n")[0] ?? `exit ${result.code}`}`;
}

/** One refusal per fix commit that is not provably in the PR. An empty list means all are fine. */
export async function verifyFixCommits(
  commits: readonly Sha[],
  snapshot: PrSnapshot,
  run: GitRun | null,
): Promise<readonly string[]> {
  const refusals: string[] = [];
  const inPr = new Set<string>(snapshot.commits.map((c) => c.oid));
  for (const commit of new Set(commits)) {
    const short = commit.slice(0, 7);
    if (!inPr.has(commit)) {
      refusals.push(
        snapshot.commitsTruncated
          ? `fix commit ${short} is not among the latest ${snapshot.commits.length} commits of the PR`
          : `fix commit ${short} is not a commit of this PR (push it first)`,
      );
      continue;
    }
    if (run === null) {
      continue;
    }
    const verdict = await isAncestor(run, commit, snapshot.headSha);
    if (verdict === false) {
      refusals.push(`fix commit ${short} is not an ancestor of the head ${snapshot.headSha.slice(0, 7)}`);
    } else if (typeof verdict === "string") {
      refusals.push(`fix commit ${short}: ${verdict}`);
    }
  }
  return refusals;
}
