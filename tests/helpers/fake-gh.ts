// A fake `gh` for gather tests. It answers each library query constant with
// canned data and checks that every argv passes the real allow-list.

import { checkGh } from "../../lib/safety.ts";
import type { RunResult } from "../../lib/proc.ts";
import {
  BASE_QUERY,
  CONTEXTS_PAGE_QUERY,
  ISSUE_QUERY,
  MERGEABILITY_QUERY,
  OPEN_PRS_QUERY,
  PR_QUERY,
  REVIEWS_PAGE_QUERY,
  COMMITS_PAGE_QUERY,
  THREADS_PAGE_QUERY,
} from "../../lib/github/queries.ts";
import { FLEET_QUERY } from "../../lib/fleet/list.ts";
import { PR_HEAD_QUERY, THREAD_DETAILS_QUERY, THREAD_QUERY } from "../../lib/threads/queries.ts";
import { HEAD, BASE } from "./status.ts";

export type Vars = Readonly<Record<string, string>>;
export type Reply = unknown | { readonly __exit: number; readonly stderr: string };

export interface FakeGh {
  readonly run: (args: readonly string[]) => Promise<RunResult>;
  readonly calls: string[][];
}

const QUERIES: readonly (readonly [string, string])[] = [
  ["pr", PR_QUERY],
  ["threads", THREADS_PAGE_QUERY],
  ["reviews", REVIEWS_PAGE_QUERY],
  ["commits", COMMITS_PAGE_QUERY],
  ["contexts", CONTEXTS_PAGE_QUERY],
  ["base", BASE_QUERY],
  ["issue", ISSUE_QUERY],
  ["mergeability", MERGEABILITY_QUERY],
  ["open", OPEN_PRS_QUERY],
  ["threadDetails", THREAD_DETAILS_QUERY],
  ["thread", THREAD_QUERY],
  ["prHead", PR_HEAD_QUERY],
  ["fleetOpen", FLEET_QUERY],
];

export function fail(stderr: string, exit = 1): Reply {
  return { __exit: exit, stderr };
}

function isFail(value: unknown): value is { readonly __exit: number; readonly stderr: string } {
  return typeof value === "object" && value !== null && "__exit" in value;
}

/**
 * `graphql` maps a query name (pr, threads, contexts, base, issue, mergeability, open) to a
 * function of the variables. `rest` maps an endpoint to a reply. A reply is JSON or `fail(...)`.
 */
export function fakeGh(
  graphql: Readonly<Record<string, (vars: Vars) => Reply>>,
  rest: Readonly<Record<string, Reply>> = {},
): FakeGh {
  const calls: string[][] = [];
  const run = async (args: readonly string[]): Promise<RunResult> => {
    calls.push([...args]);
    const guard = checkGh(args);
    if (!guard.allowed) {
      throw new Error(`fake gh: the guard refused ${args.slice(0, 3).join(" ")}: ${guard.reason}`);
    }
    let reply: Reply;
    if (args[1] === "graphql") {
      const queryArg = args.find((a) => a.startsWith("query=")) ?? "";
      const name = QUERIES.find(([, text]) => `query=${text}` === queryArg)?.[0];
      const handler = name === undefined ? undefined : graphql[name];
      if (handler === undefined) {
        throw new Error(`fake gh: no handler for ${name ?? "an unknown query"}`);
      }
      const vars: Record<string, string> = {};
      for (let i = 0; i < args.length; i += 1) {
        if ((args[i] === "-f" || args[i] === "-F") && !(args[i + 1] ?? "").startsWith("query=")) {
          const [key = "", ...value] = (args[i + 1] ?? "").split("=");
          vars[key] = value.join("=");
        }
      }
      reply = handler(vars);
    } else {
      const endpoint = args.find((a, i) => i > 0 && !a.startsWith("-") && args[i - 1] !== "-X" && args[i - 1] !== "-H") ?? "";
      const key = Object.keys(rest).find((k) => endpoint === k || endpoint.startsWith(`${k}?`));
      if (key === undefined) {
        return { code: 1, stdout: "", stderr: `gh: Not Found (HTTP 404) for ${endpoint}` };
      }
      reply = rest[key];
    }
    if (isFail(reply)) {
      return { code: reply.__exit, stdout: "", stderr: reply.stderr };
    }
    return { code: 0, stdout: typeof reply === "string" ? reply : JSON.stringify(reply), stderr: "" };
  };
  return { run, calls };
}

// ---------- canned data ----------

export interface PrData {
  readonly [key: string]: unknown;
}

export function ctxRun(name: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    __typename: "CheckRun",
    name,
    status: "COMPLETED",
    conclusion: "SUCCESS",
    startedAt: "2026-01-01T00:00:00Z",
    completedAt: "2026-01-01T00:01:00Z",
    databaseId: 1,
    isRequired: false,
    checkSuite: { app: { databaseId: 15368 }, workflowRun: { event: "pull_request", workflow: { name: "CI" } } },
    ...patch,
  };
}

export function thread(n: number, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `T${n}`,
    isResolved: false,
    isOutdated: false,
    path: "src/a.rs",
    line: n,
    comments: { totalCount: 1, nodes: [{ author: { login: "some-bot" }, body: `P1 finding ${n}` }] },
    lastComment: { nodes: [{ author: { login: "some-bot" } }] },
    ...patch,
  };
}

export function commitNode(oid: string, parents: readonly string[], message = "msg\n\nSigned-off-by: A <a@example.com>"): Record<string, unknown> {
  return {
    commit: {
      oid,
      message,
      committedDate: "2026-01-01T00:00:00Z",
      tree: { oid: "1".repeat(40) },
      parents: { nodes: parents.map((p) => ({ oid: p })) },
      author: { email: "a@example.com", user: { login: "dev-a" } },
    },
  };
}

export function prResponse(patch: Record<string, unknown> = {}, repoPatch: Record<string, unknown> = {}): unknown {
  return {
    data: {
      repository: {
        nameWithOwner: "example-org/example-repo",
        defaultBranchRef: { name: "main" },
        pullRequest: {
          id: "PR_node_1",
          number: 7,
          state: "OPEN",
          isDraft: false,
          title: "t",
          body: "",
          baseRefName: "main",
          baseRefOid: BASE,
          headRefName: "topic",
          headRefOid: HEAD,
          headRepository: { nameWithOwner: "example-org/example-repo" },
          isCrossRepository: false,
          author: { login: "dev-a" },
          mergeable: "MERGEABLE",
          mergeStateStatus: "CLEAN",
          reviewDecision: null,
          labels: { totalCount: 1, nodes: [{ name: "ci:auto" }] },
          mergeQueueEntry: null,
          closingIssuesReferences: { nodes: [] },
          commits: { totalCount: 1, pageInfo: { hasPreviousPage: false, startCursor: null }, nodes: [commitNode(HEAD, ["d".repeat(40)])] },
          latestCommit: {
            nodes: [
              {
                commit: {
                  id: "C_node_1",
                  oid: HEAD,
                  statusCheckRollup: {
                    contexts: {
                      totalCount: 1,
                      pageInfo: { hasNextPage: false, endCursor: null },
                      nodes: [ctxRun("Required", { isRequired: true })],
                    },
                  },
                },
              },
            ],
          },
          reviews: { totalCount: 0, pageInfo: { hasPreviousPage: false, startCursor: null }, nodes: [] },
          latestOpinionatedReviews: { totalCount: 0, nodes: [] },
          reviewThreads: { totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
          timelineItems: { nodes: [] },
          ...patch,
        },
        ...repoPatch,
      },
      rateLimit: { cost: 2, remaining: 4990, resetAt: "2026-01-01T01:00:00Z" },
    },
  };
}

export function baseResponse(patch: Record<string, unknown> = {}): unknown {
  return {
    data: {
      repository: {
        mergeQueue: { id: "MQ_1", entries: { totalCount: 4 } },
        ref: { compare: { behindBy: 3, aheadBy: 1 } },
        pullRequests: { nodes: [] },
        ...patch,
      },
    },
  };
}
