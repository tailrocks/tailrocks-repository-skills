// gatherPr: read one pull request through `gh` into a PrSnapshot. It makes
// read-only GraphQL queries and GET calls. It never throws: a failure comes back
// as `{ ok: false }`, and a bad list item becomes a snapshot problem.

import { parseRepoSlug, type RepoSlug } from "../types.ts";
import type {
  BodyTemplate,
  LinkedIssue,
  PrSnapshot,
  QueueRemoval,
  ReviewDecision,
  RulesFacts,
} from "../status/types.ts";
import { linkedIssueNumbers, templateHeadings } from "../status/text.ts";
import { unavailable } from "./git-facts.ts";
import { type GhRun, defaultGh, graphql, int, isNotFound, rest, text } from "./graphql.ts";
import {
  parseChecks,
  parseCommits,
  parseLastRemoval,
  parseOpinionated,
  parseQueueEntry,
  parseReviews,
  parseThreads,
  sha,
} from "./parse.ts";
import {
  BASE_QUERY,
  COMMITS_PAGE_QUERY,
  CONTEXTS_PAGE_QUERY,
  ISSUE_QUERY,
  MERGEABILITY_QUERY,
  PR_QUERY,
  REVIEWS_PAGE_QUERY,
  THREADS_PAGE_QUERY,
} from "./queries.ts";
import { arr, bool, isObj, member, num, numOrNull, obj, oneOf, path, ReadError, str, strOrNull } from "./read.ts";
import { gatherRules } from "./rules.ts";

const MAX_PAGES = 10;
const MAX_ISSUES = 10;
const MERGEABILITY_RETRIES = 3;
const MERGEABILITY_WAIT_MS = 2000;

export interface GatherCache {
  readonly rules: Map<string, Promise<{ readonly rules: RulesFacts; readonly problems: readonly string[] }>>;
}

export function newGatherCache(): GatherCache {
  return { rules: new Map() };
}

export interface GatherOptions {
  readonly cwd: string;
  /** Test seam. Defaults to the guarded gh runner. */
  readonly run?: GhRun;
  readonly cache?: GatherCache;
  readonly now?: () => Date;
  /** Test seam for the wait between mergeability reads. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export type GatherResult =
  | { readonly ok: true; readonly snapshot: PrSnapshot; readonly cost: number }
  | { readonly ok: false; readonly error: string };

interface Page {
  readonly nodes: readonly unknown[];
  readonly hasNext: boolean;
  readonly cursor: string | null;
}

function page(value: unknown, where: string): Page {
  const o = obj(value, where);
  const info = member(o, "pageInfo");
  return {
    nodes: arr(member(o, "nodes"), `${where}.nodes`),
    hasNext: isObj(info) && member(info, "hasNextPage") === true,
    cursor: isObj(info) ? strOrNull(member(info, "endCursor"), `${where}.endCursor`) : null,
  };
}

/** A page of a list that is read from the end: `last: 100, before: cursor`. */
function backPage(value: unknown, where: string): Page {
  const o = obj(value, where);
  const info = member(o, "pageInfo");
  return {
    nodes: arr(member(o, "nodes"), `${where}.nodes`),
    hasNext: isObj(info) && member(info, "hasPreviousPage") === true,
    cursor: isObj(info) ? strOrNull(member(info, "startCursor"), `${where}.startCursor`) : null,
  };
}

/**
 * Follow pages until the list ends. At most MAX_PAGES pages (1000 items) are
 * read in all. A list that is still open after that is truncated.
 * `older` puts each new page before the ones read so far.
 */
async function allPages(
  first: Page,
  next: (cursor: string) => Promise<Page>,
  older = false,
): Promise<{ readonly nodes: readonly unknown[]; readonly truncated: boolean }> {
  let nodes = [...first.nodes];
  let current = first;
  for (let i = 1; i < MAX_PAGES && current.hasNext && current.cursor !== null; i += 1) {
    current = await next(current.cursor);
    nodes = older ? [...current.nodes, ...nodes] : [...nodes, ...current.nodes];
  }
  return { nodes, truncated: current.hasNext };
}

function rulesFor(run: GhRun, repo: RepoSlug, base: string, cache: GatherCache | undefined): ReturnType<typeof gatherRules> {
  const key = `${repo}\u0000${base}`;
  const known = cache?.rules.get(key);
  if (known !== undefined) {
    return known;
  }
  const pending = gatherRules(run, repo, base);
  cache?.rules.set(key, pending);
  return pending;
}

function splitRepo(repo: RepoSlug): { readonly owner: string; readonly name: string } {
  const [owner = "", name = ""] = repo.split("/");
  return { owner, name };
}

async function gatherIssues(
  run: GhRun,
  repo: RepoSlug,
  numbers: ReadonlySet<number>,
  closing: ReadonlySet<number>,
  problems: string[],
): Promise<readonly LinkedIssue[]> {
  const { owner, name } = splitRepo(repo);
  const out: LinkedIssue[] = [];
  for (const number of [...numbers].sort((a, b) => a - b).slice(0, MAX_ISSUES)) {
    try {
      const data = await graphql(run, ISSUE_QUERY, { owner: text(owner), name: text(name), number: int(number) });
      const node = path(data, "repository", "issueOrPullRequest");
      if (!isObj(node) || member(node, "__typename") !== "Issue") {
        continue; // a pull request number, or nothing there: no Done-when list
      }
      out.push({
        number,
        state: oneOf(member(node, "state"), ["OPEN", "CLOSED"], `issue #${number} state`),
        body: str(member(node, "body"), `issue #${number} body`),
        via: closing.has(number) ? "closing" : "body",
      });
    } catch (error) {
      problems.push(`linked issue #${number} unreadable: ${error instanceof ReadError ? error.message : "error"}`);
    }
  }
  if (numbers.size > MAX_ISSUES) {
    problems.push(`more than ${MAX_ISSUES} linked issues; the rest were not read`);
  }
  return out;
}

/** Read the template headings at a commit of the default branch. Null when the file is absent or unreadable. */
export async function gatherBodyTemplate(run: GhRun, repo: RepoSlug, defaultSha: string, file: string): Promise<BodyTemplate | null> {
  const encoded = file.split("/").map(encodeURIComponent).join("/");
  const result = await rest(run, `repos/${repo}/contents/${encoded}?ref=${defaultSha}`, true);
  if (result.code !== 0 || isNotFound(result)) {
    return null;
  }
  return { headings: templateHeadings(result.stdout) };
}

const MERGEABLE_VALUES = ["MERGEABLE", "CONFLICTING", "UNKNOWN"] as const;

/** Re-read mergeability while GitHub reports UNKNOWN. Gives up after a few tries. */
async function settleMergeability(
  run: GhRun,
  repo: RepoSlug,
  number: number,
  first: { readonly mergeable: (typeof MERGEABLE_VALUES)[number]; readonly status: string },
  headSha: string,
  sleep: (ms: number) => Promise<void>,
): Promise<{ readonly mergeable: (typeof MERGEABLE_VALUES)[number]; readonly status: string }> {
  const { owner, name } = splitRepo(repo);
  let current = first;
  for (let i = 0; i < MERGEABILITY_RETRIES && (current.mergeable === "UNKNOWN" || current.status === "UNKNOWN"); i += 1) {
    await sleep(MERGEABILITY_WAIT_MS);
    const data = await graphql(run, MERGEABILITY_QUERY, { owner: text(owner), name: text(name), number: int(number) });
    const pr = path(data, "repository", "pullRequest");
    if (member(obj(pr, "pullRequest"), "headRefOid") !== headSha) {
      throw new ReadError("the head moved while mergeability was read; run again");
    }
    current = {
      mergeable: oneOf(member(obj(pr, "pullRequest"), "mergeable"), MERGEABLE_VALUES, "pr.mergeable"),
      status: str(member(obj(pr, "pullRequest"), "mergeStateStatus"), "pr.mergeStateStatus"),
    };
  }
  return current;
}

export async function gatherPr(repo: RepoSlug, number: number, options: GatherOptions): Promise<GatherResult> {
  try {
    return await gather(repo, number, options);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "unreadable" };
  }
}

async function gather(repo: RepoSlug, number: number, options: GatherOptions): Promise<GatherResult> {
  const run = options.run ?? defaultGh(options.cwd);
  const { owner, name } = splitRepo(repo);
  const problems: string[] = [];

  const data = await graphql(run, PR_QUERY, { owner: text(owner), name: text(name), number: int(number) });
  const repository = obj(member(data, "repository"), "repository");
  const pr = member(repository, "pullRequest");
  if (!isObj(pr)) {
    throw new ReadError(`pull request #${number} not found in ${repo}`);
  }
  const cost = numOrNull(path(data, "rateLimit", "cost"), "rateLimit.cost") ?? 0;
  const nodeId = str(member(pr, "id"), "pr.id");
  const headSha = sha(member(pr, "headRefOid"), "pr.headRefOid");
  const baseSha = sha(member(pr, "baseRefOid"), "pr.baseRefOid");
  const baseRef = str(member(pr, "baseRefName"), "pr.baseRefName");
  const defaultBranch = str(path(repository, "defaultBranchRef", "name"), "defaultBranchRef");
  const defaultSha = sha(path(repository, "defaultBranchRef", "target", "oid"), "defaultBranchRef.target.oid");

  // Threads
  const threadsConnection = obj(member(pr, "reviewThreads"), "reviewThreads");
  const threadPages = await allPages(page(threadsConnection, "reviewThreads"), async (after) =>
    page(path(await graphql(run, THREADS_PAGE_QUERY, { id: text(nodeId), after: text(after) }), "node", "reviewThreads"), "reviewThreads page"),
  );
  const threads = parseThreads(threadPages.nodes, problems);

  // Checks of the head commit
  const latest = arr(path(pr, "latestCommit", "nodes"), "latestCommit.nodes")[0];
  const latestCommit = obj(member(obj(latest, "latestCommit node"), "commit"), "latestCommit");
  if (sha(member(latestCommit, "oid"), "latestCommit.oid") !== headSha) {
    problems.push("the head changed while the snapshot was read");
  }
  const rollup = path(latestCommit, "statusCheckRollup", "contexts");
  let checkNodes: readonly unknown[] = [];
  let checksTruncated = false;
  if (isObj(rollup)) {
    const commitId = str(member(latestCommit, "id"), "latestCommit.id");
    const pages = await allPages(page(rollup, "contexts"), async (after) =>
      page(
        path(
          await graphql(run, CONTEXTS_PAGE_QUERY, { id: text(commitId), number: int(number), after: text(after) }),
          "node",
          "statusCheckRollup",
          "contexts",
        ),
        "contexts page",
      ),
    );
    checkNodes = pages.nodes;
    checksTruncated = pages.truncated;
  }
  const checks = parseChecks(checkNodes, problems);

  // Commits, reviews
  const commitPages = await allPages(
    backPage(member(pr, "commits"), "commits"),
    async (before) =>
      backPage(path(await graphql(run, COMMITS_PAGE_QUERY, { id: text(nodeId), before: text(before) }), "node", "commits"), "commits page"),
    true,
  );
  const commits = parseCommits(commitPages.nodes, problems);
  // GitHub lists at most 250 commits of a pull request, so a longer PR ends the paging with commits missing.
  const commitTotal = num(member(obj(member(pr, "commits"), "commits"), "totalCount"), "commits.totalCount");
  const commitsTruncated = commitPages.truncated || commitPages.nodes.length < commitTotal;
  if (commitPages.nodes.length < commitTotal) {
    problems.push(`only ${commitPages.nodes.length} of ${commitTotal} commits are listed (GitHub lists at most 250), so the sign-off scan (DCO) is unknown`);
  }
  const reviewPages = await allPages(
    backPage(member(pr, "reviews"), "reviews"),
    async (before) =>
      backPage(path(await graphql(run, REVIEWS_PAGE_QUERY, { id: text(nodeId), before: text(before) }), "node", "reviews"), "reviews page"),
    true,
  );
  const reviewTotal = num(member(obj(member(pr, "reviews"), "reviews"), "totalCount"), "reviews.totalCount");
  const reviewsTruncated = reviewPages.truncated || reviewPages.nodes.length < reviewTotal;
  const opinionatedConnection = obj(member(pr, "latestOpinionatedReviews"), "latestOpinionatedReviews");
  const opinionatedNodes = arr(member(opinionatedConnection, "nodes"), "latestOpinionatedReviews.nodes");
  const labelsConnection = obj(member(pr, "labels"), "labels");
  if (num(member(labelsConnection, "totalCount"), "labels.totalCount") > 100) {
    problems.push("more than 100 labels");
  }
  if (num(member(opinionatedConnection, "totalCount"), "opinionated.totalCount") > opinionatedNodes.length) {
    problems.push("latest opinionated reviews are truncated");
  }

  // Base branch facts
  const baseData = await graphql(run, BASE_QUERY, {
    owner: text(owner),
    name: text(name),
    base: text(baseRef),
    qualified: text(`refs/heads/${baseRef}`),
    head: text(headSha),
  });
  const baseRepo = obj(member(baseData, "repository"), "base repository");
  const mergeQueue = member(baseRepo, "mergeQueue");
  const behindBy = numOrNull(path(baseRepo, "ref", "compare", "behindBy"), "compare.behindBy");
  const parents = arr(path(baseRepo, "pullRequests", "nodes") ?? [], "parent PRs")
    .filter(isObj)
    .filter((p) => path(p, "headRepository", "nameWithOwner") === repo && member(p, "number") !== number);
  const parentNumber = parents[0] === undefined ? null : num(member(parents[0], "number"), "parent number");

  const rulesResult = await rulesFor(run, repo, baseRef, options.cache);
  problems.push(...rulesResult.problems);
  const rules: RulesFacts = {
    ...rulesResult.rules,
    mergeQueue: rulesResult.rules.mergeQueue || isObj(mergeQueue),
    queueLength: isObj(mergeQueue) ? numOrNull(path(mergeQueue, "entries", "totalCount"), "queue length") : null,
  };

  // Linked issues
  const closing = new Set<number>();
  for (const node of arr(path(pr, "closingIssuesReferences", "nodes"), "closingIssuesReferences")) {
    if (isObj(node) && path(node, "repository", "nameWithOwner") === repo) {
      closing.add(num(member(node, "number"), "closing issue number"));
    }
  }
  const body = str(member(pr, "body"), "pr.body");
  const wanted = new Set<number>([...closing, ...linkedIssueNumbers(body, repo, number)]);
  const linkedIssues = await gatherIssues(run, repo, wanted, closing, problems);

  // Queue removal
  const removal = parseLastRemoval(arr(path(pr, "timelineItems", "nodes"), "timelineItems"));
  const lastCommitDate = commits.at(-1)?.committedDate ?? "";
  const lastQueueRemoval: QueueRemoval | null =
    removal === null
      ? null
      : {
          ...removal,
          afterLastPush: removal.beforeCommit !== null ? removal.beforeCommit === headSha : removal.at > lastCommitDate,
        };

  const settled = await settleMergeability(
    run,
    repo,
    number,
    {
      mergeable: oneOf(member(pr, "mergeable"), MERGEABLE_VALUES, "pr.mergeable"),
      status: str(member(pr, "mergeStateStatus"), "pr.mergeStateStatus"),
    },
    headSha,
    options.sleep ?? ((ms) => Bun.sleep(ms)),
  );
  const rawDecision = member(pr, "reviewDecision");
  const reviewDecision: ReviewDecision | null =
    rawDecision === null || rawDecision === undefined
      ? null
      : oneOf(rawDecision, ["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"], "reviewDecision");

  const slug = parseRepoSlug(str(member(repository, "nameWithOwner"), "nameWithOwner"));
  const snapshot: PrSnapshot = {
    schema: 2,
    capturedAt: (options.now?.() ?? new Date()).toISOString(),
    repo: slug.ok ? slug.value : repo,
    defaultBranch,
    number,
    nodeId,
    state: oneOf(member(pr, "state"), ["OPEN", "CLOSED", "MERGED"], "pr.state"),
    isDraft: bool(member(pr, "isDraft"), "pr.isDraft"),
    isCrossRepository: bool(member(pr, "isCrossRepository"), "pr.isCrossRepository"),
    author: strOrNull(path(pr, "author", "login"), "pr.author") ?? "ghost",
    title: str(member(pr, "title"), "pr.title"),
    body,
    baseRef,
    baseSha,
    defaultSha,
    headRef: str(member(pr, "headRefName"), "pr.headRefName"),
    headSha,
    mergeable: settled.mergeable,
    mergeStateStatus: settled.status,
    reviewDecision,
    behindBy,
    labels: arr(member(labelsConnection, "nodes"), "labels.nodes").map((l) => str(member(obj(l, "label"), "name"), "label.name")),
    checks,
    checksTruncated,
    reviews: parseReviews(reviewPages.nodes, problems),
    reviewsTruncated,
    latestOpinionatedReviews: parseOpinionated(opinionatedNodes, problems),
    threads,
    threadsTruncated: threadPages.truncated,
    commits,
    commitsTruncated,
    queueEntry: parseQueueEntry(member(pr, "mergeQueueEntry")),
    lastQueueRemoval,
    linkedIssues,
    parentPr: parentNumber,
    rules,
    bodyTemplate: null,
    git: unavailable("git facts not gathered", headSha),
    problems,
  };
  return { ok: true, snapshot, cost };
}
