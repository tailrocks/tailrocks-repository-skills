import { describe, expect, test } from "bun:test";
import { checkGh, ghMutationArgv, type GhMutation } from "../lib/safety.ts";
import { type RepoSlug, type Sha } from "../lib/types.ts";

const SHA = "b".repeat(40);
const repo = "example-org/example-repo" as RepoSlug;
const sha = SHA as Sha;

function allowed(args: readonly string[]): boolean {
  return checkGh(args).allowed;
}

describe("gh allow-list: accepted forms", () => {
  const accepted: readonly (readonly string[])[] = [
    ["api", "repos/example-org/example-repo/pulls/1"],
    ["api", "-X", "GET", "repos/example-org/example-repo/pulls", "-f", "state=open"],
    ["api", "--method=GET", "repos/example-org/example-repo/pulls", "-F", "per_page=100"],
    ["api", "--paginate", "--slurp", "repos/example-org/example-repo/pulls"],
    ["api", "-H", "Accept: application/vnd.github.raw+json", "repos/example-org/example-repo/contents/x?ref=main"],
    ["api", "graphql", "-f", "query=query($n: Int!) { viewer { login } }", "-F", "n=1"],
    ["api", "graphql", "-f", "query={ viewer { login } }"],
    ["pr", "view", "1", "--json", "state"],
    ["pr", "list", "--state", "open"],
    ["pr", "create", "--draft", "--title", "t", "--body", "b"],
    ["pr", "edit", "1", "--title", "t"],
    ["pr", "ready", "1"],
    ["pr", "checks", "1"],
    ["pr", "diff", "1"],
    ["pr", "comment", "1", "--body", "hello"],
    ["pr", "merge", "1", "--squash", "--match-head-commit", SHA],
    ["pr", "merge", "1", "--auto", "--squash", "--match-head-commit=" + SHA, "-R", "example-org/example-repo"],
    ["repo", "view", "--json", "defaultBranchRef"],
    ["issue", "view", "3", "--json", "body"],
    ["auth", "status"],
  ];
  for (const args of accepted) {
    test(JSON.stringify(args), () => {
      expect(allowed(args)).toBe(true);
    });
  }
});

describe("gh allow-list: forbidden forms are refused", () => {
  test.each([
    ["--admin anywhere", ["pr", "merge", "1", "--squash", "--admin", "--match-head-commit", SHA]],
    ["--admin on pr view", ["pr", "view", "1", "--admin"]],
    ["--admin=true", ["api", "--admin=true", "repos/x/y"]],
    ["merge -d", ["pr", "merge", "1", "-d", "--match-head-commit", SHA]],
    ["merge --delete-branch", ["pr", "merge", "1", "--delete-branch", "--match-head-commit", SHA]],
    ["merge --delete-branch=true", ["pr", "merge", "1", "--delete-branch=true", "--match-head-commit", SHA]],
    ["merge -sd cluster", ["pr", "merge", "1", "-sd", "--match-head-commit", SHA]],
    ["merge without head match", ["pr", "merge", "1", "--squash"]],
    ["merge with short head match", ["pr", "merge", "1", "--match-head-commit", "abc123"]],
    ["merge with unknown flag", ["pr", "merge", "1", "--match-head-commit", SHA, "--bypass"]],
    ["auth token", ["auth", "token"]],
    ["auth status --show-token", ["auth", "status", "--show-token"]],
    ["auth login", ["auth", "login"]],
    ["pr close", ["pr", "close", "1"]],
    ["pr checkout", ["pr", "checkout", "1"]],
    ["pr comment --delete-last", ["pr", "comment", "1", "--delete-last"]],
    ["repo delete", ["repo", "delete", "x/y"]],
    ["repo view is the only repo command", ["repo", "clone", "x/y"]],
    ["issue close", ["issue", "close", "1"]],
    ["release create", ["release", "create", "v1"]],
    ["workflow run", ["workflow", "run", "ci.yml"]],
    ["run cancel", ["run", "cancel", "1"]],
    ["secret set", ["secret", "set", "X"]],
    ["extension", ["extension", "install", "x/y"]],
    ["alias", ["alias", "set", "a", "b"]],
    ["config", ["config", "set", "k", "v"]],
    ["empty", []],
    ["api POST", ["api", "-X", "POST", "repos/x/y/issues/1/comments"]],
    ["api --method delete", ["api", "--method", "delete", "repos/x/y/git/refs/heads/z"]],
    ["api PATCH", ["api", "--method=PATCH", "repos/x/y/pulls/1"]],
    ["api PUT", ["api", "-X", "PUT", "repos/x/y/pulls/1/merge"]],
    ["api fields without -X GET (implicit POST)", ["api", "repos/x/y/issues/1/comments", "-f", "body=hi"]],
    ["api --input", ["api", "--input", "body.json", "repos/x/y"]],
    ["api -F reads a file", ["api", "-X", "GET", "repos/x/y", "-F", "x=@/etc/passwd"]],
    ["api full URL", ["api", "https://example.invalid/x"]],
    ["api path traversal", ["api", "repos/../user"]],
    ["api two endpoints", ["api", "repos/x/y", "repos/x/z"]],
    ["api no endpoint", ["api", "--paginate"]],
    ["api --hostname", ["api", "--hostname", "example.invalid", "repos/x/y"]],
    ["api unknown flag", ["api", "--preview", "x", "repos/x/y"]],
    ["graphql mutation", ["api", "graphql", "-f", "query=mutation { resolveReviewThread(input: {threadId: \"x\"}) { thread { id } } }"]],
    ["graphql mutation, odd case", ["api", "graphql", "-f", "query=  MUTATION($a: ID!) { x }"]],
    ["graphql mutation after a query", ["api", "graphql", "-f", "query=query { a } mutation { b }"]],
    ["graphql subscription", ["api", "graphql", "-f", "query=subscription { a }"]],
    ["graphql query file", ["api", "graphql", "-F", "query=@q.graphql"]],
  ] satisfies readonly (readonly [string, readonly string[]])[])("%s", (_name, args) => {
    const guard = checkGh(args);
    expect(guard.allowed).toBe(false);
  });

  test("the word mutation inside a string or comment does not block a query", () => {
    expect(allowed(["api", "graphql", "-f", 'query=query { search(query: "mutation", type: ISSUE) { issueCount } }'])).toBe(true);
    expect(allowed(["api", "graphql", "-f", "query=# no mutation here\nquery { viewer { login } }"])).toBe(true);
  });

  test("refusals say why", () => {
    const guard = checkGh(["auth", "token"]);
    expect(guard.allowed ? "" : guard.reason).toContain("never allowed");
  });
});

describe("typed mutations", () => {
  const cases: readonly GhMutation[] = [
    { kind: "issue-comment", repo, number: 7, body: "hi" },
    { kind: "addPullRequestReviewThreadReply", threadId: "PRRT_abc123", body: "reply" },
    { kind: "resolveReviewThread", threadId: "PRRT_abc123" },
    { kind: "enqueuePullRequest", pullRequestId: "PR_abc123", expectedHeadOid: sha, jump: false },
    { kind: "dequeuePullRequest", entryId: "MQE_abc123" },
    { kind: "markPullRequestReadyForReview", pullRequestId: "PR_abc123" },
    { kind: "requestReviews", pullRequestId: "PR_abc123", userIds: ["U_1", "U_2"] },
  ];

  test("every typed mutation builds a fixed gh api argv", () => {
    for (const op of cases) {
      const argv = ghMutationArgv(op);
      expect(argv[0]).toBe("api");
      // The generic guard must refuse each of these. Only the typed path may run them.
      expect(checkGh(argv).allowed).toBe(false);
    }
  });

  test("the comment endpoint is fixed to issue comments", () => {
    const comment: GhMutation = { kind: "issue-comment", repo, number: 7, body: "hi" };
    expect(ghMutationArgv(comment)).toEqual([
      "api",
      "--method",
      "POST",
      "repos/example-org/example-repo/issues/7/comments",
      "-f",
      "body=hi",
    ]);
  });

  test("graphql documents contain exactly the named mutation", () => {
    for (const op of cases.slice(1)) {
      const query = ghMutationArgv(op)[3] ?? "";
      expect(query.startsWith("query=mutation(")).toBe(true);
      expect(query).toContain(`${op.kind}(input:`);
      expect(query.match(/\b(?:mutation)\b/g)).toHaveLength(1);
    }
  });

  test("enqueue passes the expected head and the jump flag", () => {
    const argv = ghMutationArgv({ kind: "enqueuePullRequest", pullRequestId: "PR_x", expectedHeadOid: sha, jump: true });
    expect(argv).toContain(`expectedHeadOid=${SHA}`);
    expect(argv).toContain("jump=true");
  });

  test("bad values are rejected before a command exists", () => {
    expect(() => ghMutationArgv({ kind: "resolveReviewThread", threadId: "x y; rm" })).toThrow(RangeError);
    expect(() => ghMutationArgv({ kind: "issue-comment", repo, number: 0, body: "x" })).toThrow(RangeError);
    expect(() => ghMutationArgv({ kind: "issue-comment", repo, number: 1, body: "" })).toThrow(RangeError);
    expect(() => ghMutationArgv({ kind: "issue-comment", repo: "a/b/../c" as RepoSlug, number: 1, body: "x" })).toThrow(RangeError);
    expect(() => ghMutationArgv({ kind: "requestReviews", pullRequestId: "PR_x", userIds: [] })).toThrow(RangeError);
  });

  test("a comment body that looks like a file or a flag stays plain text", () => {
    const argv = ghMutationArgv({ kind: "issue-comment", repo, number: 1, body: "@/etc/passwd --admin" });
    expect(argv.at(-2)).toBe("-f");
    expect(argv.at(-1)).toBe("body=@/etc/passwd --admin");
  });
});
