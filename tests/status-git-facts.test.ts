// Carry-over cases against real git repositories created in a temp directory.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultGit, gatherGitFacts, type GitFactsRequest } from "../lib/github/git-facts.ts";
import { run } from "../lib/proc.ts";
import { parseSha, type Sha } from "../lib/types.ts";

const ENV = { GIT_AUTHOR_NAME: "Dev", GIT_AUTHOR_EMAIL: "dev@example.com", GIT_COMMITTER_NAME: "Dev", GIT_COMMITTER_EMAIL: "dev@example.com", GIT_CONFIG_GLOBAL: "/dev/null" };

let tmp = "";
let work = "";
let origin = "";

async function git(args: readonly string[], cwd = work): Promise<string> {
  const result = await run(["git", ...args], { cwd, env: ENV });
  if (result.code !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

async function sha(rev: string): Promise<Sha> {
  const parsed = parseSha(await git(["rev-parse", rev]));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

function write(file: string, text: string): void {
  writeFileSync(join(work, file), text);
}

async function commitFile(file: string, text: string, message: string): Promise<Sha> {
  write(file, text);
  await git(["add", file]);
  await git(["commit", "-q", "-m", message]);
  return sha("HEAD");
}

async function publish(head: Sha): Promise<void> {
  await git(["push", "-q", "origin", `+${head}:refs/pull/1/head`]);
  await git(["push", "-q", "origin", "main:main"]);
}

let counter = 0;
/** A fresh feature branch off the current main tip. */
async function branch(): Promise<string> {
  counter += 1;
  const name = `feat-${counter}`;
  await git(["checkout", "-q", "-b", name, "main"]);
  return name;
}

async function request(patch: Partial<GitFactsRequest> & { readonly headSha: Sha }, reviewed: readonly Sha[] = []): Promise<GitFactsRequest> {
  return {
    number: 1,
    baseRef: "main",
    baseSha: await sha("main"),
    reviewedCommits: reviewed,
    carryOver: true,
    maxCarryMerges: 3,
    ...patch,
  };
}

async function facts(head: Sha, reviewed: readonly Sha[] = [], patch: Partial<GitFactsRequest> = {}) {
  await publish(head);
  return gatherGitFacts(defaultGit(work), await request({ headSha: head, ...patch }, reviewed));
}

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "status-git-"));
  origin = join(tmp, "origin.git");
  work = join(tmp, "work");
  await run(["git", "init", "-q", "--bare", "-b", "main", origin], { cwd: tmp, env: ENV });
  await run(["git", "init", "-q", "-b", "main", work], { cwd: tmp, env: ENV });
  await git(["remote", "add", "origin", origin]);
  await commitFile("a.txt", "one\n", "base");
  await git(["push", "-q", "origin", "main:main"]);
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const chain = (f: { readonly reviewEquivalentHeads: readonly { readonly sha: Sha; readonly via: string }[] }) => f.reviewEquivalentHeads.map((h) => h.via);

describe("carry-over from git", () => {
  test("an empty commit carries", async () => {
    await branch();
    const reviewed = await commitFile("b.txt", "feature\n", "feature");
    await git(["commit", "-q", "--allow-empty", "-m", "ci: refresh"]);
    const head = await sha("HEAD");
    const f = await facts(head, [reviewed]);
    expect(f.available).toBe(true);
    expect(f.reviewEquivalentHeads.map((h) => h.sha)).toEqual([head, reviewed]);
    expect(chain(f)).toEqual(["head", "empty_commit"]);
  });

  test("a clean merge of the base carries", async () => {
    await git(["checkout", "-q", "main"]);
    const name = await branch();
    const reviewed = await commitFile("c.txt", "feature\n", "feature");
    await git(["checkout", "-q", "main"]);
    await commitFile("m.txt", "main moved\n", "main moves");
    await git(["push", "-q", "origin", "main:main"]);
    await git(["checkout", "-q", name]);
    await git(["merge", "-q", "--no-ff", "-m", "Merge main", "main"]);
    const head = await sha("HEAD");
    const f = await facts(head, [reviewed]);
    expect(chain(f)).toEqual(["head", "clean_base_merge"]);
    expect(f.reviewEquivalentHeads[1]?.sha).toBe(reviewed);
    expect(f.carryStoppedBecause).toContain("changes files");
  });

  test("a conflicted merge that a person resolved does NOT carry", async () => {
    await git(["checkout", "-q", "main"]);
    const name = await branch();
    const reviewed = await commitFile("a.txt", "feature line\n", "feature edits a");
    await git(["checkout", "-q", "main"]);
    await commitFile("a.txt", "main line\n", "main edits a");
    await git(["push", "-q", "origin", "main:main"]);
    await git(["checkout", "-q", name]);
    const merged = await run(["git", "merge", "--no-ff", "-m", "Merge main", "main"], { cwd: work, env: ENV });
    expect(merged.code).toBe(1);
    expect(await Bun.file(join(work, "a.txt")).text()).toContain("<<<<<<<");
    write("a.txt", "resolved by hand\n");
    await git(["add", "a.txt"]);
    await git(["commit", "-q", "--no-edit"]);
    const head = await sha("HEAD");
    const f = await facts(head, [reviewed]);
    expect(f.available).toBe(true);
    expect(chain(f)).toEqual(["head"]);
    expect(f.carryStoppedBecause).toContain("conflicts");
  });

  test("a merge that also changes other files does NOT carry", async () => {
    await git(["checkout", "-q", "main"]);
    const name = await branch();
    const reviewed = await commitFile("d.txt", "feature\n", "feature");
    await git(["checkout", "-q", "main"]);
    await commitFile("n.txt", "main moved again\n", "main moves");
    await git(["push", "-q", "origin", "main:main"]);
    await git(["checkout", "-q", name]);
    await git(["merge", "-q", "--no-ff", "--no-commit", "main"]);
    write("sneaky.txt", "not from main\n");
    await git(["add", "sneaky.txt"]);
    await git(["commit", "-q", "-m", "Merge main (and more)"]);
    const head = await sha("HEAD");
    const f = await facts(head, [reviewed]);
    expect(chain(f)).toEqual(["head"]);
    expect(f.carryStoppedBecause).toContain("changed more than the base");
  });

  test("a merge of a branch that is not the base does NOT carry", async () => {
    await git(["checkout", "-q", "main"]);
    const name = await branch();
    const reviewed = await commitFile("e.txt", "feature\n", "feature");
    await git(["checkout", "-q", "-b", "side", "main"]);
    await commitFile("side.txt", "side\n", "side work");
    await git(["checkout", "-q", name]);
    await git(["merge", "-q", "--no-ff", "-m", "Merge side", "side"]);
    const head = await sha("HEAD");
    const f = await facts(head, [reviewed]);
    expect(chain(f)).toEqual(["head"]);
    expect(f.carryStoppedBecause).toContain("does not merge the base");
    await git(["branch", "-q", "-D", "side"]);
  });

  test("a rewrite that changes only Signed-off-by lines carries", async () => {
    await git(["checkout", "-q", "main"]);
    await branch();
    const reviewed = await commitFile("f.txt", "feature\n", "feature without sign-off");
    await git(["commit", "-q", "--amend", "-s", "--no-edit"]);
    const head = await sha("HEAD");
    expect(head).not.toBe(reviewed);
    const f = await facts(head, [reviewed]);
    expect(chain(f)).toEqual(["head", "trailer_rewrite"]);
    expect(f.reviewEquivalentHeads[1]?.sha).toBe(reviewed);
  });

  test("a rewrite that also changes the message text does NOT carry", async () => {
    await git(["checkout", "-q", "main"]);
    await branch();
    const reviewed = await commitFile("g.txt", "feature\n", "original message");
    await git(["commit", "-q", "--amend", "-s", "-m", "a different message"]);
    const head = await sha("HEAD");
    const f = await facts(head, [reviewed]);
    expect(chain(f)).toEqual(["head"]);
  });

  test("a code change after the reviewed commit stops the chain", async () => {
    await git(["checkout", "-q", "main"]);
    await branch();
    const reviewed = await commitFile("h.txt", "feature\n", "feature");
    const head = await commitFile("h.txt", "feature changed\n", "more code");
    const f = await facts(head, [reviewed]);
    expect(chain(f)).toEqual(["head"]);
    expect(f.carryStoppedBecause).toContain("changes files");
  });

  test("more base merges than max_carry_merges stop the chain", async () => {
    await git(["checkout", "-q", "main"]);
    const name = await branch();
    const reviewed = await commitFile("i.txt", "feature\n", "feature");
    for (const n of [1, 2]) {
      await git(["checkout", "-q", "main"]);
      await commitFile(`mm${n}.txt`, `m${n}\n`, `main ${n}`);
      await git(["push", "-q", "origin", "main:main"]);
      await git(["checkout", "-q", name]);
      await git(["merge", "-q", "--no-ff", "-m", `Merge main ${n}`, "main"]);
    }
    const head = await sha("HEAD");
    const one = await facts(head, [reviewed], { maxCarryMerges: 1 });
    expect(chain(one)).toEqual(["head", "clean_base_merge"]);
    expect(one.carryStoppedBecause).toContain("more than 1 base merges");
    const three = await facts(head, [reviewed], { maxCarryMerges: 3 });
    expect(chain(three)).toEqual(["head", "clean_base_merge", "clean_base_merge"]);
    expect(three.reviewEquivalentHeads.at(-1)?.sha).toBe(reviewed);
  });

  test("carry-over off gives the head only and needs no git", async () => {
    const f = await gatherGitFacts(defaultGit("/"), await request({ headSha: await sha("HEAD"), carryOver: false }));
    expect(f.available).toBe(true);
    expect(chain(f)).toEqual(["head"]);
  });

  test("any git failure gives available = false and keeps the head", async () => {
    const head = await sha("HEAD");
    const notRepo = await gatherGitFacts(defaultGit(tmp), await request({ headSha: head }));
    expect(notRepo.available).toBe(false);
    expect(notRepo.unavailableBecause).not.toBeNull();
    expect(chain(notRepo)).toEqual(["head"]);
    const missingHead = await gatherGitFacts(defaultGit(work), await request({ headSha: head, fetch: false }, []).then((r) => ({ ...r, headSha: parseShaOrThrow("9".repeat(40)) })));
    expect(missingHead.available).toBe(false);
    const badRemote = await gatherGitFacts(defaultGit(work), await request({ headSha: head, remote: "nowhere" }));
    expect(badRemote.available).toBe(false);
  });
});

function parseShaOrThrow(text: string): Sha {
  const parsed = parseSha(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}
