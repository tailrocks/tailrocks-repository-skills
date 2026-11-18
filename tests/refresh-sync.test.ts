import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "../lib/refresh/cli.ts";
import {
  BUN,
  fakeGithub,
  policyToml,
  regenerateSection,
  REPO,
  sandbox,
  testDeps,
  worktreeLeftovers,
  type FakeOptions,
  type Sandbox,
} from "./helpers/refresh-env.ts";

const made: Sandbox[] = [];
afterEach(() => {
  for (const sb of made.splice(0)) {
    sb.cleanup();
  }
});

function box(): Sandbox {
  const sb = sandbox();
  made.push(sb);
  return sb;
}

interface Run {
  readonly code: number;
  readonly gitCalls: string[][];
  readonly gh: ReturnType<typeof fakeGithub>;
  readonly json: { code: string; state: string; headline: string; details: string[]; next: string; data: Record<string, unknown> };
}

async function sync(
  sb: Sandbox,
  options: FakeOptions,
  flags: readonly string[] = [],
  extra: Parameters<typeof testDeps>[2] = {},
): Promise<Run> {
  const gh = fakeGithub(sb, options);
  const { deps, gitCalls } = testDeps(sb, gh, extra);
  const lines: string[] = [];
  const code = await main(["sync", "7", "--repo", REPO, "--json", ...flags], {
    cwd: sb.clone,
    deps,
    out: (l) => lines.push(l),
    err: (l) => lines.push(l),
  });
  const text = lines.join("\n");
  if (process.env["DBG"] !== undefined) {
    console.log(text);
  }
  return { code, gitCalls, gh, json: JSON.parse(text) };
}

const pushes = (run: Run): number => run.gitCalls.filter((a) => a[0] === "push").length;

/** One signed commit on feat/topic, pushed. */
function topic(sb: Sandbox, files: Record<string, string | null> = { "a.txt": "one\n" }): string {
  const sha = sb.commit(files, "feat: one");
  sb.git(["push", "origin", "feat/topic"]);
  return sha;
}

/** A commit on main by someone else. */
function advanceBase(sb: Sandbox, files: Record<string, string | null> = { "docs/base.md": "base\n" }): string {
  const other = sb.other();
  const sha = sb.commit(files, "chore: base moves", { cwd: other });
  sb.git(["push", "origin", "main"], other);
  return sha;
}

const firstParents = (sb: Sandbox, sha: string): string[] => sb.git(["rev-list", "--parents", "-n", "1", sha], sb.remote).trim().split(" ").slice(1);
const show = (sb: Sandbox, rev: string, path: string): string => sb.git(["show", `${rev}:${path}`], sb.remote);

describe("sync", () => {
  test("a clean merge pushes once and needs no new review", async () => {
    const sb = box();
    const oldHead = topic(sb);
    const baseTip = advanceBase(sb);
    const userHead = sb.git(["rev-parse", "HEAD"]).trim();
    const run = await sync(sb, { policy: policyToml(regenerateSection()) });
    expect(run.code).toBe(0);
    expect(pushes(run)).toBe(1);
    const head = sb.remoteRev("refs/heads/feat/topic");
    expect(firstParents(sb, head)).toEqual([oldHead, baseTip]);
    expect(sb.git(["log", "-1", "--format=%B", head], sb.remote)).toContain("Signed-off-by: Dev A <dev-a@example.com>");
    expect(run.json.data["cleanMerge"]).toBe(true);
    expect(run.json.data["reReview"]).toBe("not-needed");
    expect(run.gh.mutations).toEqual([]);
    // The push targets exactly the new SHA on the PR branch.
    expect(run.gitCalls.find((a) => a[0] === "push")).toEqual(["push", "origin", `${head}:refs/heads/feat/topic`]);
    // The user's checkout is untouched and the temporary worktree is gone.
    expect(sb.git(["rev-parse", "HEAD"]).trim()).toBe(userHead);
    expect(sb.git(["status", "--porcelain"]).trim()).toBe("");
    expect(worktreeLeftovers(sb).entries).toEqual([]);
    expect(worktreeLeftovers(sb).list.split("\n").filter((l) => l.startsWith("worktree ")).length).toBe(1);
  });

  test("an up-to-date branch is left alone", async () => {
    const sb = box();
    advanceBase(sb);
    sb.git(["fetch", "origin", "main"]);
    sb.git(["merge", "--ff-only", "origin/main"]);
    const head = topic(sb);
    const run = await sync(sb, { policy: policyToml() });
    expect(run.code).toBe(0);
    expect(pushes(run)).toBe(0);
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(head as never);
  });

  test("--fresh-ci adds one empty signed commit when the branch is up to date", async () => {
    const sb = box();
    const head = topic(sb);
    const run = await sync(sb, { policy: policyToml() }, ["--fresh-ci"]);
    expect(run.code).toBe(0);
    expect(pushes(run)).toBe(1);
    const next = sb.remoteRev("refs/heads/feat/topic");
    expect(firstParents(sb, next)).toEqual([head]);
    expect(sb.git(["rev-parse", `${next}^{tree}`], sb.remote)).toBe(sb.git(["rev-parse", `${head}^{tree}`], sb.remote));
    const message = sb.git(["log", "-1", "--format=%B", next], sb.remote);
    expect(message).toContain("Start a fresh CI run");
    expect(message).toContain("Signed-off-by:");
    expect(run.gh.mutations).toEqual([]);
  });

  test("a conflict only in regenerate outputs is regenerated and pushed", async () => {
    const sb = box();
    const inputs = (extra: string, top = false): string => (top ? `${extra}\n` : "") + "a1\na2\na3\na4\na5\na6\na7\na8\na9\n" + (top ? "" : `${extra}\n`);
    sb.commit({ "gen/inputs.txt": inputs("branch"), "out/generated.txt": "A1,A2,A3,A4,A5,A6,A7,A8,A9,BRANCH (10)\n" }, "feat: branch input");
    sb.git(["push", "origin", "feat/topic"]);
    const oldHead = sb.remoteRev("refs/heads/feat/topic");
    const baseTip = advanceBase(sb, { "gen/inputs.txt": inputs("base", true), "out/generated.txt": "BASE,A1,A2,A3,A4,A5,A6,A7,A8,A9 (10)\n" });
    const policy = policyToml('[review]', 'rerequest = { comment = "Please review the new head.", reviewers = [] }', regenerateSection());
    const run = await sync(sb, { policy });
    expect(run.code).toBe(0);
    expect(pushes(run)).toBe(1);
    const head = sb.remoteRev("refs/heads/feat/topic");
    expect(firstParents(sb, head)).toEqual([oldHead, baseTip]);
    expect(show(sb, head, "out/generated.txt")).toBe("BASE,A1,A2,A3,A4,A5,A6,A7,A8,A9,BRANCH (11)\n");
    expect(show(sb, head, "gen/inputs.txt")).toBe(`base\n${"a1\na2\na3\na4\na5\na6\na7\na8\na9\n"}branch\n`);
    expect(sb.git(["log", "-1", "--format=%B", head], sb.remote)).toContain("Signed-off-by:");
    expect(run.json.data["cleanMerge"]).toBe(false);
    expect(run.json.data["reReview"]).toBe("requested");
    expect(run.gh.mutations).toEqual([{ kind: "issue-comment", repo: REPO, number: 7, body: "Please review the new head." }]);
  });

  test("a conflicted merge asks the policy reviewers for a new review", async () => {
    const sb = box();
    sb.commit({ "README.md": "# branch\n" }, "feat: edit readme");
    sb.git(["push", "origin", "feat/topic"]);
    advanceBase(sb, { "gen/inputs.txt": "base\na1\na2\na3\na4\na5\na6\na7\na8\na9\n", "out/generated.txt": "BASE\n" });
    // A merge that needs a regenerate commit is not clean, so the review request goes out.
    const policy = policyToml('[review]', 'rerequest = { comment = "", reviewers = ["reviewer-a", "bad[bot]"] }', regenerateSection());
    const run = await sync(sb, { policy, rest: { "users/reviewer-a": "U_node_1" } });
    expect(run.code).toBe(0);
    expect(run.gh.mutations).toEqual([{ kind: "requestReviews", pullRequestId: "PR_node_1", userIds: ["U_node_1"] }]);
    expect(run.json.details.join("\n")).toContain('cannot request a review from "bad[bot]"');
    expect(run.json.data["reReview"]).toBe("requested");
  });

  test("a failing generator aborts the merge and pushes nothing", async () => {
    const sb = box();
    sb.commit({ "out/generated.txt": "BRANCH\n" }, "feat: branch output");
    sb.git(["push", "origin", "feat/topic"]);
    const before = sb.remoteRev("refs/heads/feat/topic");
    advanceBase(sb, { "out/generated.txt": "BASE\n" });
    const failing = ["[[regenerate]]", 'name = "gen"', `run = [${JSON.stringify(BUN)}, "-e", "process.exit(1)"]`, 'outputs = ["out/**"]'].join("\n");
    const run = await sync(sb, { policy: policyToml(failing) });
    expect(run.code).toBe(20);
    expect(run.json.code).toBe("regenerate_failed");
    expect(pushes(run)).toBe(0);
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(before);
    expect(worktreeLeftovers(sb).entries).toEqual([]);
  });

  test("any other conflict aborts the merge, pushes nothing, and lists the paths", async () => {
    const sb = box();
    sb.commit({ "README.md": "# branch\n", "out/generated.txt": "BRANCH\n" }, "feat: edit readme");
    sb.git(["push", "origin", "feat/topic"]);
    const before = sb.remoteRev("refs/heads/feat/topic");
    advanceBase(sb, { "README.md": "# base\n", "out/generated.txt": "BASE\n" });
    const run = await sync(sb, { policy: policyToml(regenerateSection()) });
    expect(run.code).toBe(20);
    expect(run.json.state).toBe("BLOCKED");
    expect(run.json.code).toBe("conflict");
    expect(run.json.next).toBe("resolve keeping both sides; never hand-merge generated files");
    expect(run.json.data["conflicts"]).toEqual(["README.md", "out/generated.txt"]);
    expect(run.json.details).toContain("conflict: README.md");
    expect(run.json.details).toContain("generated: out/generated.txt");
    expect(pushes(run)).toBe(0);
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(before);
    expect(worktreeLeftovers(sb).entries).toEqual([]);
  });

  test("regenerates when inputs changed without a conflict, in a separate signed commit", async () => {
    const sb = box();
    topic(sb);
    advanceBase(sb, { "gen/inputs.txt": "base\na1\na2\na3\na4\na5\na6\na7\na8\na9\n" });
    const run = await sync(sb, { policy: policyToml(regenerateSection()) });
    expect(run.code).toBe(0);
    const head = sb.remoteRev("refs/heads/feat/topic");
    expect(show(sb, head, "out/generated.txt")).toBe("BASE,A1,A2,A3,A4,A5,A6,A7,A8,A9 (10)\n");
    expect(sb.git(["log", "-1", "--format=%B", head], sb.remote)).toContain("Regenerate gen outputs");
    expect(run.json.data["cleanMerge"]).toBe(false);
  });

  test("a failing pre-push step pushes nothing", async () => {
    const sb = box();
    const before = topic(sb);
    advanceBase(sb);
    const step = ["[[prepush]]", 'name = "check"', `run = [${JSON.stringify(BUN)}, "-e", "console.error('bad format'); process.exit(3)"]`].join("\n");
    const run = await sync(sb, { policy: policyToml(step) });
    expect(run.code).toBe(20);
    expect(run.json.code).toBe("prepush_failed");
    expect(run.json.details.join("\n")).toContain("bad format");
    expect(pushes(run)).toBe(0);
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(before as never);
  });

  test("a pre-push step that does not match the changed files is skipped", async () => {
    const sb = box();
    topic(sb);
    advanceBase(sb);
    const step = ["[[prepush]]", 'name = "check"', `run = [${JSON.stringify(BUN)}, "-e", "process.exit(3)"]`, 'when_changed = ["**/*.rs"]'].join("\n");
    const run = await sync(sb, { policy: policyToml(step) });
    expect(run.code).toBe(0);
    expect(pushes(run)).toBe(1);
  });

  const INVENTORY = [
    "[[inventories]]",
    'name = "sources"',
    'file = "docs/inventory.txt"',
    'added = ["src/**"]',
    "group_depth = 2",
  ].join("\n");

  test("an inventory miss pushes nothing", async () => {
    const sb = box();
    sb.commit({ "docs/inventory.txt": "src/a/one.txt\n", "src/a/one.txt": "1\n" }, "chore: inventory");
    sb.git(["push", "origin", "HEAD:main"]);
    const before = sb.commit({ "src/a/two.txt": "2\n" }, "feat: add two");
    sb.git(["push", "origin", "feat/topic"]);
    advanceBase(sb);
    const run = await sync(sb, { policy: policyToml(INVENTORY) });
    expect(run.code).toBe(20);
    expect(run.json.code).toBe("inventory_miss");
    expect(run.json.details.join("\n")).toContain("src/a/two.txt");
    expect(pushes(run)).toBe(0);
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(before as never);
  });

  test("an inventory that names the file, or a new group, passes", async () => {
    const sb = box();
    sb.commit({ "docs/inventory.txt": "src/a/one.txt\n", "src/a/one.txt": "1\n" }, "chore: inventory");
    sb.git(["push", "origin", "HEAD:main"]);
    sb.commit({ "src/a/two.txt": "2\n", "src/b/new.txt": "n\n", "docs/inventory.txt": "src/a/one.txt\nsrc/a/two.txt\n" }, "feat: add files");
    sb.git(["push", "origin", "feat/topic"]);
    advanceBase(sb);
    const run = await sync(sb, { policy: policyToml(INVENTORY) });
    expect(run.code).toBe(0);
    expect(pushes(run)).toBe(1);
  });

  test("an unsigned commit blocks the sync and points to dco-fix", async () => {
    const sb = box();
    const before = sb.commit({ "a.txt": "one\n" }, "feat: unsigned", { signoff: false });
    sb.git(["push", "origin", "feat/topic"]);
    advanceBase(sb);
    const run = await sync(sb, { policy: policyToml() });
    expect(run.code).toBe(20);
    expect(run.json.code).toBe("dco_missing");
    expect(run.json.next).toContain("dco-fix");
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(before as never);
  });

  test("the PR head moving before the push stops the run", async () => {
    const sb = box();
    topic(sb);
    advanceBase(sb);
    const other = sb.other();
    sb.git(["checkout", "-b", "feat/topic", "origin/feat/topic"], other);
    let raced = "";
    const run = await sync(sb, { policy: policyToml() }, [], {
      beforePush: async () => {
        raced = sb.commit({ "z.txt": "z\n" }, "feat: raced", { cwd: other });
        sb.git(["push", "origin", "feat/topic"], other);
      },
    });
    expect(run.code).toBe(20);
    expect(run.json.code).toBe("head_moved");
    expect(pushes(run)).toBe(0);
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(raced as never);
  });

  test("a remote that moved after the PR was read stops the run before any work", async () => {
    const sb = box();
    const old = topic(sb);
    advanceBase(sb);
    const other = sb.other();
    sb.git(["checkout", "-b", "feat/topic", "origin/feat/topic"], other);
    const raced = sb.commit({ "z.txt": "z\n" }, "feat: raced", { cwd: other });
    sb.git(["push", "origin", "feat/topic"], other);
    const run = await sync(sb, { policy: policyToml(), state: { pinnedHead: old } });
    expect(run.json.code).toBe("head_moved");
    expect(pushes(run)).toBe(0);
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(raced as never);
  });

  test("a plain push cannot overwrite work that arrived after the checks", async () => {
    const sb = box();
    topic(sb);
    advanceBase(sb);
    const other = sb.other();
    sb.git(["checkout", "-b", "feat/topic", "origin/feat/topic"], other);
    let raced = "";
    // The race happens after the re-read, inside the push call. A plain push must reject it.
    const run = await sync(sb, { policy: policyToml() }, [], {
      git: (args, options) => {
        if (args[0] === "push") {
          raced = sb.commit({ "z.txt": "z\n" }, "feat: raced", { cwd: other });
          sb.git(["push", "origin", "feat/topic"], other);
        }
        return import("../lib/git.ts").then((m) => m.git(args, options));
      },
    });
    expect(run.code).toBe(20);
    expect(run.json.code).toBe("push_rejected");
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(raced as never);
  });

  test("repository hooks do not run", async () => {
    const sb = box();
    topic(sb);
    advanceBase(sb);
    for (const name of ["pre-push", "pre-merge-commit", "commit-msg"]) {
      const file = join(sb.clone, ".git", "hooks", name);
      writeFileSync(file, "#!/bin/sh\nexit 1\n");
      chmodSync(file, 0o755);
    }
    const run = await sync(sb, { policy: policyToml() });
    expect(run.code).toBe(0);
    expect(pushes(run)).toBe(1);
  });

  test("--run-ci adds the run-once label only for label-triggered CI", async () => {
    const sb = box();
    topic(sb);
    advanceBase(sb);
    const policy = policyToml("[labels]", 'pr_ci = "label"', 'run_once = "ci:run"');
    const withFlag = await sync(sb, { policy }, ["--run-ci"]);
    expect(withFlag.code).toBe(0);
    expect(withFlag.gh.edits.map((e) => e.slice(0, 7))).toEqual([["pr", "edit", "7", "--repo", REPO, "--add-label", "ci:run"]]);

    const sb2 = box();
    topic(sb2);
    advanceBase(sb2);
    const without = await sync(sb2, { policy });
    expect(without.gh.edits).toEqual([]);
    const sb3 = box();
    topic(sb3);
    advanceBase(sb3);
    const always = await sync(sb3, { policy: policyToml() }, ["--run-ci"]);
    expect(always.gh.edits).toEqual([]);
  });
});

describe("sync refusals", () => {
  test.each([
    ["a fork", { isCrossRepository: true }, "cross_repository"],
    ["another author", { author: "someone-else" }, "not_owner"],
    ["a queued PR", { queued: true }, "queued"],
    ["a closed PR", { state: "CLOSED" as const }, "pr_not_open"],
  ])("refuses %s", async (_name, state, code) => {
    const sb = box();
    const before = topic(sb);
    advanceBase(sb);
    const run = await sync(sb, { policy: policyToml(), state });
    expect(run.code).toBe(20);
    expect(run.json.code).toBe(code);
    expect(pushes(run)).toBe(0);
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(before as never);
    expect(run.gitCalls.some((a) => a[0] === "worktree")).toBe(false);
  });

  test("refuses a protected branch", async () => {
    const sb = box();
    sb.git(["checkout", "-b", "release/1"]);
    sb.commit({ "a.txt": "one\n" }, "feat: one");
    sb.git(["push", "origin", "release/1"]);
    advanceBase(sb);
    const run = await sync(sb, { policy: policyToml("[branches]", 'protected = ["main", "release/*"]'), state: { headRef: "release/1" } });
    expect(run.json.code).toBe("protected_branch");
    expect(pushes(run)).toBe(0);
  });
});
