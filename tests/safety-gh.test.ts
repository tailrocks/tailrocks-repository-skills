import { afterAll, describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { removeBodyFiles, writeBodyFile } from "../lib/body-file.ts";
import { checkGh, ghMutationArgv, type GhMutation } from "../lib/safety.ts";
import { type RepoSlug, type Sha } from "../lib/types.ts";

const SHA = "b".repeat(40);
const repo = "example-org/example-repo" as RepoSlug;
const sha = SHA as Sha;

const bodyFile = writeBodyFile("A body made by the library helper.\n");
afterAll(() => removeBodyFiles());

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
    ["api", "--header=Accept: application/vnd.github+json", "repos/example-org/example-repo/pulls"],
    ["api", "graphql", "-f", "query=query($n: Int!) { viewer { login } }", "-F", "n=1"],
    ["api", "graphql", "-f", "query={ viewer { login } }"],
    ["api", "graphql", "-f", "query=# a comment\nquery { viewer { login } }"],
    ["pr", "view", "1", "--json", "state"],
    ["pr", "list", "--state", "open"],
    ["pr", "create", "--draft", "--title", "t", "--body-file", bodyFile, "--base", "main"],
    ["pr", "edit", "1", "--title", "t"],
    ["pr", "edit", "1", "--add-label", "ready", "--remove-label", "wip"],
    ["pr", "edit", "1", "--body-file", bodyFile],
    ["pr", "edit", "1", "-F", bodyFile],
    ["pr", "ready", "1"],
    ["pr", "checks", "1"],
    ["pr", "diff", "1"],
    ["pr", "comment", "1", "--body-file", bodyFile],
    ["pr", "comment", "1", `--body-file=${bodyFile}`],
    ["pr", "checks", "1", "--watch", "--interval", "30"],
    ["run", "rerun", "123", "--failed"],
    ["run", "view", "123", "--json", "status,conclusion"],
    ["run", "list", "--limit", "5", "--json", "databaseId"],
    ["pr", "merge", "1", "--squash", "--match-head-commit", SHA],
    ["pr", "merge", "1", "--merge", "--match-head-commit", SHA],
    ["pr", "merge", "1", "--rebase", "--match-head-commit", SHA],
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
    ["auth status -t", ["auth", "status", "-t"]],
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
    ["graphql mutation via -F", ["api", "graphql", "-F", "query=mutation { a }"]],
    ["graphql mutation with a trailing slash path", ["api", "graphql/", "-f", "query=mutation { a }"]],
    ["graphql mutation with a query string path", ["api", "graphql?x=1", "-f", "query=mutation { a }"]],
    ["graphql mutation, upper-case path", ["api", "GraphQL", "-f", "query=mutation { a }"]],
    ["graphql query file", ["api", "graphql", "-F", "query=@q.graphql"]],
  ] satisfies readonly (readonly [string, readonly string[]])[])("%s", (_name, args) => {
    const guard = checkGh(args);
    expect(guard.allowed).toBe(false);
  });

  test("the guard does not parse GraphQL: the word mutation anywhere refuses the call", () => {
    for (const query of [
      'query { search(query: "mutation", type: ISSUE) { issueCount } }',
      "# no mutation here\nquery { viewer { login } }",
      'query { a(x: """mutation""") { b } }',
      "MuTaTiOn { a }",
    ]) {
      expect(allowed(["api", "graphql", "-f", `query=${query}`])).toBe(false);
    }
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

// Each case below is a bypass that the code review reproduced against the first version.
describe("regression: review bypasses", () => {
  const refused = (args: readonly string[]): void => {
    expect(checkGh(args).allowed).toBe(false);
  };

  test("gh auth status takes no argument at all", () => {
    for (const extra of [
      ["--show-token=true"],
      ["--show-token=1"],
      ["--show-token"],
      ["-at"],
      ["-t"],
      ["-ta"],
      ["--hostname", "example.invalid"],
      ["--active"],
      ["--json", "hosts"],
      ["--"],
    ]) {
      refused(["auth", "status", ...extra]);
    }
    expect(allowed(["auth", "status"])).toBe(true);
    refused(["auth"]);
    refused(["auth", "refresh"]);
  });

  test("a block string inside a comment does not hide a mutation", () => {
    const hidden = 'query=# """\nmutation { deleteRef(input:{refId:"x"}) { clientMutationId } }\n# """';
    refused(["api", "graphql", "-f", hidden]);
    refused(["api", "graphql", "-f", 'query=query { a }\n# """\nmutation { b }\n# """']);
    refused(["api", "graphql", "-f", 'query="""\n""" mutation { b }']);
    refused(["api", "graphql", "-f", 'query=query { a(s: "\\"") } mutation { b }']);
    refused(["api", "graphql", "--raw-field=query=mutation { b }"]);
    refused(["api", "graphql", "--field", "query=mutation { b }"]);
  });

  test("a pull request command cannot post a local file", () => {
    const secret = join(homedir(), ".config", "gh", "hosts.yml");
    refused(["pr", "comment", "1", "--body-file", secret]);
    refused(["pr", "comment", "1", "-F", secret]);
    refused(["pr", "comment", "1", `--body-file=${secret}`]);
    refused(["pr", "create", "--body-file", "/etc/passwd"]);
    refused(["pr", "edit", "1", "--body-file", "~/.config/gh/hosts.yml"]);
    refused(["pr", "merge", "1", "--squash", "-F", secret, "--match-head-commit", SHA]);
    refused(["pr", "merge", "1", "--squash", "--body-file", bodyFile, "--match-head-commit", SHA]);
    refused(["pr", "comment", "1", "--body-file", "-"]);
    refused(["pr", "comment", "1", "--body-file", ""]);
  });

  test("a body file must be one that the library helper made", () => {
    refused(["pr", "comment", "1", "--body-file", `${bodyFile}/../../etc/passwd`]);
    refused(["pr", "comment", "1", "--body-file", bodyFile.replace(/body-\d+\.md$/, "../hosts.yml")]);
    refused(["pr", "comment", "1", "--body-file", bodyFile.replace(/body-\d+\.md$/, "other.md")]);
    refused(["pr", "comment", "1", "--body-file", `${bodyFile}.bak`]);
    refused(["pr", "comment", "1", "--body-file", join(bodyFile, "..", "..", "x")]);
    refused(["pr", "comment", "1", "--body-file", "/tmp/body-1.md"]);
    refused(["pr", "comment", "1", "--body-file", "body-1.md"]);
  });

  test("literal body text flags are refused: bodies come from the helper file only", () => {
    refused(["pr", "comment", "1", "--body", "hello"]);
    refused(["pr", "comment", "1", "-b", "hello"]);
    refused(["pr", "create", "--title", "t", "--body", "b"]);
    refused(["pr", "merge", "1", "--squash", "--body", "x", "--match-head-commit", SHA]);
    refused(["pr", "merge", "1", "--squash", "-b", "x", "--match-head-commit", SHA]);
  });

  test("pr edit changes only labels, title, and body", () => {
    refused(["pr", "edit", "1", "--base", "other"]);
    refused(["pr", "edit", "1", "-B", "other"]);
    refused(["pr", "edit", "1", "--add-reviewer", "someone"]);
    refused(["pr", "edit", "1", "--add-assignee", "someone"]);
    refused(["pr", "edit", "1", "--milestone", "v1"]);
    refused(["pr", "edit", "1", "--add-project", "p"]);
    refused(["pr", "edit", "1", "--body", "text"]);
  });

  test("pr merge allows only the listed flags", () => {
    for (const extra of [["-d"], ["--delete-branch"], ["--admin"], ["--admin=true"], ["-F", bodyFile], ["--subject", "s"], ["-s"], ["-sd"], ["-ds"], ["--disable-auto"]]) {
      refused(["pr", "merge", "1", "--squash", "--match-head-commit", SHA, ...extra]);
    }
    refused(["pr", "merge", "1", "--squash", "--match-head-commit", SHA.toUpperCase()]);
    refused(["pr", "merge", "1", "--squash", "--match-head-commit", `${SHA}x`]);
  });

  test("other subcommands refuse flags that are not listed", () => {
    refused(["pr", "view", "1", "--web"]);
    refused(["pr", "view", "1", "-w"]);
    refused(["pr", "list", "--web"]);
    refused(["pr", "create", "--fill-first"]);
    refused(["pr", "create", "--template", "t.md"]);
    refused(["pr", "ready", "1", "--undo"]);
    refused(["pr", "checks", "1", "--web"]);
    refused(["pr", "diff", "1", "--web"]);
    refused(["pr", "comment", "1", "--edit-last", "--body-file", bodyFile]);
    refused(["pr", "comment", "1", "--delete-last", "--yes"]);
    refused(["repo", "view", "--web"]);
    refused(["repo", "view", "example-org/example-repo", "extra"]);
    refused(["issue", "view", "3", "--web"]);
    refused(["run", "rerun", "1", "--debug"]);
    refused(["run", "rerun", "abc"]);
    refused(["run", "view", "1", "--web"]);
    refused(["run", "list", "--web"]);
    refused(["run", "delete", "1"]);
    refused(["pr", "view", "--repo", "host.example/org/repo"]);
    refused(["pr", "view", "1", "-Rexample-org/example-repo"]);
    refused(["pr", "view", "1", "2"]);
    refused(["pr", "view", "1", "--json"]);
    refused(["pr", "view", "1", "--json=a b"]);
  });

  test("a jq filter may not read the environment", () => {
    refused(["pr", "view", "1", "--json", "state", "--jq", "env"]);
    refused(["pr", "view", "1", "--json", "state", "-q", "$ENV.GH_TOKEN"]);
    refused(["api", "repos/x/y", "--jq", "env.GH_TOKEN"]);
    expect(allowed(["pr", "view", "1", "--json", "state", "--jq", ".state"])).toBe(true);
  });

  test("gh api accepts only the Accept headers that the library sends", () => {
    for (const header of [
      "X-HTTP-Method-Override: DELETE",
      "Authorization: token abc",
      "Accept: text/html",
      "Accept: application/vnd.github.raw+json, text/html",
      "accept: application/vnd.github.raw+json",
      "X-GitHub-Api-Version: 2022-11-28",
      "Accept: application/vnd.github.raw+json\nX-HTTP-Method-Override: DELETE",
    ]) {
      refused(["api", "-H", header, "repos/x/y"]);
      refused(["api", `--header=${header}`, "repos/x/y"]);
    }
  });
});
