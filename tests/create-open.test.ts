import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { openPr, type OpenResult } from "../lib/create/open.ts";
import { runCli, argsFor, configFor, fakeWorld, GOOD_BODY, makeRepos, newWorld, writeTemp, type FakeWorld, type Repos, type World } from "./helpers/create.ts";

const made: Repos[] = [];
afterEach(() => {
  for (const repos of made.splice(0)) {
    repos.cleanup();
  }
});

async function setup(world: Partial<World> = {}): Promise<{ repos: Repos; fake: FakeWorld; sha: string; body: string }> {
  const repos = await makeRepos();
  made.push(repos);
  await repos.git(["checkout", "-b", "feat/topic"]);
  const sha = await repos.commit("a.txt", "a\n", "feat: add a");
  return { repos, fake: fakeWorld(repos, newWorld(world)), sha, body: writeTemp(repos, "body.md", GOOD_BODY) };
}

function open(repos: Repos, fake: FakeWorld, sha: string, ...argv: string[]): Promise<OpenResult> {
  return openPr(argsFor("open", "--expect-head", sha, ...argv), configFor(repos, fake));
}

function finished(result: OpenResult): Extract<OpenResult, { kind: "finished" }>["report"] {
  if (result.kind !== "finished") {
    throw new Error(`not finished: ${JSON.stringify(result)}`);
  }
  return result.report;
}

describe("open: a new PR", () => {
  test("pushes the exact commit, creates one draft PR with the final body, and verifies it", async () => {
    const { repos, fake, sha, body } = await setup({ policy: 'schema = 1\n[pr_body]\nfooter = "Footer line."\n' });
    const report = finished(await open(repos, fake, sha, "--body-file", body));
    expect(report.problems).toEqual([]);
    expect(report.pushed).toBe(true);
    expect(report.created).toBe(true);
    expect(await repos.remoteRef("feat/topic")).toBe(sha);
    expect(fake.world.created).toHaveLength(1);
    const call = fake.world.created[0];
    expect(call?.args).toEqual([
      "pr", "create", "--repo", "example-org/example-repo", "--base", "main", "--head", "feat/topic", "--title", "feat: add a",
      "--body-file", call?.args[call.args.indexOf("--body-file") + 1] ?? "", "--draft",
    ]);
    expect(call?.body.endsWith("\n\nFooter line.\n")).toBe(true);
    expect(report.pr?.isDraft).toBe(true);
    expect(report.next).toContain("pr-merge ready");
  });

  test("the git calls are one guarded push of the sha, never a force", async () => {
    const { repos, fake, sha, body } = await setup();
    const calls: string[][] = [];
    finished(await openPr(argsFor("open", "--expect-head", sha, "--body-file", body), configFor(repos, fake, {}, calls)));
    const pushes = calls.filter((c) => c[0] === "push");
    expect(pushes).toEqual([["push", "origin", `${sha}:refs/heads/feat/topic`]]);
    expect(calls.flat().some((a) => a.startsWith("--force") || a === "-f" || a.startsWith("+"))).toBe(false);
  });

  test("an issue link line is added to the body", async () => {
    const { repos, fake, sha, body } = await setup();
    fake.world.issues.set(4, { state: "OPEN", title: "Bug", body: "It fails." });
    finished(await open(repos, fake, sha, "--issue", "4", "--body-file", body));
    expect(fake.world.created[0]?.body).toContain("\n\nCloses #4\n");
  });

  test("labels go on after the create, with --run-ci in label mode", async () => {
    const { repos, fake, sha, body } = await setup({ policy: 'schema = 1\n[labels]\npr_ci = "label"\nrun_once = "ci:run"\n' });
    const report = finished(await open(repos, fake, sha, "--run-ci", "--label", "area:docs", "--body-file", body));
    expect(report.labelsAdded).toEqual(["area:docs", "ci:run"]);
    expect(fake.world.edits[0]).toEqual(["pr", "edit", "101", "--repo", "example-org/example-repo", "--add-label", "area:docs,ci:run"]);
  });

  test("a failed label edit leaves the PR and reports a problem", async () => {
    const { repos, fake, sha, body } = await setup({ editFails: true });
    const report = finished(await open(repos, fake, sha, "--label", "nope", "--body-file", body));
    expect(report.created).toBe(true);
    expect(report.problems[0]).toContain("adding the labels nope failed");
  });
});

describe("open: draft or ready is set by the policy", () => {
  test("a gh that makes a draft by default is marked ready when the policy says ready", async () => {
    const { repos, fake, sha, body } = await setup({ policy: "schema = 1\n[draft]\ncreate_as_draft = false\n", alwaysDraft: true });
    const report = finished(await open(repos, fake, sha, "--body-file", body));
    expect(report.problems).toEqual([]);
    expect(fake.world.created[0]?.args).not.toContain("--draft");
    expect(fake.world.mutations).toEqual([{ kind: "markPullRequestReadyForReview", pullRequestId: "PR_node_101" }]);
    expect(report.pr?.isDraft).toBe(false);
  });

  test("a failed ready mutation is a problem", async () => {
    const { repos, fake, sha, body } = await setup({ policy: "schema = 1\n[draft]\ncreate_as_draft = false\n", alwaysDraft: true, readyFails: true });
    const report = finished(await open(repos, fake, sha, "--body-file", body));
    expect(report.problems[0]).toContain("marking it ready failed");
  });

  test("a PR that is not a draft when the policy says draft is a problem", async () => {
    const { repos, fake, sha, body } = await setup({ neverDraft: true });
    const report = finished(await open(repos, fake, sha, "--body-file", body));
    expect(report.problems[0]).toContain("draft.create_as_draft is true");
  });
});

describe("open: failure and retry", () => {
  test("a create that fails with no PR leaves the pushed branch and says so", async () => {
    const { repos, fake, sha, body } = await setup({ createFails: "before" });
    const report = finished(await open(repos, fake, sha, "--body-file", body));
    expect(report.pushed).toBe(true);
    expect(report.pr).toBeNull();
    expect(report.problems.join(" ")).toContain("HTTP 502");
    expect(report.problems.join(" ")).toContain("the branch is pushed and no PR exists");
    // A second run reuses the pushed branch and creates the PR.
    fake.world.createFails = "no";
    const retry = finished(await open(repos, fake, sha, "--body-file", body));
    expect(retry.problems).toEqual([]);
    expect(retry.pushed).toBe(false);
    expect(fake.world.prs).toHaveLength(1);
  });

  test("a lost reply does not create a second PR", async () => {
    const { repos, fake, sha, body } = await setup({ createFails: "after" });
    const report = finished(await open(repos, fake, sha, "--body-file", body));
    expect(fake.world.prs).toHaveLength(1);
    expect(report.pr?.number).toBe(101);
    expect(report.notes.join(" ")).toContain("not created twice");
    expect(report.problems[0]).toContain("gh pr create failed");
  });

  test("a second run on an open PR creates nothing", async () => {
    const { repos, fake, sha, body } = await setup();
    finished(await open(repos, fake, sha, "--body-file", body));
    const again = finished(await open(repos, fake, sha, "--body-file", body));
    expect(again.created).toBe(false);
    expect(again.pushed).toBe(false);
    expect(again.problems).toEqual([]);
    expect(fake.world.created).toHaveLength(1);
  });

  test("a push that the remote rejects writes nothing", async () => {
    const { repos, fake, sha, body } = await setup();
    // The remote branch appears with other commits between the plan and the push.
    const other = await repos.otherClone();
    await repos.git(["checkout", "-b", "feat/topic"], other);
    await repos.commit("z.txt", "z\n", "feat: other", { cwd: other });
    const config = configFor(repos, fake);
    const racing = {
      ...config,
      runGit: async (args: readonly string[]) => {
        if (args[0] === "push") {
          await repos.git(["push", "origin", "feat/topic"], other);
        }
        return config.runGit(args);
      },
    };
    const result = await openPr(argsFor("open", "--expect-head", sha, "--body-file", body), racing);
    expect(result.kind).toBe("refused");
    expect(result.kind === "refused" ? result.reasons[0] : "").toContain("git push failed, nothing was pushed");
    expect(fake.world.created).toEqual([]);
    expect(await repos.remoteRef("feat/topic")).not.toBe(sha);
  });
});

describe("open: refusals write nothing", () => {
  test("a head that is not the planned head", async () => {
    const { repos, fake, sha, body } = await setup();
    await repos.commit("b.txt", "b\n", "feat: add b");
    const result = await open(repos, fake, sha, "--body-file", body, "--title", "feat: both");
    expect(result.kind).toBe("refused");
    expect(result.kind === "refused" ? result.reasons[0] : "").toContain("the head changed since plan");
    expect(await repos.remoteRef("feat/topic")).toBeNull();
    expect(fake.world.created).toEqual([]);
  });

  test("the head moves while open runs", async () => {
    const { repos, fake, sha, body } = await setup({ policy: 'schema = 1\n[[prepush]]\nname = "slow"\nrun = ["true"]\n' });
    const config = configFor(repos, fake);
    const racing = {
      ...config,
      runCommand: async (argv: readonly string[], cwd: string) => {
        await repos.commit("late.txt", "x\n", "feat: late");
        return config.runCommand(argv, cwd);
      },
    };
    const result = await openPr(argsFor("open", "--expect-head", sha, "--body-file", body), racing);
    expect(result.kind).toBe("refused");
    expect(result.kind === "refused" ? result.reasons[0] : "").toContain("changed while open ran");
    expect(await repos.remoteRef("feat/topic")).toBeNull();
  });

  test("a blocker in the plan", async () => {
    const { repos, fake, sha, body } = await setup();
    writeFileSync(join(repos.work, "a.txt"), "dirty\n");
    const result = await open(repos, fake, sha, "--body-file", body);
    expect(result.kind).toBe("refused");
    expect(result.kind === "refused" ? result.reasons.join(" ") : "").toContain("dirty_tree");
    expect(await repos.remoteRef("feat/topic")).toBeNull();
  });

  test("a new PR without a body file", async () => {
    const { repos, fake, sha } = await setup();
    const result = await open(repos, fake, sha);
    expect(result.kind).toBe("refused");
    expect(result.kind === "refused" ? result.reasons[0] : "").toContain("valid --body-file");
    expect(await repos.remoteRef("feat/topic")).toBeNull();
  });

  test("an invalid policy stops with the policy error", async () => {
    const { repos, fake, sha, body } = await setup({ policy: "schema = 2\n" });
    expect((await open(repos, fake, sha, "--body-file", body)).kind).toBe("policy-error");
  });
});

describe("open: an existing PR", () => {
  async function withPr(): Promise<{ repos: Repos; fake: FakeWorld; sha: string }> {
    const { repos, fake, sha, body } = await setup();
    finished(await open(repos, fake, sha, "--body-file", body));
    return { repos, fake, sha };
  }

  test("new commits are pushed to the same PR and no second PR is created", async () => {
    const { repos, fake } = await withPr();
    const next = await repos.commit("b.txt", "b\n", "feat: add b");
    const report = finished(await open(repos, fake, next));
    expect(report.pushed).toBe(true);
    expect(report.created).toBe(false);
    expect(report.pr?.number).toBe(101);
    expect(await repos.remoteRef("feat/topic")).toBe(next);
    expect(fake.world.created).toHaveLength(1);
  });
});

describe("the command line", () => {
  test("plan prints the head and the next line; open prints the PR url", async () => {
    const { repos, fake, sha, body } = await setup();
    const plan = await runCli(["plan", "--body-file", body], repos, fake);
    expect(plan.code).toBe(0);
    expect(plan.out).toContain(`head: ${sha}`);
    expect(plan.out).toContain("body: valid");
    expect(plan.out).toContain(`next: Run open --expect-head ${sha}`);
    const done = await runCli(["open", "--expect-head", sha, "--body-file", body], repos, fake);
    expect(done.code).toBe(0);
    expect(done.out).toContain("PR #101 opened (draft) https://example.invalid/example-org/example-repo/pull/101");
  });

  test("--json prints schema 1", async () => {
    const { repos, fake, sha, body } = await setup();
    const plan = JSON.parse((await runCli(["plan", "--json"], repos, fake)).out);
    expect(plan.schema).toBe(1);
    expect(plan.head).toBe(sha);
    expect(plan.exit).toBe(0);
    const opened = JSON.parse((await runCli(["open", "--json", "--expect-head", sha, "--body-file", body], repos, fake)).out);
    expect(opened.created).toBe(true);
    expect(opened.pr.number).toBe(101);
  });

  test("plan with a blocker exits 20, with a refusal exits 3, and a policy error exits 2", async () => {
    const { repos, fake } = await setup();
    writeFileSync(join(repos.work, "a.txt"), "dirty\n");
    expect((await runCli(["plan"], repos, fake)).code).toBe(20);
    await repos.git(["checkout", "--", "a.txt"]);
    fake.world.prs.push({ number: 9, id: "PR_9", title: "t", headRef: "feat/topic", headSha: "1".repeat(40), baseRef: "main", isDraft: true, isCrossRepository: false, author: "someone-else", labels: [], body: "" });
    expect((await runCli(["plan"], repos, fake)).code).toBe(3);
    fake.world.policy = "schema = 9\n";
    const bad = await runCli(["plan"], repos, fake);
    expect(bad.code).toBe(2);
    expect(bad.err).toContain("invalid policy");
  });

  test("a refused open prints the reasons on stderr and exits 3", async () => {
    const { repos, fake, sha } = await setup();
    const result = await runCli(["open", "--expect-head", sha], repos, fake);
    expect(result.code).toBe(3);
    expect(result.err).toContain("REFUSED, nothing was written");
  });

  test("an open with a problem after a write exits 20", async () => {
    const { repos, fake, sha, body } = await setup({ createFails: "before" });
    const result = await runCli(["open", "--expect-head", sha, "--body-file", body], repos, fake);
    expect(result.code).toBe(20);
    expect(result.out).toContain("PROBLEM:");
  });

  test("a crash exits 1 with one line", async () => {
    const { repos, fake } = await setup();
    const { runMain } = await import("../lib/create/cli.ts");
    const lines: string[] = [];
    const code = await runMain(["plan"], { cwd: repos.work, runGh: () => { throw new Error("boom"); }, err: (l) => lines.push(l), out: () => undefined });
    expect(code).toBe(1);
    expect(lines).toEqual(["create.ts failed: boom"]);
    void fake;
  });
});

describe("open: other branches and bases", () => {
  test("--branch pushes HEAD under another name and creates the PR for that head", async () => {
    const repos = await makeRepos();
    made.push(repos);
    await repos.git(["checkout", "-b", "my-work"]);
    const sha = await repos.commit("a.txt", "a\n", "feat: add a");
    const fake = fakeWorld(repos, newWorld());
    const body = writeTemp(repos, "body.md", GOOD_BODY);
    const report = finished(await open(repos, fake, sha, "--branch", "feat/topic", "--body-file", body));
    expect(report.problems).toEqual([]);
    expect(await repos.remoteRef("feat/topic")).toBe(sha);
    expect(await repos.remoteRef("my-work")).toBeNull();
    expect(fake.world.created[0]?.args).toContain("feat/topic");
  });

  test("a stacked branch is created against the parent branch", async () => {
    const repos = await makeRepos();
    made.push(repos);
    await repos.git(["checkout", "-b", "parent"]);
    const parentSha = await repos.commit("p.txt", "p\n", "feat: parent");
    await repos.git(["push", "origin", "parent"]);
    await repos.git(["checkout", "-b", "feat/topic"]);
    const sha = await repos.commit("c.txt", "c\n", "feat: child");
    const fake = fakeWorld(repos, newWorld());
    fake.world.prs.push({ number: 5, id: "PR_5", title: "parent", headRef: "parent", headSha: parentSha, baseRef: "main", isDraft: true, isCrossRepository: false, author: "dev-a", labels: [], body: "" });
    const body = writeTemp(repos, "body.md", GOOD_BODY);
    const report = finished(await open(repos, fake, sha, "--body-file", body));
    expect(report.problems).toEqual([]);
    expect(fake.world.created[0]?.args.slice(fake.world.created[0].args.indexOf("--base"), fake.world.created[0].args.indexOf("--base") + 2)).toEqual(["--base", "parent"]);
  });
});

describe("open: labels on an open PR", () => {
  test("--run-ci adds the label to the PR that already exists, and a stale head is noted", async () => {
    const { repos, fake, sha, body } = await setup({ policy: 'schema = 1\n[labels]\npr_ci = "label"\nrun_once = "ci:run"\n' });
    finished(await open(repos, fake, sha, "--body-file", body));
    const next = await repos.commit("b.txt", "b\n", "feat: add b");
    const report = finished(await open(repos, fake, next, "--run-ci"));
    expect(report.created).toBe(false);
    expect(report.labelsAdded).toEqual(["ci:run"]);
    expect(fake.world.edits.at(-1)).toEqual(["pr", "edit", "101", "--repo", "example-org/example-repo", "--add-label", "ci:run"]);
    expect(report.notes.join(" ")).toContain("GitHub still shows the older head");
    expect(fake.world.created).toHaveLength(1);
  });
});
