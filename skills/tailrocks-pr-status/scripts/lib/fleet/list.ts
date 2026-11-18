// The open PRs of a repository and the default branch at its current commit.
// The fleet policy comes from that commit, and from no other.

import { graphql, text, type GhRun } from "../github/graphql.ts";
import { arr, bool, isObj, member, num, obj, parseJson, path, ReadError, str } from "../github/read.ts";
import { parseSha, type RepoSlug, type Sha } from "../types.ts";
import type { OrphanRun, OrphanRuns } from "./types.ts";

export const FLEET_QUERY = `
query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    defaultBranchRef { name target { oid } }
    pullRequests(states: OPEN, first: 100, after: $after, orderBy: { field: CREATED_AT, direction: ASC }) {
      pageInfo { hasNextPage endCursor }
      nodes { number isDraft headRefName headRefOid baseRefName baseRefOid isCrossRepository author { login } }
    }
  }
}`;

export interface OpenPr {
  readonly number: number;
  readonly headRef: string;
  readonly headSha: Sha;
  readonly baseRef: string;
  readonly baseSha: Sha;
  readonly author: string;
  readonly isDraft: boolean;
  readonly isCrossRepository: boolean;
}

export interface OpenList {
  readonly defaultBranch: string;
  readonly defaultSha: Sha;
  readonly prs: readonly OpenPr[];
}

const MAX_PAGES = 50;

function sha(value: unknown, where: string): Sha {
  const parsed = parseSha(str(value, where));
  if (!parsed.ok) {
    throw new ReadError(`${where}: ${parsed.error}`);
  }
  return parsed.value;
}

/** Read every open PR, oldest first. Throws ReadError when GitHub gives anything odd. */
export async function listOpen(run: GhRun, repo: RepoSlug): Promise<OpenList> {
  const [owner = "", name = ""] = repo.split("/");
  const prs: OpenPr[] = [];
  let defaultBranch: string | null = null;
  let defaultSha: Sha | null = null;
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await graphql(run, FLEET_QUERY, { owner: text(owner), name: text(name), ...(after === null ? {} : { after: text(after) }) });
    const repository = obj(member(data, "repository"), "repository");
    defaultBranch = str(path(repository, "defaultBranchRef", "name"), "defaultBranchRef.name");
    defaultSha = sha(path(repository, "defaultBranchRef", "target", "oid"), "defaultBranchRef.target.oid");
    const connection = obj(member(repository, "pullRequests"), "pullRequests");
    for (const node of arr(member(connection, "nodes"), "pullRequests.nodes")) {
      const pr = obj(node, "pull request");
      prs.push({
        number: num(member(pr, "number"), "number"),
        headRef: str(member(pr, "headRefName"), "headRefName"),
        headSha: sha(member(pr, "headRefOid"), "headRefOid"),
        baseRef: str(member(pr, "baseRefName"), "baseRefName"),
        baseSha: sha(member(pr, "baseRefOid"), "baseRefOid"),
        author: str(path(pr, "author", "login") ?? "ghost", "author.login"),
        isDraft: bool(member(pr, "isDraft"), "isDraft"),
        isCrossRepository: bool(member(pr, "isCrossRepository"), "isCrossRepository"),
      });
    }
    const info = member(connection, "pageInfo");
    const cursor = isObj(info) ? member(info, "endCursor") : null;
    if (!isObj(info) || member(info, "hasNextPage") !== true || typeof cursor !== "string") {
      if (defaultBranch === null || defaultSha === null) {
        throw new ReadError("the default branch is unknown");
      }
      return { defaultBranch, defaultSha, prs };
    }
    after = cursor;
  }
  throw new ReadError("more than 5000 open pull requests");
}

const RUN_LIMIT = 100;
const MERGE_QUEUE_PREFIX = "gh-readonly-queue/";

export interface OrphanFilter {
  /** Head branches of every open PR, held ones included. */
  readonly openBranches: ReadonlySet<string>;
  /** The default branch and the protected branches: a run there is not an orphan. */
  readonly isBaseBranch: (branch: string) => boolean;
}

/**
 * In-progress runs on branches with no open PR. The report only lists them. No
 * script cancels a run. Runs on a base branch and runs of the merge queue are
 * not orphans.
 */
export async function readOrphanRuns(run: GhRun, repo: RepoSlug, filter: OrphanFilter): Promise<OrphanRuns> {
  const reply = await run(["run", "list", "--repo", repo, "--status", "in_progress", "--limit", String(RUN_LIMIT), "--json", "databaseId,headBranch,workflowName,event"]);
  if (reply.code !== 0) {
    return { runs: [], truncated: false, error: `the runs could not be read: ${reply.stderr.trim().split("\n")[0] ?? ""}` };
  }
  try {
    const items = arr(parseJson(reply.stdout, "run list"), "run list");
    const runs: OrphanRun[] = [];
    for (const item of items) {
      const entry = obj(item, "run");
      const branch = str(member(entry, "headBranch"), "headBranch");
      if (filter.openBranches.has(branch) || filter.isBaseBranch(branch) || branch.startsWith(MERGE_QUEUE_PREFIX)) {
        continue;
      }
      runs.push({
        id: num(member(entry, "databaseId"), "databaseId"),
        branch,
        workflow: str(member(entry, "workflowName"), "workflowName"),
        event: str(member(entry, "event"), "event"),
      });
    }
    return { runs, truncated: items.length >= RUN_LIMIT, error: null };
  } catch (error) {
    if (error instanceof ReadError) {
      return { runs: [], truncated: false, error: "the run list is unreadable" };
    }
    throw error;
  }
}
