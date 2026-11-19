import { afterEach, describe, expect, test, setDefaultTimeout } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
  type FakeGithub,
  type FakeOptions,
  type Sandbox,
} from "./helpers/refresh-env.ts";

// Each test makes several git repositories; give it room.
setDefaultTimeout(60_000);

const made: Sandbox[] = [];
const extra: string[] = [];
afterEach(() => {
  for (const sb of made.splice(0)) {
    sb.cleanup();
  }
  for (const dir of extra.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function box(): Sandbox {
  const sb = sandbox();
  made.push(sb);
  return sb;
}

interface Json {
  code: string;
  state: string;
  headline: string;
  details: string[];
  next: string;
  data: Record<string, unknown>;
}

async function cli(sb: Sandbox, gh: FakeGithub, argv: readonly string[], overrides: Parameters<typeof testDeps>[2] = {}) {
  const { deps, gitCalls } = testDeps(sb, gh, overrides);
  const lines: string[] = [];
  const code = await main([...argv, "--repo", REPO, "--json"], { cwd: sb.clone, deps, out: (l) => lines.push(l), err: (l) => lines.push(l) });
  const text = lines.join("\n");
  return { code, gitCalls, json: JSON.parse(text) as Json };
}

const pushes = (calls: string[][]): number => calls.filter((a) => a[0] === "push").length;

/** README conflicts (by hand) and out/generated.txt conflicts (regenerable). */
function conflictSetup(sb: Sandbox): { readonly oldHead: string; readonly baseTip: string } {
  sb.commit({ "README.md": "# branch\n", "out/generated.txt": "BRANCH\n" }, "feat: edit readme");
  sb.git(["push", "origin", "feat/topic"]);
  const oldHead = sb.remoteRev("refs/heads/feat/topic");
  const other = sb.other();
  const baseTip = sb.commit({ "README.md": "# base\n", "out/generated.txt": "BASE\n" }, "chore: base moves", { cwd: other });
  sb.git(["push", "origin", "main"], other);
  return { oldHead, baseTip };
}

const POLICY = policyToml(regenerateSection());

async function keep(sb: Sandbox, options: FakeOptions = { policy: POLICY }) {
  const gh = fakeGithub(sb, options);
  const run = await cli(sb, gh, ["sync", "7", "--keep-worktree"]);
  return { gh, run, path: String(run.json.data["worktree"] ?? "") };
}

const merging = (path: string): boolean => Bun.spawnSync(["git", "rev-parse", "-q", "--verify", "MERGE_HEAD"], { cwd: path }).exitCode === 0;

describe("sync --keep-worktree", () => {
  test("stops on a conflict that the policy cannot regenerate and keeps the merge in progress", async () => {
    const sb = box();
    const { oldHead } = conflictSetup(sb);
    const userHead = sb.git(["rev-parse", "HEAD"]).trim();
    const { run, path } = await keep(sb);
    expect(run.code).toBe(20);
    expect(run.json.code).toBe("conflict");
    expect(run.json.data["resolveByHand"]).toEqual(["README.md"]);
    expect(run.json.data["regenerable"]).toEqual(["out/generated.txt"]);
    expect(path).toContain("pr-refresh-");
    expect(run.json.next).toContain(`continue 7 --worktree ${path}`);
    expect(existsSync(path)).toBe(true);
    expect(merging(path)).toBe(true);
    expect(readFileSync(join(path, "README.md"), "utf8")).toContain("<<<<<<<");
    expect(pushes(run.gitCalls)).toBe(0);
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(oldHead as never);
    expect(sb.git(["rev-parse", "HEAD"]).trim()).toBe(userHead);
    expect(sb.git(["status", "--porcelain"]).trim()).toBe("");
  });

  test("without the flag the merge is aborted and the worktree is gone", async () => {
    const sb = box();
    conflictSetup(sb);
    const gh = fakeGithub(sb, { policy: POLICY });
    const run = await cli(sb, gh, ["sync", "7"]);
    expect(run.json.code).toBe("conflict");
    expect(run.json.data["worktree"]).toBeUndefined();
    expect(worktreeLeftovers(sb).entries).toEqual([]);
  });

  test("a regenerable-only conflict does not keep anything", async () => {
    const sb = box();
    sb.commit({ "out/generated.txt": "BRANCH\n" }, "feat: output");
    sb.git(["push", "origin", "feat/topic"]);
    const other = sb.other();
    sb.commit({ "out/generated.txt": "BASE\n" }, "chore: base", { cwd: other });
    sb.git(["push", "origin", "main"], other);
    const gh = fakeGithub(sb, { policy: POLICY });
    const run = await cli(sb, gh, ["sync", "7", "--keep-worktree"]);
    expect(run.code).toBe(0);
    expect(worktreeLeftovers(sb).entries).toEqual([]);
  });
});

describe("continue", () => {
  test("finishes the merge after the agent resolved the files, pushes once, asks for a review, and cleans up", async () => {
    const sb = box();
    const { oldHead, baseTip } = conflictSetup(sb);
    const { gh, path } = await keep(sb);
    writeFileSync(join(path, "README.md"), "# both\n");
    const run = await cli(sb, gh, ["continue", "7", "--worktree", path]);
    expect(run.json.state).toBe("DONE");
    expect(run.code).toBe(0);
    expect(pushes(run.gitCalls)).toBe(1);
    const head = sb.remoteRev("refs/heads/feat/topic");
    expect(sb.git(["rev-list", "--parents", "-n", "1", head], sb.remote).trim().split(" ").slice(1)).toEqual([oldHead, baseTip]);
    expect(sb.git(["show", `${head}:README.md`], sb.remote)).toBe("# both\n");
    // The generated output was regenerated, not merged by hand.
    expect(sb.git(["show", `${head}:out/generated.txt`], sb.remote)).toBe("A1,A2,A3,A4,A5,A6,A7,A8,A9 (9)\n");
    expect(sb.git(["log", "-1", "--format=%B", head], sb.remote)).toContain("Signed-off-by:");
    expect(run.json.data["cleanMerge"]).toBe(false);
    expect(gh.comments).toHaveLength(1);
    expect(gh.comments[0]).toContain(`New head ${head} needs a review:`);
    expect(run.json.details.join("\n")).toContain("policy review.rerequest is empty");
    expect(existsSync(path)).toBe(false);
    expect(worktreeLeftovers(sb).entries).toEqual([]);
    expect(worktreeLeftovers(sb).list.split("\n").filter((l) => l.startsWith("worktree ")).length).toBe(1);
  });

  test("refuses leftover conflict markers, keeps the worktree, and works after the fix", async () => {
    const sb = box();
    const { oldHead } = conflictSetup(sb);
    const { gh, path } = await keep(sb);
    const refused = await cli(sb, gh, ["continue", "7", "--worktree", path]);
    expect(refused.code).toBe(20);
    expect(refused.json.code).toBe("conflict_markers");
    expect(refused.json.details).toContain("markers: README.md");
    expect(pushes(refused.gitCalls)).toBe(0);
    expect(existsSync(path)).toBe(true);
    expect(merging(path)).toBe(true);
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(oldHead as never);
    writeFileSync(join(path, "README.md"), "# fixed\n");
    const ok = await cli(sb, gh, ["continue", "7", "--worktree", path]);
    expect(ok.code).toBe(0);
  });

  test("refuses edits outside the conflict set", async () => {
    const sb = box();
    conflictSetup(sb);
    const { gh, path } = await keep(sb);
    writeFileSync(join(path, "README.md"), "# fixed\n");
    writeFileSync(join(path, "gen", "inputs.txt"), "sneaky\n");
    const run = await cli(sb, gh, ["continue", "7", "--worktree", path]);
    expect(run.json.code).toBe("continue_outside_edit");
    expect(run.json.details).toContain("outside: gen/inputs.txt");
    expect(pushes(run.gitCalls)).toBe(0);
    expect(existsSync(path)).toBe(true);
  });

  test("refuses when the merge was committed by hand", async () => {
    const sb = box();
    conflictSetup(sb);
    const { gh, path } = await keep(sb);
    writeFileSync(join(path, "README.md"), "# fixed\n");
    writeFileSync(join(path, "out", "generated.txt"), "x\n");
    Bun.spawnSync(["git", "add", "-A"], { cwd: path });
    Bun.spawnSync(["git", "-c", "core.hooksPath=/dev/null", "commit", "-q", "-s", "--no-edit"], { cwd: path });
    const run = await cli(sb, gh, ["continue", "7", "--worktree", path]);
    expect(run.json.code).toBe("merge_not_in_progress");
    expect(run.json.next).toContain("abort 7");
    expect(run.json.next).not.toContain("continue 7");
    expect(pushes(run.gitCalls)).toBe(0);
  });

  test("a PR head that moved removes the stale merge and pushes nothing", async () => {
    const sb = box();
    conflictSetup(sb);
    const { gh, path } = await keep(sb);
    const other = sb.other();
    sb.git(["fetch", "origin"], other);
    sb.git(["checkout", "-b", "feat/topic", "origin/feat/topic"], other);
    const raced = sb.commit({ "z.txt": "z\n" }, "feat: raced", { cwd: other });
    sb.git(["push", "origin", "feat/topic"], other);
    writeFileSync(join(path, "README.md"), "# fixed\n");
    const run = await cli(sb, gh, ["continue", "7", "--worktree", path]);
    expect(run.json.code).toBe("head_moved");
    expect(pushes(run.gitCalls)).toBe(0);
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(raced as never);
    expect(existsSync(path)).toBe(false);
  });

  test("a pre-push failure after the merge pushes nothing and removes the worktree", async () => {
    const sb = box();
    const { oldHead } = conflictSetup(sb);
    const step = ["[[prepush]]", 'name = "check"', `run = [${JSON.stringify(BUN)}, "-e", "process.exit(3)"]`].join("\n");
    const { gh, path } = await keep(sb, { policy: policyToml(regenerateSection(), step) });
    writeFileSync(join(path, "README.md"), "# fixed\n");
    const run = await cli(sb, gh, ["continue", "7", "--worktree", path]);
    expect(run.json.code).toBe("prepush_failed");
    expect(run.json.details.join("\n")).toContain("--keep-worktree");
    expect(pushes(run.gitCalls)).toBe(0);
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(oldHead as never);
    expect(existsSync(path)).toBe(false);
  });

  test.each([
    ["a path that is not a library worktree", (sb: Sandbox) => sb.root],
    ["a missing path", (sb: Sandbox) => join(sb.root, "nowhere", "work")],
    ["the user's checkout", (sb: Sandbox) => sb.clone],
  ])("refuses %s", async (_name, pick) => {
    const sb = box();
    topicOnly(sb);
    const gh = fakeGithub(sb, { policy: POLICY });
    const run = await cli(sb, gh, ["continue", "7", "--worktree", pick(sb)]);
    expect(run.json.code).toBe("worktree_invalid");
    expect(pushes(run.gitCalls)).toBe(0);
    expect(existsSync(sb.clone)).toBe(true);
  });

  test("refuses a library-looking directory without a marker, and a marker for another PR", async () => {
    const sb = box();
    topicOnly(sb);
    const fake = join(sb.worktreeRoot, "pr-refresh-fake", "work");
    mkdirSync(fake, { recursive: true });
    writeFileSync(join(fake, "keep.txt"), "x\n");
    const gh = fakeGithub(sb, { policy: POLICY });
    const missing = await cli(sb, gh, ["abort", "7", "--worktree", fake]);
    expect(missing.json.code).toBe("worktree_invalid");
    expect(existsSync(join(fake, "keep.txt"))).toBe(true);

    const sb2 = box();
    conflictSetup(sb2);
    const kept = await keep(sb2);
    const wrong = await cli(sb2, kept.gh, ["abort", "8", "--worktree", kept.path]);
    expect(wrong.json.code).toBe("worktree_invalid");
    expect(existsSync(kept.path)).toBe(true);
  });
});

function topicOnly(sb: Sandbox): void {
  sb.commit({ "a.txt": "one\n" }, "feat: one");
  sb.git(["push", "origin", "feat/topic"]);
}

describe("abort", () => {
  test("removes the kept worktree and everything that was made for it", async () => {
    const sb = box();
    const { oldHead } = conflictSetup(sb);
    const { gh, path } = await keep(sb);
    const run = await cli(sb, gh, ["abort", "7", "--worktree", path]);
    expect(run.code).toBe(0);
    expect(existsSync(path)).toBe(false);
    expect(worktreeLeftovers(sb).entries).toEqual([]);
    expect(worktreeLeftovers(sb).list.split("\n").filter((l) => l.startsWith("worktree ")).length).toBe(1);
    expect(pushes(run.gitCalls)).toBe(0);
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(oldHead as never);
  });

  function stateFile(sb: Sandbox): string {
    const dir = join(sb.root, "state");
    const names = readdirSync(dir).filter((n) => n.endsWith(".json"));
    expect(names).toHaveLength(1);
    return join(dir, names[0] ?? "");
  }

  test("a state file that names a directory outside the repository deletes nothing", async () => {
    const sb = box();
    conflictSetup(sb);
    const { gh, path } = await keep(sb);
    const victim = mkdtempSync(join(tmpdir(), "refresh-victim-"));
    extra.push(victim);
    mkdirSync(join(victim, "worktrees", "precious"), { recursive: true });
    const file = stateFile(sb);
    const text = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    writeFileSync(file, JSON.stringify({ ...text, adminDir: join(victim, "worktrees", "precious") }), { mode: 0o600 });
    const run = await cli(sb, gh, ["abort", "7", "--worktree", path]);
    expect(run.json.code).toBe("worktree_invalid");
    expect(existsSync(join(victim, "worktrees", "precious"))).toBe(true);
    expect(existsSync(path)).toBe(true);
  });

  test("a state file that names another worktree's admin directory deletes nothing", async () => {
    const sb = box();
    conflictSetup(sb);
    const { gh, path } = await keep(sb);
    const other = otherWorktree(sb);
    const file = stateFile(sb);
    const text = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    writeFileSync(file, JSON.stringify({ ...text, adminDir: other.admin }), { mode: 0o600 });
    const run = await cli(sb, gh, ["abort", "7", "--worktree", path]);
    expect(run.json.code).toBe("worktree_invalid");
    expect(existsSync(join(other.admin, "index"))).toBe(true);
    expect(existsSync(join(other.path, "wip.txt"))).toBe(true);
  });

  test("a state file that is a link, or open to other users, is ignored", async () => {
    const sb = box();
    conflictSetup(sb);
    const { gh, path } = await keep(sb);
    const file = stateFile(sb);
    chmodSync(file, 0o644);
    const open = await cli(sb, gh, ["abort", "7", "--worktree", path]);
    expect(open.json.code).toBe("worktree_invalid");
    chmodSync(file, 0o600);
    const copy = join(sb.root, "state-copy.json");
    renameSync(file, copy);
    symlinkSync(copy, file);
    const link = await cli(sb, gh, ["abort", "7", "--worktree", path]);
    expect(link.json.code).toBe("worktree_invalid");
    expect(existsSync(path)).toBe(true);
  });

  test("the state directory is private and holds one random id per run", async () => {
    const sb = box();
    conflictSetup(sb);
    const { run } = await keep(sb);
    expect(statSync(join(sb.root, "state")).mode & 0o777).toBe(0o700);
    expect(statSync(stateFile(sb)).mode & 0o777).toBe(0o600);
    expect(String(run.json.data["id"])).toMatch(/^[0-9a-f]{32}$/);
    expect(stateFile(sb)).toContain(String(run.json.data["id"]));
    expect(run.json.details.join("\n")).toContain(`state id: ${String(run.json.data["id"])}`);
  });

  test("continue and abort remove the state file with the worktree", async () => {
    const sb = box();
    conflictSetup(sb);
    const { gh, path } = await keep(sb);
    expect(readdirSync(join(sb.root, "state"))).toHaveLength(1);
    await cli(sb, gh, ["abort", "7", "--worktree", path]);
    expect(readdirSync(join(sb.root, "state"))).toHaveLength(0);
  });
});

describe("re-review and signing", () => {
  test("--fresh-ci plus a regenerate commit is not a clean merge and asks for a review", async () => {
    const sb = box();
    // The PR changes the inputs and leaves a stale output. The branch already has the base.
    sb.commit({ "gen/inputs.txt": "x1\nx2\n" }, "feat: inputs");
    sb.git(["push", "origin", "feat/topic"]);
    const gh = fakeGithub(sb, { policy: policyToml(regenerateSection()) });
    const run = await cli(sb, gh, ["sync", "7", "--fresh-ci"]);
    expect(run.code).toBe(0);
    expect(run.json.data["cleanMerge"]).toBe(false);
    expect(run.json.data["reReview"]).toBe("requested");
    expect(gh.comments[0]).toContain("a regenerate commit changed generated files");
    expect(sb.git(["show", "refs/heads/feat/topic:out/generated.txt"], sb.remote)).toBe("X1,X2 (2)\n");
  });

  test("the user's commit signing is inherited: a failing signer stops the run before the push", async () => {
    const sb = box();
    topicOnly(sb);
    sb.git(["config", "commit.gpgsign", "true"]);
    sb.git(["config", "user.signingkey", "ABCDEF"]);
    sb.git(["config", "gpg.program", "false"]);
    const before = sb.remoteRev("refs/heads/feat/topic");
    const gh = fakeGithub(sb, { policy: policyToml() });
    const run = await cli(sb, gh, ["sync", "7", "--fresh-ci"]);
    expect(run.code).toBe(20);
    expect(pushes(run.gitCalls)).toBe(0);
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(before);
  });
});

describe("a policy step cannot make cleanup delete another path", () => {
  test("a pre-push step that rewrites .git blocks the run and leaves the other directory alone", async () => {
    const sb = box();
    topicOnly(sb);
    const other = sb.other();
    sb.commit({ "docs/base.md": "base\n" }, "chore: base moves", { cwd: other });
    sb.git(["push", "origin", "main"], other);
    const victim = mkdtempSync(join(tmpdir(), "refresh-victim-"));
    extra.push(victim);
    const precious = join(victim, "worktrees", "precious");
    mkdirSync(precious, { recursive: true });
    writeFileSync(join(precious, "keep.txt"), "x\n");
    const script = `require("fs").writeFileSync(".git", "gitdir: ${precious}\\n")`;
    const step = ["[[prepush]]", 'name = "evil"', `run = [${JSON.stringify(BUN)}, "-e", ${JSON.stringify(script)}]`].join("\n");
    const before = sb.remoteRev("refs/heads/feat/topic");
    const gh = fakeGithub(sb, { policy: policyToml(step) });
    const run = await cli(sb, gh, ["sync", "7"]);
    expect(run.code).toBe(20);
    expect(run.json.code).toBe("worktree_tampered");
    expect(pushes(run.gitCalls)).toBe(0);
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(before);
    expect(existsSync(join(precious, "keep.txt"))).toBe(true);
    expect(worktreeLeftovers(sb).entries).toEqual([]);
    expect(worktreeLeftovers(sb).list.split("\n").filter((l) => l.startsWith("worktree ")).length).toBe(1);
  });

  test("a worktree that a step replaced with a link to another directory is not deleted through the link", async () => {
    const sb = box();
    topicOnly(sb);
    const victim = mkdtempSync(join(tmpdir(), "refresh-victim-"));
    extra.push(victim);
    writeFileSync(join(victim, "keep.txt"), "x\n");
    const { withWorktree } = await import("../lib/refresh/worktree.ts");
    const { guardedGit } = await import("../lib/refresh/gitx.ts");
    const notes: string[] = [];
    await withWorktree(
      { cwd: sb.clone, root: sb.worktreeRoot, runner: guardedGit, stateRoot: join(sb.root, "state"), onProblem: (n) => notes.push(n) },
      sb.git(["rev-parse", "HEAD"]).trim(),
      async (w) => {
        rmSync(w.path, { recursive: true, force: true });
        Bun.spawnSync(["ln", "-s", victim, w.path]);
      },
    );
    expect(existsSync(join(victim, "keep.txt"))).toBe(true);
    expect(notes.join("\n")).toContain("cleanup note");
  });
});

/**
 * What an agent can do: write a marker next to the kept worktree. The script
 * must not read it. (An older design read this file, so the tests keep it.)
 */
function forgeMarker(sb: Sandbox, path: string, patch: Record<string, unknown>): void {
  const adminDir = sb.git(["rev-parse", "--absolute-git-dir"], path).trim();
  const forged = {
    schema: 1,
    repo: REPO,
    number: 7,
    remote: "origin",
    headRef: "feat/topic",
    headSha: sb.remoteRev("refs/heads/feat/topic"),
    baseRef: "main",
    baseSha: sb.remoteRev("refs/heads/main"),
    conflicts: ["README.md", "out/generated.txt"],
    adminDir,
    commonDir: realpathSync(join(sb.clone, ".git")),
    ...patch,
  };
  writeFileSync(join(path, "..", "pr-refresh.json"), JSON.stringify(forged));
}

function otherWorktree(sb: Sandbox): { readonly path: string; readonly admin: string } {
  const path = join(sb.root, "my-other-worktree");
  sb.git(["worktree", "add", "--detach", path, "HEAD"]);
  writeFileSync(join(path, "wip.txt"), "work in progress\n");
  sb.git(["add", "wip.txt"], path);
  return { path, admin: sb.git(["rev-parse", "--absolute-git-dir"], path).trim() };
}

describe("a kept worktree trusts only library-owned state", () => {
  test("a forged marker cannot make abort delete another worktree's data", async () => {
    const sb = box();
    conflictSetup(sb);
    const { gh, path } = await keep(sb);
    const other = otherWorktree(sb);
    forgeMarker(sb, path, { adminDir: other.admin });
    const run = await cli(sb, gh, ["abort", "7", "--worktree", path]);
    expect(existsSync(join(other.admin, "index"))).toBe(true);
    expect(existsSync(join(other.path, "wip.txt"))).toBe(true);
    expect(sb.git(["status", "--porcelain"], other.path)).toContain("wip.txt");
    expect(run.code).toBe(0);
    expect(existsSync(path)).toBe(false);
  });

  test("a staged edit outside the conflict set is refused", async () => {
    const sb = box();
    const { oldHead } = conflictSetup(sb);
    const { gh, path } = await keep(sb);
    writeFileSync(join(path, "README.md"), "# fixed\n");
    writeFileSync(join(path, "gen", "inputs.txt"), "sneaky\n");
    sb.git(["add", "gen/inputs.txt"], path);
    const run = await cli(sb, gh, ["continue", "7", "--worktree", path]);
    expect(run.code).toBe(20);
    expect(run.json.code).toBe("continue_outside_edit");
    expect(run.json.details).toContain("outside: gen/inputs.txt");
    expect(pushes(run.gitCalls)).toBe(0);
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(oldHead as never);
  });

  test("a removal outside the conflict set is refused", async () => {
    const sb = box();
    sb.commit({ "keep.txt": "x\n" }, "feat: keep file");
    const { oldHead } = conflictSetup(sb);
    const { gh, path } = await keep(sb);
    writeFileSync(join(path, "README.md"), "# fixed\n");
    sb.git(["rm", "-q", "keep.txt"], path);
    const run = await cli(sb, gh, ["continue", "7", "--worktree", path]);
    expect(run.json.code).toBe("continue_outside_edit");
    expect(run.json.details).toContain("outside: keep.txt");
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(oldHead as never);
  });

  test("an unstaged edit outside the conflict set is refused", async () => {
    const sb = box();
    conflictSetup(sb);
    const { gh, path } = await keep(sb);
    writeFileSync(join(path, "README.md"), "# fixed\n");
    writeFileSync(join(path, "gen", "inputs.txt"), "sneaky\n");
    const run = await cli(sb, gh, ["continue", "7", "--worktree", path]);
    expect(run.json.code).toBe("continue_outside_edit");
    expect(pushes(run.gitCalls)).toBe(0);
  });

  test("an untracked file outside the conflict set is refused", async () => {
    const sb = box();
    conflictSetup(sb);
    const { gh, path } = await keep(sb);
    writeFileSync(join(path, "README.md"), "# fixed\n");
    writeFileSync(join(path, "extra.txt"), "new\n");
    const run = await cli(sb, gh, ["continue", "7", "--worktree", path]);
    expect(run.json.code).toBe("continue_outside_edit");
    expect(run.json.details).toContain("outside: extra.txt");
    expect(pushes(run.gitCalls)).toBe(0);
  });

  test("a widened conflict list in a forged marker is ignored", async () => {
    const sb = box();
    const { oldHead } = conflictSetup(sb);
    const { gh, path } = await keep(sb);
    forgeMarker(sb, path, { conflicts: ["README.md", "out/generated.txt", "gen/inputs.txt"] });
    writeFileSync(join(path, "README.md"), "# fixed\n");
    writeFileSync(join(path, "gen", "inputs.txt"), "widened\n");
    const run = await cli(sb, gh, ["continue", "7", "--worktree", path]);
    expect(run.code).toBe(20);
    expect(run.json.code).toBe("continue_outside_edit");
    expect(pushes(run.gitCalls)).toBe(0);
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(oldHead as never);
  });
});

describe("generator outputs and the base", () => {
  test("a hand-made file under an output glob is refused before any generator runs", async () => {
    const sb = box();
    sb.commit({ "out/second.txt": "second\n" }, "feat: second output");
    const { oldHead } = conflictSetup(sb);
    const { gh, path } = await keep(sb);
    writeFileSync(join(path, "README.md"), "# fixed\n");
    writeFileSync(join(path, "out", "backdoor.txt"), "hand made\n");
    const run = await cli(sb, gh, ["continue", "7", "--worktree", path]);
    expect(run.code).toBe(20);
    expect(run.json.code).toBe("continue_outside_edit");
    expect(run.json.details).toContain("outside: out/backdoor.txt");
    expect(pushes(run.gitCalls)).toBe(0);
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(oldHead as never);
  });

  test("an edit to a tracked file under an output glob that the generator never writes is refused", async () => {
    const sb = box();
    sb.commit({ "out/second.txt": "second\n" }, "feat: second output");
    const { oldHead } = conflictSetup(sb);
    const { gh, path } = await keep(sb);
    writeFileSync(join(path, "README.md"), "# fixed\n");
    writeFileSync(join(path, "out", "second.txt"), "tampered\n");
    const run = await cli(sb, gh, ["continue", "7", "--worktree", path]);
    expect(run.json.code).toBe("continue_outside_edit");
    expect(run.json.details).toContain("outside: out/second.txt");
    expect(pushes(run.gitCalls)).toBe(0);
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(oldHead as never);
  });

  test("a staged hand-made file under an output glob is refused too", async () => {
    const sb = box();
    conflictSetup(sb);
    const { gh, path } = await keep(sb);
    writeFileSync(join(path, "README.md"), "# fixed\n");
    writeFileSync(join(path, "out", "backdoor.txt"), "hand made\n");
    sb.git(["add", "out/backdoor.txt"], path);
    const run = await cli(sb, gh, ["continue", "7", "--worktree", path]);
    expect(run.json.code).toBe("continue_outside_edit");
    expect(pushes(run.gitCalls)).toBe(0);
  });

  test("a file that the generator writes is accepted, and only that file", async () => {
    const sb = box();
    const script = `const fs = require("fs"); fs.mkdirSync("out", {recursive: true}); fs.writeFileSync("out/generated.txt", "G\\n"); fs.writeFileSync("out/extra.txt", "E\\n")`;
    const section = ["[[regenerate]]", 'name = "gen"', `run = [${JSON.stringify(BUN)}, "-e", ${JSON.stringify(script)}]`, 'outputs = ["out/**"]'].join("\n");
    conflictSetup(sb);
    const { gh, path } = await keep(sb, { policy: policyToml(section) });
    writeFileSync(join(path, "README.md"), "# fixed\n");
    const run = await cli(sb, gh, ["continue", "7", "--worktree", path]);
    expect(run.code).toBe(0);
    const head = sb.remoteRev("refs/heads/feat/topic");
    expect(sb.git(["show", `${head}:out/generated.txt`], sb.remote)).toBe("G\n");
    expect(sb.git(["show", `${head}:out/extra.txt`], sb.remote)).toBe("E\n");
  });

  test("a base that moved since sync is refused and nothing is pushed", async () => {
    const sb = box();
    const { oldHead } = conflictSetup(sb);
    const { gh, path } = await keep(sb);
    const other = sb.other();
    sb.git(["pull", "-q", "origin", "main"], other);
    sb.commit({ "docs/later.md": "later\n" }, "chore: base moves again", { cwd: other });
    sb.git(["push", "origin", "main"], other);
    writeFileSync(join(path, "README.md"), "# fixed\n");
    const run = await cli(sb, gh, ["continue", "7", "--worktree", path]);
    expect(run.code).toBe(20);
    expect(run.json.code).toBe("base_moved");
    expect(run.json.next).toBe(`abort 7 --worktree ${path}, then run sync 7 --keep-worktree again`);
    expect(pushes(run.gitCalls)).toBe(0);
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(oldHead as never);
    expect(existsSync(path)).toBe(true);
    const abort = await cli(sb, gh, ["abort", "7", "--worktree", path]);
    expect(abort.code).toBe(0);
  });
});
