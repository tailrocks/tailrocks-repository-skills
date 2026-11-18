// A stateful fake GitHub for the thread tests. The fake `gh` reads the world;
// the fake mutation runner changes it, so a second read sees the first write.

import type { RunResult } from "../../lib/proc.ts";
import type { GhMutation } from "../../lib/safety.ts";
import { parseRepoSlug, type RepoSlug, type Sha } from "../../lib/types.ts";
import { baseResponse, commitNode, fakeGh, prResponse, type FakeGh, type Reply } from "./fake-gh.ts";
import { BASE, HEAD, sha } from "./status.ts";

export const REPO: RepoSlug = (() => {
  const r = parseRepoSlug("example-org/example-repo");
  if (!r.ok) throw new Error("slug");
  return r.value;
})();

export const AGENT = "agent-user";
export const PR_AUTHOR = "dev-a";

export interface CommentSpec {
  readonly author: string;
  readonly body: string;
  readonly bot?: boolean;
}

export interface ThreadSpec {
  readonly id: string;
  readonly comments: readonly CommentSpec[];
  readonly resolved?: boolean;
  readonly path?: string;
  readonly line?: number;
}

export const POLICY_TOML = `schema = 1
[threads]
bots = ["review-bot"]
fix_pattern = "\\\\bP1\\\\b"
`;

const RULES = [
  { type: "pull_request", parameters: { required_approving_review_count: 1, require_code_owner_review: false, dismiss_stale_reviews_on_push: true, required_review_thread_resolution: true, allowed_merge_methods: ["squash"] } },
  { type: "deletion" },
];

function commentNode(c: CommentSpec, n: number): Record<string, unknown> {
  return {
    author: { login: c.author, __typename: c.bot === true ? "Bot" : "User" },
    body: c.body,
    url: `https://example.invalid/c/${n}`,
  };
}

export class World {
  threads: { id: string; resolved: boolean; path: string; line: number; comments: CommentSpec[] }[];
  head: Sha = HEAD;
  state = "OPEN";
  /** Extra PR commits besides the head. */
  commits: readonly Sha[] = [];
  policy: string | null = POLICY_TOML;
  readonly ops: GhMutation[] = [];
  /** Called after each mutation. Tests use it to move the head. */
  afterMutation: ((world: World, op: GhMutation) => void) | null = null;
  /** Make the n-th mutation (1-based) fail with this stderr. */
  failMutation: { readonly at: number; readonly stderr: string } | null = null;
  /** The page size of the fake paged reads. */
  threadPageSize = 100;
  commentPageSize = 100;
  /** When false, `gh api user` fails, as with a GitHub App token. */
  userKnown = true;
  private mutations = 0;

  constructor(specs: readonly ThreadSpec[]) {
    this.threads = specs.map((s, i) => ({
      id: s.id,
      resolved: s.resolved ?? false,
      path: s.path ?? "src/a.rs",
      line: s.line ?? i + 1,
      comments: [...s.comments],
    }));
  }

  private snapshotThread(t: World["threads"][number]): Record<string, unknown> {
    const first = t.comments[0];
    const last = t.comments[t.comments.length - 1];
    return {
      id: t.id,
      isResolved: t.resolved,
      isOutdated: false,
      path: t.path,
      line: t.line,
      comments: { totalCount: t.comments.length, nodes: [{ author: { login: first?.author ?? "ghost" }, body: first?.body ?? "" }] },
      lastComment: { nodes: [{ author: { login: last?.author ?? "ghost" } }] },
    };
  }

  private page<T>(items: readonly T[], after: string | undefined, size: number): { readonly nodes: readonly T[]; readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null } } {
    const start = after === undefined ? 0 : Number(after);
    const end = Math.min(start + size, items.length);
    return { nodes: items.slice(start, end), pageInfo: { hasNextPage: end < items.length, endCursor: end < items.length ? String(end) : null } };
  }

  private comments(t: World["threads"][number], after: string | undefined): Record<string, unknown> {
    const p = this.page(t.comments, after, this.commentPageSize);
    return {
      totalCount: t.comments.length,
      pageInfo: p.pageInfo,
      nodes: p.nodes.map((c, i) => commentNode(c, i)),
    };
  }

  detail(t: World["threads"][number]): Record<string, unknown> {
    return { id: t.id, isResolved: t.resolved, isOutdated: false, path: t.path, line: t.line, comments: this.comments(t, undefined) };
  }

  gh(overrides: Record<string, (vars: Record<string, string>) => Reply> = {}): FakeGh {
    const commits = [...this.commits.map((c) => commitNode(c, [BASE])), commitNode(this.head, [BASE])];
    return fakeGh(
      {
        pr: () =>
          prResponse({
            headRefOid: this.head,
            state: this.state,
            commits: { totalCount: commits.length, nodes: commits },
            latestCommit: {
              nodes: [{ commit: { id: "C_node_1", oid: this.head, statusCheckRollup: { contexts: { totalCount: 0, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } }],
            },
            reviewThreads: {
              totalCount: this.threads.length,
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: this.threads.map((t) => this.snapshotThread(t)),
            },
          }),
        base: () => baseResponse(),
        issue: () => ({ data: { repository: { issueOrPullRequest: null } } }),
        threadDetails: (vars) => {
          const p = this.page(this.threads, vars["after"], this.threadPageSize);
          return { data: { node: { reviewThreads: { pageInfo: p.pageInfo, nodes: p.nodes.map((t) => this.detail(t)) } } } };
        },
        thread: (vars) => {
          const t = this.threads.find((x) => x.id === vars["id"]);
          return {
            data: { node: t === undefined ? null : { id: t.id, isResolved: t.resolved, isOutdated: false, path: t.path, line: t.line, comments: this.comments(t, vars["after"]) } },
          };
        },
        prHead: () => ({ data: { node: { state: this.state, headRefOid: this.head } } }),
        ...overrides,
      },
      {
        "repos/example-org/example-repo/rules/branches/main": RULES,
        "repos/example-org/example-repo/branches/main": { protected: true, protection: { enabled: false } },
        ...(this.policy === null ? {} : { "repos/example-org/example-repo/contents/.config/pr-policy.toml": this.policy }),
        ...(this.userKnown ? { user: { login: AGENT } } : {}),
      },
    );
  }

  /** The fake mutation runner. It changes the world like GitHub would. */
  mutate = async (op: GhMutation): Promise<RunResult> => {
    this.ops.push(op);
    this.mutations += 1;
    if (this.failMutation?.at === this.mutations) {
      return { code: 1, stdout: "", stderr: this.failMutation.stderr };
    }
    let reply: unknown = {};
    if (op.kind === "addPullRequestReviewThreadReply") {
      this.threads.find((t) => t.id === op.threadId)?.comments.push({ author: AGENT, body: op.body });
      reply = { data: { addPullRequestReviewThreadReply: { comment: { id: `C_${this.mutations}` } } } };
    } else if (op.kind === "resolveReviewThread") {
      const t = this.threads.find((x) => x.id === op.threadId);
      if (t !== undefined) {
        t.resolved = true;
      }
      reply = { data: { resolveReviewThread: { thread: { id: op.threadId, isResolved: true } } } };
    }
    this.afterMutation?.(this, op);
    return { code: 0, stdout: JSON.stringify(reply), stderr: "" };
  };
}

export const FIX_COMMIT = sha("1");
