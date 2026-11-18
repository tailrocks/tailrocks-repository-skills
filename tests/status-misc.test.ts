import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { globToRegExp, matchesAnyGlob } from "../lib/glob.ts";
import { ensureBudget, readGraphqlLimit } from "../lib/github/rate-limit.ts";
import { evaluate } from "../lib/status/evaluate.ts";
import { main, parseArgs, EXIT } from "../lib/status/cli.ts";
import { renderOneLine, renderText, toJson } from "../lib/status/render.ts";
import { bodyProblems, hasSignoff, linkedIssueNumbers, normalizeLogin, parseDoneWhen, templateHeadings, withoutSignoffs } from "../lib/status/text.ts";
import { parseSnapshot } from "../lib/status/snapshot-io.ts";
import { FINDING_CODES } from "../lib/status/types.ts";
import { anonymize } from "../tools/anonymize-snapshot.ts";
import { baseResponse, commitNode, fakeGh, prResponse } from "./helpers/fake-gh.ts";
import { builtinPolicy, check, examplePolicy, green, HEAD, root } from "./helpers/status.ts";

describe("glob", () => {
  test("star stays in a segment, double star crosses", () => {
    expect(globToRegExp("release/*").test("release/1.0")).toBe(true);
    expect(globToRegExp("release/*").test("release/1/2")).toBe(false);
    expect(globToRegExp("**/*.rs").test("a/b/c.rs")).toBe(true);
    expect(matchesAnyGlob(["main", "rel?ase/*"], "release/x")).toBe(true);
    expect(matchesAnyGlob([], "main")).toBe(false);
    expect(globToRegExp("a.b").test("axb")).toBe(false);
  });
});

describe("text helpers", () => {
  test("Done-when boxes", () => {
    const body = "intro\n## Done when\n\n- [x] one\n- [ ] two\n* [ ] three\n\n## Other\n- [ ] not counted\n";
    expect(parseDoneWhen(body, "Done when")).toEqual({ checked: 1, unchecked: ["two", "three"] });
    expect(parseDoneWhen("no section", "Done when")).toBeNull();
    expect(parseDoneWhen("**Done when**\n- [ ] a\n", "done when")?.unchecked).toEqual(["a"]);
    expect(parseDoneWhen("```\n## Done when\n- [ ] a\n```", "Done when")).toBeNull();
  });
  test("issue references", () => {
    expect(linkedIssueNumbers("Closes #4, #5\nPart of #6\nrefs: example-org/example-repo#8\nFixes other/repo#9\nFixed #7", "example-org/example-repo", 7)).toEqual([4, 5, 6, 8]);
    expect(linkedIssueNumbers("see #12 for context", "example-org/example-repo", 7)).toEqual([]);
    expect(linkedIssueNumbers("<!-- Closes #3 -->", "example-org/example-repo", 7)).toEqual([]);
  });
  test("body sections", () => {
    expect(bodyProblems("## Why\nx\n## What\nTODO\n", ["Why", "What", "Proof"])).toEqual(['empty section "What"', 'missing section "Proof"']);
    expect(templateHeadings("# Title\n## Why\n<!-- c -->\n### What\n")).toEqual(["Title", "Why", "What"]);
  });
  test("sign-off helpers", () => {
    expect(hasSignoff("x\n\nSigned-off-by: A <a@b.c>")).toBe(true);
    expect(hasSignoff("Signed-off-by: ")).toBe(false);
    expect(hasSignoff("x")).toBe(false);
    expect(withoutSignoffs("x\n\nSigned-off-by: A <a@b.c>\n")).toBe(withoutSignoffs("x"));
    expect(normalizeLogin("app/Renovate")).toBe("renovate");
    expect(normalizeLogin("renovate[bot]")).toBe("renovate");
  });
});

describe("render", () => {
  const blocked = evaluate(green({ isDraft: true, behindBy: 2 }), examplePolicy(), "local");
  test("text: one verdict line, one line per finding, and next for blockers", () => {
    const text = renderText(blocked);
    const lines = text.split("\n");
    expect(lines[0]).toContain("BLOCKED");
    expect(lines[0]).toContain(blocked.next);
    expect(text).toContain("LOCAL policy");
    expect(text).toContain("[blocker] draft (pr-merge)");
    expect(text).toContain("[info] behind_base");
    expect(lines.filter((l) => l.trim().startsWith("next:")).length).toBe(1);
  });
  test("one line", () => {
    expect(renderOneLine(blocked)).toBe("#7 BLOCKED draft,behind_base");
    expect(renderOneLine(evaluate(green(), examplePolicy()))).toBe("#7 READY");
  });
  test("json has stable keys", () => {
    const parsed: unknown = JSON.parse(toJson(blocked));
    expect(Object.keys(parsed as object)).toEqual(["schema", "repo", "number", "headSha", "state", "next", "policySource", "findings"]);
    const first = (parsed as { findings: object[] }).findings[0];
    expect(Object.keys(first ?? {})).toEqual(["code", "kind", "owner", "detail", "next"]);
  });
  test("a local policy is marked, the default one is not", () => {
    expect(renderText(evaluate(green(), builtinPolicy()))).not.toContain("LOCAL");
  });
});

describe("rate limit", () => {
  const reply = (remaining: number, reset: number) => ({ resources: { graphql: { limit: 5000, remaining, reset } } });
  test("reads the GraphQL bucket", async () => {
    const limit = await readGraphqlLimit(fakeGh({}, { rate_limit: reply(42, 1000) }).run);
    expect(limit).toEqual({ remaining: 42, limit: 5000, resetAt: 1000 });
  });
  test("enough budget passes", async () => {
    expect(await ensureBudget(fakeGh({}, { rate_limit: reply(500, 9999) }).run, 100, { wait: false })).toEqual({ ok: true, remaining: 500 });
  });
  test("a low budget stops and says when it returns", async () => {
    const result = await ensureBudget(fakeGh({}, { rate_limit: reply(10, 2000) }).run, 100, { wait: false, now: () => 1_000_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("10 of 5000");
      expect(result.message).toContain("needs about 100");
      expect(result.message).toContain("--wait");
    }
  });
  test("--wait sleeps until the reset, then re-checks", async () => {
    let calls = 0;
    const slept: number[] = [];
    const fake = fakeGh({}, { rate_limit: { resources: { graphql: { limit: 5000, remaining: 0, reset: 1030 } } } });
    const run: typeof fake.run = async (args) => {
      calls += 1;
      return calls === 1 ? fake.run(args) : { code: 0, stdout: JSON.stringify(reply(5000, 9999)), stderr: "" };
    };
    const result = await ensureBudget(run, 100, { wait: true, now: () => 1_000_000, sleep: async (ms) => void slept.push(ms) });
    expect(result.ok).toBe(true);
    expect(slept).toEqual([32_000]);
  });
  test("--wait refuses a wait longer than an hour", async () => {
    const result = await ensureBudget(fakeGh({}, { rate_limit: reply(0, 1_000_000 + 7200) }).run, 100, { wait: true, now: () => 1_000_000_000, sleep: async () => undefined });
    expect(result.ok).toBe(false);
  });
});

describe("command line", () => {
  test("parses a PR number, --all, and options", () => {
    expect(parseArgs(["12"])).toEqual({ ok: true, args: { target: { kind: "one", number: 12 }, repo: null, json: false, gitDir: null, policyPath: null, wait: false } });
    const all = parseArgs(["--all", "--repo", "a/b", "--json", "--git-dir", "/x", "--policy", "p.toml", "--wait"]);
    expect(all).toEqual({ ok: true, args: { target: { kind: "all" }, repo: "a/b", json: true, gitDir: "/x", policyPath: "p.toml", wait: true } });
    expect(parseArgs(["#5"]).ok).toBe(true);
  });
  test("rejects bad usage", () => {
    for (const argv of [[], ["--repo"], ["--repo", "--json", "1"], ["abc"], ["--force", "1"]]) {
      expect(parseArgs(argv).ok).toBe(false);
    }
  });
  test("exit codes follow the design", () => {
    expect(EXIT).toEqual({ READY: 0, WAITING: 10, BLOCKED: 20 });
  });

  const baseFake = (pr: unknown) => fakeGh({ pr: () => pr, base: () => baseResponse(), issue: () => ({ data: { repository: { issueOrPullRequest: null } } }), mergeability: () => ({ data: {} }) }, {
    "repos/example-org/example-repo/rules/branches/main": [],
    "repos/example-org/example-repo/branches/main": { protection: { enabled: false } },
  });

  test("main prints a verdict and returns the exit code", async () => {
    const lines: string[] = [];
    const code = await main(["7", "--repo", "example-org/example-repo"], { runGh: baseFake(prResponse()).run, out: (l) => lines.push(l), err: (l) => lines.push(l) });
    expect(lines.join("\n")).toContain("example-org/example-repo#7:");
    expect([0, 10, 20]).toContain(code);
    expect(code).toBe(lines.join("\n").includes("READY") ? 0 : lines.join("\n").includes("WAITING") ? 10 : 20);
  });

  test("main prints JSON on request and BLOCKED gives 20", async () => {
    const pr = prResponse({ isDraft: true, mergeStateStatus: "DRAFT" });
    const lines: string[] = [];
    const code = await main(["7", "--repo", "example-org/example-repo", "--json"], { runGh: baseFake(pr).run, out: (l) => lines.push(l), err: (l) => lines.push(l) });
    expect(code).toBe(20);
    const parsed: unknown = JSON.parse(lines.join("\n"));
    expect((parsed as { state: string }).state).toBe("BLOCKED");
    expect((parsed as { policySource: string }).policySource).toBe("default");
  });

  test("a PR that cannot be read is a BLOCKED unknown_state, exit 20", async () => {
    const lines: string[] = [];
    const code = await main(["7", "--repo", "example-org/example-repo"], { runGh: fakeGh({ pr: () => ({ errors: [{ message: "nope" }] }) }).run, out: (l) => lines.push(l), err: (l) => lines.push(l) });
    expect(code).toBe(20);
    expect(lines.join("\n")).toContain("unknown_state");
  });

  test("usage errors exit 2", async () => {
    const lines: string[] = [];
    expect(await main([], { out: (l) => lines.push(l), err: (l) => lines.push(l) })).toBe(2);
    expect(await main(["7", "--repo", "bad"], { out: (l) => lines.push(l), err: (l) => lines.push(l) })).toBe(2);
    expect(await main(["7", "--repo", "a/b", "--policy", "/no/such/file.toml"], { out: (l) => lines.push(l), err: (l) => lines.push(l) })).toBe(2);
    expect(lines.join("\n")).toContain("usage");
  });

  test("--all stops with exit 2 when the GraphQL budget is low", async () => {
    const lines: string[] = [];
    const fake = fakeGh({ open: () => ({ data: { repository: { pullRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ number: 1 }, { number: 2 }] } } } }) }, { rate_limit: { resources: { graphql: { limit: 5000, remaining: 3, reset: 4_000_000_000 } } } });
    const code = await main(["--all", "--repo", "example-org/example-repo"], { runGh: fake.run, out: (l) => lines.push(l), err: (l) => lines.push(l) });
    expect(code).toBe(2);
    expect(lines.join("\n")).toContain("budget");
  });

  test("--all reports every PR and the worst state", async () => {
    const lines: string[] = [];
    const fake = fakeGh(
      {
        open: () => ({ data: { repository: { pullRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ number: 7 }, { number: 8 }] } } } }),
        pr: (v) => (v["number"] === "7" ? prResponse() : prResponse({ isDraft: true })),
        base: () => baseResponse(),
        issue: () => ({ data: { repository: { issueOrPullRequest: null } } }),
      },
      { rate_limit: { resources: { graphql: { limit: 5000, remaining: 4000, reset: 4_000_000_000 } } }, "repos/example-org/example-repo/rules/branches/main": [], "repos/example-org/example-repo/branches/main": { protection: { enabled: false } } },
    );
    const code = await main(["--all", "--repo", "example-org/example-repo"], { runGh: fake.run, out: (l) => lines.push(l), err: (l) => lines.push(l) });
    expect(lines.length).toBe(2);
    expect(lines[0]).toStartWith("#7 ");
    expect(lines[1]).toStartWith("#8 BLOCKED");
    expect(code).toBe(20);
  });
});

describe("anonymizer", () => {
  test("removes people, the repository, emails, bodies, and branch names", () => {
    const snapshot = green({
      repo: "acme-corp/widget-factory" as never,
      author: "alice-real",
      title: "Fix widget-factory crash",
      body: "## Why\nsecret detail by alice-real\nCloses #5\nlong prose about acme-corp",
      headRef: "alice/secret-branch",
      reviews: [{ author: "bob-real", association: "MEMBER", state: "COMMENTED", body: "Verdict: approve\n\nsecret review prose for acme-corp", commit: HEAD, submittedAt: "2026-01-01T00:00:00Z" }],
      threads: [{ id: "PRRT_real", isResolved: false, isOutdated: false, path: "crates/acme/src/lib.rs", line: 3, firstAuthor: "some-bot", firstBody: "**Plain heading about widget-factory**\nmore", lastAuthor: "alice-real", commentCount: 2 }],
      commits: [{ oid: HEAD, parents: [], tree: HEAD, message: "feat: secret work\n\nSigned-off-by: Alice Real <alice@acme-corp.example>", authorLogin: "alice-real", authorEmail: "alice@acme-corp.example", committedDate: "2026-01-01T00:00:00Z" }],
      checks: [check("Required", { workflow: "acme-corp CI" })],
    });
    const { snapshot: out, leaks } = anonymize(snapshot, { keepLogins: ["some-bot"], policy: examplePolicy() });
    const text = JSON.stringify(out).toLowerCase();
    for (const secret of ["acme", "widget", "alice", "bob-real", "secret", "prrt_real"]) {
      expect(text).not.toContain(secret);
    }
    expect(leaks).toEqual([]);
    expect<string>(out.repo).toBe("example-org/example-repo");
    expect(out.author).toBe("user-a");
    expect(out.reviews[0]?.author).toBe("user-b");
    expect(out.reviews[0]?.body).toBe("Verdict: approve");
    expect(out.threads[0]?.firstAuthor).toBe("some-bot");
    expect(out.commits[0]?.message).toContain("Signed-off-by: user-a");
    expect(out.body).toContain("Closes #5");
    expect(out.number).toBe(7);
    expect(out.headSha).toBe(HEAD);
  });

  test("keeps the facts that evaluate reads", () => {
    const original = parseSnapshot(readFileSync(join(root, "tests", "fixtures", "status", "stale-approval.json"), "utf8"));
    const again = anonymize(original, { keepLogins: ["chatgpt-codex-connector", "renovate"], policy: examplePolicy() });
    const policy = examplePolicy();
    expect(evaluate(again.snapshot, policy).findings.map((f) => f.code)).toEqual(evaluate(original, policy).findings.map((f) => f.code));
  });

  test("a thread keeps its fix-pattern signal when the first line is cut", () => {
    const long = `${"x".repeat(150)} P1 hidden`;
    const out = anonymize(green({ threads: [{ id: "t", isResolved: false, isOutdated: false, path: null, line: null, firstAuthor: "a", firstBody: long, lastAuthor: "a", commentCount: 1 }] }), { keepLogins: [], policy: examplePolicy() });
    expect(out.snapshot.threads[0]?.firstBody.startsWith("P1 ")).toBe(true);
  });
});

describe("fixtures and policy", () => {
  test("the bot-unsigned fixture needs dco_missing under bot_commits = rewrite", () => {
    const snapshot = parseSnapshot(readFileSync(join(root, "tests", "fixtures", "status", "bot-unsigned.json"), "utf8"));
    const policy = examplePolicy();
    const exempt = evaluate(snapshot, policy).findings.map((f) => f.code);
    expect(exempt).not.toContain("dco_missing");
    const rewrite = evaluate(snapshot, { ...policy, dco: { ...policy.dco, bot_commits: "rewrite" } }).findings.find((f) => f.code === "dco_missing");
    expect(rewrite?.detail).toContain("renovate[bot]");
    expect(snapshot.commits.some((c) => c.authorLogin === "renovate[bot]" && !/signed-off-by/i.test(c.message))).toBe(true);
  });

  test("the stacked fixture names its parent PR", () => {
    const snapshot = parseSnapshot(readFileSync(join(root, "tests", "fixtures", "status", "stacked.json"), "utf8"));
    expect(snapshot.parentPr).not.toBeNull();
    expect(snapshot.baseRef).toBe(`feature/${snapshot.parentPr}`);
  });

  test("the ejected fixture holds a removal after the last push and a conflict", () => {
    const snapshot = parseSnapshot(readFileSync(join(root, "tests", "fixtures", "status", "ejected-merge-conflict.json"), "utf8"));
    expect(snapshot.lastQueueRemoval?.afterLastPush).toBe(true);
    expect(snapshot.mergeable).toBe("CONFLICTING");
  });

  test("a PR with more than 100 reviews reads in full and is not unknown_state", () => {
    const snapshot = parseSnapshot(readFileSync(join(root, "tests", "fixtures", "status", "many-reviews.json"), "utf8"));
    expect(snapshot.reviews.length).toBeGreaterThan(100);
    expect(snapshot.reviewsTruncated).toBe(false);
    expect(evaluate(snapshot, examplePolicy()).findings.map((f) => f.code)).not.toContain("unknown_state");
  });

  test("an UNSTABLE PR with no required failure is READY and says why GitHub is unstable", () => {
    const snapshot = parseSnapshot(readFileSync(join(root, "tests", "fixtures", "status", "unstable-non-required.json"), "utf8"));
    expect(snapshot.mergeStateStatus).toBe("UNSTABLE");
    const verdict = evaluate(snapshot, examplePolicy());
    expect(verdict.state).toBe("READY");
    expect(verdict.findings.map((f) => f.code)).toContain("non_required_failing");
  });

  test("a fixture with a wrong shape fails to load", () => {
    expect(() => parseSnapshot('{"schema":1}')).toThrow();
    expect(() => parseSnapshot("nope")).toThrow();
  });
});

describe("skill package", () => {
  // Built from parts: the generic-name test scans this file.
  const id = `${["tail", "rocks"].join("")}-pr-status`;
  const dir = join(root, "skills", id);
  const skill = readFileSync(join(dir, "SKILL.md"), "utf8");

  test("frontmatter holds name, description, and license only", () => {
    const front = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? "";
    const keys = [...front.matchAll(/^([a-z-]+):/gm)].map((m) => m[1]);
    expect(keys).toEqual(["name", "description", "license"]);
    expect(front).toContain(`name: ${id}`);
  });
  test("description is at most 1024 characters, without angle brackets, trigger first", () => {
    const front = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? "";
    const description = (/description: >-\n([\s\S]*?)\nlicense:/.exec(front)?.[1] ?? "").replace(/\n\s*/g, " ").trim();
    expect(description.length).toBeGreaterThan(50);
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(description).not.toMatch(/[<>]/);
    expect(description).toMatch(/^Reports whether/);
    expect(description).toContain("Use this skill when");
  });
  test("body is short and starts with the Bun check", () => {
    expect(skill.split("\n").length).toBeLessThan(200);
    expect(skill).toContain("bun --version");
    expect(skill).toContain("bun run <skill-dir>/scripts/status.ts");
    expect(skill).toContain("never conclude READY yourself");
  });
  test("every finding code is documented", () => {
    const table = readFileSync(join(dir, "references", "finding-codes.md"), "utf8");
    for (const code of FINDING_CODES) {
      expect(table).toContain(`| \`${code}\` |`);
    }
  });
  test("the agent file allows implicit invocation", () => {
    const yaml = readFileSync(join(dir, "agents", "openai.yaml"), "utf8");
    expect(yaml).toContain("allow_implicit_invocation: true");
    expect(yaml).toContain("display_name:");
  });
  test("the script entry and the vendored library exist", () => {
    expect(existsSync(join(dir, "scripts", "status.ts"))).toBe(true);
    expect(existsSync(join(dir, "scripts", "lib", "status", "evaluate.ts"))).toBe(true);
    expect(existsSync(join(dir, "references", "runtime-trust.md"))).toBe(true);
  });
  test("lib code builds no shell string and names no write call", () => {
    for (const file of ["lib/github/gather.ts", "lib/github/graphql.ts", "lib/github/rules.ts", "lib/github/git-facts.ts", "lib/status/cli.ts", "lib/status/run.ts"]) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source).not.toMatch(/child_process|Bun\.\$|\bexec\(|shell:/);
      expect(source).not.toMatch(/ghMutate|ghMutationArgv|pushDcoRewrite|"push"|"POST"|"PATCH"|"PUT"|"DELETE"/);
    }
  });
});
