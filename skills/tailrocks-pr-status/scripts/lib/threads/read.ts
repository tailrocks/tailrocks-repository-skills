// Read the review threads, the PR head, and the current user through `gh`.

import { type GhRun, graphql, text } from "../github/graphql.ts";
import { arr, bool, isObj, member, num, obj, path, ReadError, str, strOrNull, numOrNull, parseJson } from "../github/read.ts";
import { parseSha, type Sha } from "../types.ts";
import { PR_HEAD_QUERY, THREAD_DETAILS_QUERY } from "./queries.ts";
import type { CommentView, ThreadDetail } from "./types.ts";

const MAX_PAGES = 10;

function comment(value: unknown, where: string): CommentView {
  const o = obj(value, where);
  const author = member(o, "author");
  return {
    author: isObj(author) ? str(member(author, "login"), `${where}.author.login`) : "ghost",
    isBotAccount: isObj(author) && member(author, "__typename") === "Bot",
    body: str(member(o, "body"), `${where}.body`),
    url: strOrNull(member(o, "url"), `${where}.url`),
  };
}

function thread(value: unknown): ThreadDetail {
  const o = obj(value, "thread");
  const firstConnection = obj(member(o, "first"), "thread.first");
  const first = comment(arr(member(firstConnection, "nodes"), "thread.first.nodes")[0], "thread first comment");
  const recent = arr(path(member(o, "recent"), "nodes"), "thread.recent.nodes").map((c) => comment(c, "thread comment"));
  if (recent.length === 0) {
    throw new ReadError("thread has no comments");
  }
  return {
    id: str(member(o, "id"), "thread.id"),
    isResolved: bool(member(o, "isResolved"), "thread.isResolved"),
    isOutdated: bool(member(o, "isOutdated"), "thread.isOutdated"),
    path: strOrNull(member(o, "path"), "thread.path"),
    line: numOrNull(member(o, "line"), "thread.line"),
    commentCount: num(member(firstConnection, "totalCount"), "thread.first.totalCount"),
    first,
    recent,
  };
}

export interface ThreadRead {
  readonly threads: readonly ThreadDetail[];
  readonly problems: readonly string[];
}

/** Read all review threads of a PR, resolved or not. A bad thread becomes a problem, never a guess. */
export async function readThreads(run: GhRun, prNodeId: string): Promise<ThreadRead> {
  const threads: ThreadDetail[] = [];
  const problems: string[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await graphql(run, THREAD_DETAILS_QUERY, {
      id: text(prNodeId),
      ...(after === null ? {} : { after: text(after) }),
    });
    const connection = obj(path(data, "node", "reviewThreads"), "reviewThreads");
    for (const node of arr(member(connection, "nodes"), "reviewThreads.nodes")) {
      try {
        threads.push(thread(node));
      } catch (error) {
        problems.push(`thread unreadable: ${error instanceof ReadError ? error.message : "error"}`);
      }
    }
    const info = member(connection, "pageInfo");
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
  problems.push("review threads are truncated (more than 500)");
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
