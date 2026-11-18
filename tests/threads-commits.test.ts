// The fix-commit proof, against real git repositories made in a temp directory.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultGit } from "../lib/github/git-facts.ts";
import { run } from "../lib/proc.ts";
import type { CommitObservation } from "../lib/status/types.ts";
import { parseSha, type Sha } from "../lib/types.ts";
import { isAncestor, verifyFixCommits } from "../lib/threads/commits.ts";
import { green, sha } from "./helpers/status.ts";

const ENV = { GIT_AUTHOR_NAME: "Dev", GIT_AUTHOR_EMAIL: "dev@example.com", GIT_COMMITTER_NAME: "Dev", GIT_COMMITTER_EMAIL: "dev@example.com", GIT_CONFIG_GLOBAL: "/dev/null" };

let tmp = "";
let work = "";

async function git(args: readonly string[]): Promise<string> {
  const result = await run(["git", ...args], { cwd: work, env: ENV });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

async function commit(file: string, message: string): Promise<Sha> {
  writeFileSync(join(work, file), message);
  await git(["add", file]);
  await git(["commit", "-q", "-m", message]);
  const parsed = parseSha(await git(["rev-parse", "HEAD"]));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

function observation(oid: Sha): CommitObservation {
  return { oid, parents: [], tree: sha("e"), message: "m", authorLogin: null, authorEmail: "dev@example.com", committedDate: "2026-01-01T00:00:00Z" };
}

let base: Sha;
let first: Sha;
let head: Sha;
let sideways: Sha;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "threads-commits-"));
  work = join(tmp, "work");
  await run(["git", "init", "-q", "-b", "main", work], { cwd: tmp, env: ENV });
  base = await commit("base.txt", "base");
  await git(["checkout", "-q", "-b", "topic"]);
  first = await commit("a.txt", "first");
  head = await commit("b.txt", "second");
  await git(["checkout", "-q", "-b", "other", base]);
  sideways = await commit("c.txt", "sideways");
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("isAncestor", () => {
  test("true for an ancestor, false for a commit on another branch", async () => {
    const run = defaultGit(work);
    expect(await isAncestor(run, first, head)).toBe(true);
    expect(await isAncestor(run, head, head)).toBe(true);
    expect(await isAncestor(run, sideways, head)).toBe(false);
  });

  test("a message, not a guess, when the clone lacks the head", async () => {
    const result = await isAncestor(defaultGit(work), first, sha("9"));
    expect(typeof result).toBe("string");
  });
});

describe("verifyFixCommits", () => {
  const snapshot = (): ReturnType<typeof green> => green({ headSha: head, commits: [observation(first), observation(head)] });

  test("accepts a commit of the PR that is an ancestor of the head", async () => {
    expect(await verifyFixCommits([first, head], snapshot(), defaultGit(work))).toEqual([]);
  });

  test("without a clone, the PR commit list alone decides", async () => {
    expect(await verifyFixCommits([first], snapshot(), null)).toEqual([]);
  });

  test("refuses a commit that the PR does not list", async () => {
    const refusals = await verifyFixCommits([sideways], snapshot(), defaultGit(work));
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain("not a commit of this PR");
  });

  test("refuses a listed commit that is not an ancestor of the head", async () => {
    const snap = green({ headSha: head, commits: [observation(sideways), observation(head)] });
    const refusals = await verifyFixCommits([sideways], snap, defaultGit(work));
    expect(refusals[0]).toContain("not an ancestor");
  });

  test("says so when the PR commit list is cut off", async () => {
    const snap = green({ headSha: head, commits: [observation(head)], commitsTruncated: true });
    expect((await verifyFixCommits([first], snap, null))[0]).toContain("not among the latest");
  });

  test("refuses when the clone lacks the head", async () => {
    const snap = green({ headSha: sha("9"), commits: [observation(first)] });
    expect((await verifyFixCommits([first], snap, defaultGit(work)))[0]).toContain("does not hold the head");
  });
});
