// Read the review threads, the PR head, and the current user through `gh`.

import { type GhRun, graphql, text } from "../github/graphql.ts";
import { arr, bool, isObj, member, num, numOrNull, obj, parseJson, path, ReadError, str, strOrNull } from "../github/read.ts";
import { parseSha, type Sha } from "../types.ts";
import { PR_HEAD_QUERY, THREAD_DETAILS_QUERY, THREAD_QUERY } from "./queries.ts";
import type { CommentView, ThreadDetail } from "./types.ts";

const MAX_THREAD_PAGES = 20;
const MAX_COMMENT_PAGES = 20;

function comment(value: unknown, where: string): CommentView {
  const o = obj(value, where);
  const author = member(o, "author");
  return {
    id: str(member(o, "id"), `${where}.id`),
    author: isObj(author) ? str(member(author, "login"), `${where}.author.login`) : "ghost",
    isBotAccount: isObj(author) && member(author, "__typename") === "Bot",
    body: str(member(o, "body"), `${where}.body`),
    url: strOrNull(member(o, "url"), `${where}.url`),
  };
}

interface Connection {
  readonly comments: readonly CommentView[];
  readonly total: number;
  readonly next: string | null;
}

function connection(value: unknown): Connection {
  const o = obj(value, "thread.comments");
  const info = member(o, "pageInfo");
  const more = isObj(info) && member(info, "hasNextPage") === true;
  const cursor = isObj(info) ? member(info, "endCursor") : null;
  if (more && typeof cursor !== "string") {
    throw new ReadError("thread.comments: a next page has no cursor");
  }
  return {
    comments: arr(member(o, "nodes"), "thread.comments.nodes").map((c) => comment(c, "thread comment")),
    total: num(member(o, "totalCount"), "thread.comments.totalCount"),
    next: more && typeof cursor === "string" ? cursor : null,
  };
}

interface ThreadPage {
  readonly id: string;
  readonly isResolved: boolean;
  readonly isOutdated: boolean;
  readonly path: string | null;
  readonly line: number | null;
  readonly comments: Connection;
}

function threadPage(value: unknown): ThreadPage {
  const o = obj(value, "thread");
  return {
    id: str(member(o, "id"), "thread.id"),
    isResolved: bool(member(o, "isResolved"), "thread.isResolved"),
    isOutdated: bool(member(o, "isOutdated"), "thread.isOutdated"),
    path: strOrNull(member(o, "path"), "thread.path"),
    line: numOrNull(member(o, "line"), "thread.line"),
    comments: connection(member(o, "comments")),
  };
}

export interface ThreadRead {
  readonly threads: readonly ThreadDetail[];
  readonly problems: readonly string[];
}

/** Follow the comment pages of a thread. A thread that stays cut off becomes a problem. */
async function completeThread(run: GhRun, page: ThreadPage, problems: string[]): Promise<ThreadDetail> {
  const comments = [...page.comments.comments];
  let next = page.comments.next;
  for (let i = 0; i < MAX_COMMENT_PAGES && next !== null; i += 1) {
    const more = threadPage(path(await graphql(run, THREAD_QUERY, { id: text(page.id), after: text(next) }), "node"));
    comments.push(...more.comments.comments);
    next = more.comments.next;
  }
  const first = comments[0];
  if (first === undefined) {
    throw new ReadError(`thread ${page.id} has no comments`);
  }
  if (next !== null || comments.length < page.comments.total) {
    problems.push(`thread ${page.id}: only ${comments.length} of ${page.comments.total} comments were read`);
  }
  return {
    id: page.id,
    isResolved: page.isResolved,
    isOutdated: page.isOutdated,
    path: page.path,
    line: page.line,
    commentCount: page.comments.total,
    first,
    comments,
  };
}

/** Read one thread with all of its comments. Throws ReadError when it cannot be read. */
export async function readThread(run: GhRun, threadId: string): Promise<{ readonly thread: ThreadDetail; readonly problems: readonly string[] }> {
  const problems: string[] = [];
  const page = threadPage(path(await graphql(run, THREAD_QUERY, { id: text(threadId) }), "node"));
  return { thread: await completeThread(run, page, problems), problems };
}

/** Read all review threads of a PR, resolved or not, with all their comments. A bad thread becomes a problem, never a guess. */
export async function readThreads(run: GhRun, prNodeId: string): Promise<ThreadRead> {
  const threads: ThreadDetail[] = [];
  const problems: string[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_THREAD_PAGES; page += 1) {
    const data = await graphql(run, THREAD_DETAILS_QUERY, {
      id: text(prNodeId),
      ...(after === null ? {} : { after: text(after) }),
    });
    const list = obj(path(data, "node", "reviewThreads"), "reviewThreads");
    for (const node of arr(member(list, "nodes"), "reviewThreads.nodes")) {
      try {
        threads.push(await completeThread(run, threadPage(node), problems));
      } catch (error) {
        problems.push(`thread unreadable: ${error instanceof ReadError ? error.message : "error"}`);
      }
    }
    const info = member(list, "pageInfo");
    const cursor = isObj(info) ? member(info, "endCursor") : null;
    if (!isObj(info) || member(info, "hasNextPage") !== true) {
      return { threads, problems };
    }
    if (typeof cursor !== "string") {
      problems.push("review threads: a next page has no cursor");
      return { threads, problems };
    }
    after = cursor;
  }
  problems.push("review threads are truncated");
  return { threads, problems };
}

export interface PrHead {
  readonly open: boolean;
  readonly headSha: Sha;
}

/** The current head of the PR. Throws ReadError when it cannot be read. */
export async function readHead(run: GhRun, prNodeId: string): Promise<PrHead> {
  const data = await graphql(run, PR_HEAD_QUERY, { id: text(prNodeId) });
  const node = obj(member(data, "node"), "pull request node");
  const parsed = parseSha(str(member(node, "headRefOid"), "headRefOid"));
  if (!parsed.ok) {
    throw new ReadError(`headRefOid: ${parsed.error}`);
  }
  return { open: member(node, "state") === "OPEN", headSha: parsed.value };
}

/** The login of the current gh user. Null when it cannot be read (for example a token without user scope). */
export async function readAgentLogin(run: GhRun): Promise<string | null> {
  try {
    const result = await run(["api", "user"]);
    if (result.code !== 0) {
      return null;
    }
    return strOrNull(path(parseJson(result.stdout, "user"), "login"), "user.login");
  } catch {
    return null;
  }
}
