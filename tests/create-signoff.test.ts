import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../lib/proc.ts";
import { rewriteRefusal, signoffRange, type SignoffResult } from "../lib/create/signoff.ts";
import { appendSignoff, onlyTrailerAdded, parseCommitObject, type RangeCommit, type RewritePlan } from "../lib/dco.ts";
import { sha } from "./helpers/status.ts";
import { argsFor, configFor, fakeWorld, makeRepos, newWorld, runCli, type FakeWorld, type Repos, type World } from "./helpers/create.ts";

const made: Repos[] = [];
afterEach(() => {
  for (const repos of made.splice(0)) {
    repos.cleanup();
  }
});

async function setup(world: Partial<World> = {}): Promise<{ repos: Repos; fake: FakeWorld }> {
  const repos = await makeRepos();
  made.push(repos);
  await repos.git(["checkout", "-b", "feat/topic"]);
  return { repos, fake: fakeWorld(repos, newWorld(world)) };
}

function done(result: SignoffResult): Extract<SignoffResult, { kind: "done" }> {
  if (result.kind !== "done") {
    throw new Error(`not done: ${JSON.stringify(result)}`);
  }
  return result;
}

async function show(repos: Repos, sha: string, format: string): Promise<string> {
  return (await repos.git(["log", "-1", `--format=${format}`, sha])).trim();
}

describe("signoff", () => {
  test("adds the trailer to the unpushed commits, keeps trees, authors, and dates, and pushes nothing", async () => {
    const { repos, fake } = await setup();
    const first = await repos.commit("a.txt", "a\n", "feat: add a", { signoff: false, author: "Other Dev <other@example.invalid>" });
    const second = await repos.commit("b.txt", "b\n", "feat: add b");
    const third = await repos.commit("c.txt", "c\n", "feat: add c\n\nBody text.", { signoff: false });
    const dates = [first, second, third].map(async (sha) => show(repos, sha, "%an|%ae|%ad|%T"));
    const before = await Promise.all(dates);

    const result = done(await signoffRange(argsFor("signoff", "--expect-head", third), configFor(repos, fake)));
    expect(result.trailersAdded).toBe(2);
    expect(result.reparented).toBe(1);
    expect(await repos.head()).toBe(result.newHead);
    expect(result.newHead).not.toBe(third);

    const chain = (await repos.git(["rev-list", "--reverse", `${result.newHead}`, "^origin/main"])).trim().split("\n");
    expect(chain).toHaveLength(3);
    const after = await Promise.all(chain.map((sha) => show(repos, sha, "%an|%ae|%ad|%T")));
    expect(after).toEqual(before);
    const messages = await Promise.all(chain.map((sha) => show(repos, sha, "%B")));
    expect(messages[0]).toContain("Signed-off-by: Dev A <dev-a@example.invalid>");
    expect(messages[1]).toBe((await show(repos, second, "%B")));
    expect(messages[2]).toBe("feat: add c\n\nBody text.\n\nSigned-off-by: Dev A <dev-a@example.invalid>");
    expect(await repos.remoteRef("feat/topic")).toBeNull();
    // The working tree and the index are untouched, and the plan is clean now.
    expect((await repos.git(["status", "--porcelain"])).trim()).toBe("");
    expect((await runCli(["plan", "--title", "feat: abc"], repos, fake)).code).toBe(0);
  });

  test("a bot commit is moved onto the new parent without a trailer when the policy exempts it", async () => {
    const policy = 'schema = 1\n[dco]\nbot_authors = ["dependency-bot[bot]"]\nbot_commits = "exempt"\n';
    const { repos, fake } = await setup({ policy });
    await repos.commit("a.txt", "a\n", "feat: add a", { signoff: false });
    const bot = await repos.commit("b.txt", "b\n", "chore: bump", { signoff: false, author: "dependency-bot[bot] <1+dependency-bot[bot]@users.noreply.example.invalid>" });
    const result = done(await signoffRange(argsFor("signoff", "--expect-head", bot), configFor(repos, fake)));
    expect(result.trailersAdded).toBe(1);
    expect(await show(repos, result.newHead, "%B")).toBe("chore: bump");
  });

  test("a pushed unsigned commit is left alone and only the local part is rebuilt", async () => {
    const { repos, fake } = await setup();
    const pushed = await repos.commit("a.txt", "a\n", "feat: add a", { signoff: false });
    await repos.git(["push", "origin", "feat/topic"]);
    const local = await repos.commit("b.txt", "b\n", "feat: add b", { signoff: false });
    const result = done(await signoffRange(argsFor("signoff", "--expect-head", local), configFor(repos, fake)));
    expect(result.trailersAdded).toBe(1);
    expect((await repos.git(["rev-parse", `${result.newHead}~1`])).trim()).toBe(pushed);
    expect(await repos.remoteRef("feat/topic")).toBe(pushed);
  });

  test("it refuses when no unpushed commit needs a sign-off", async () => {
    const { repos, fake } = await setup();
    const pushed = await repos.commit("a.txt", "a\n", "feat: add a", { signoff: false });
    await repos.git(["push", "origin", "feat/topic"]);
    const result = await signoffRange(argsFor("signoff", "--expect-head", pushed), configFor(repos, fake));
    expect(result).toMatchObject({ kind: "refused", code: 3 });
    expect(result.kind === "refused" ? result.reasons[0] : "").toContain("no unpushed commit needs a sign-off");
    expect(await repos.head()).toBe(pushed);
  });

  test("a head that is not the planned head, or a dirty tree, stops with exit 4", async () => {
    const { repos, fake } = await setup();
    const sha = await repos.commit("a.txt", "a\n", "feat: add a", { signoff: false });
    const wrong = await signoffRange(argsFor("signoff", "--expect-head", "b".repeat(40)), configFor(repos, fake));
    expect(wrong).toMatchObject({ kind: "refused", code: 4 });
    writeFileSync(join(repos.work, "a.txt"), "dirty\n");
    const dirty = await signoffRange(argsFor("signoff", "--expect-head", sha), configFor(repos, fake));
    expect(dirty).toMatchObject({ kind: "refused", code: 4 });
    expect(dirty.kind === "refused" ? dirty.reasons.join(" ") : "").toContain("dirty_tree");
    expect(await repos.head()).toBe(sha);
  });

  test("it never moves the default branch or a branch other than the planned one", async () => {
    const { repos, fake } = await setup();
    await repos.git(["checkout", "main"]);
    const sha = await repos.commit("a.txt", "a\n", "feat: add a", { signoff: false });
    // --branch names another push name, so the plan does not see the protected checked-out branch.
    const result = await signoffRange(argsFor("signoff", "--branch", "feat/topic", "--expect-head", sha), configFor(repos, fake));
    expect(result).toMatchObject({ kind: "refused", code: 3 });
    expect(result.kind === "refused" ? result.reasons.join(" ") : "").toContain("checked-out branch");
    expect(await repos.head()).toBe(sha);
    expect(await repos.git(["rev-parse", "refs/heads/main"])).toContain(sha);
  });

  test("a merge commit in the range is refused", async () => {
    const { repos, fake } = await setup();
    await repos.commit("a.txt", "a\n", "feat: add a", { signoff: false });
    await repos.git(["checkout", "-b", "feat/side", "main"]);
    await repos.commit("s.txt", "s\n", "feat: side");
    await repos.git(["checkout", "feat/topic"]);
    await repos.git(["merge", "--no-ff", "-m", "merge side", "feat/side"]);
    const head = await repos.head();
    const result = await signoffRange(argsFor("signoff", "--expect-head", head), configFor(repos, fake));
    expect(result).toMatchObject({ kind: "refused", code: 3 });
    expect(result.kind === "refused" ? result.reasons.join(" ") : "").toContain("merge or a root commit");
    expect(await repos.head()).toBe(head);
  });

  test("a signed commit in the rewrite range is refused", async () => {
    const { repos, fake } = await setup();
    await repos.commit("a.txt", "a\n", "feat: add a", { signoff: false });
    const parent = await repos.head();
    const tree = (await repos.git(["rev-parse", "HEAD^{tree}"])).trim();
    const raw = [`tree ${tree}`, `parent ${parent}`, "author Dev A <dev-a@example.invalid> 1700000000 +0000", "committer Dev A <dev-a@example.invalid> 1700000000 +0000", "gpgsig -----BEGIN PGP SIGNATURE-----", " ", " fake", " -----END PGP SIGNATURE-----", "", "feat: signed", ""].join("\n");
    const made = await run(["git", "hash-object", "-t", "commit", "-w", "--stdin"], { cwd: repos.work, stdin: raw });
    const signed = made.stdout.trim();
    await repos.git(["reset", "--hard", "-q", signed]);
    const result = await signoffRange(argsFor("signoff", "--expect-head", signed, "--title", "x"), configFor(repos, fake));
    expect(result).toMatchObject({ kind: "refused", code: 3 });
    expect(result.kind === "refused" ? result.reasons.join(" ") : "").toContain("signature");
    expect(await repos.head()).toBe(signed);
  });

  test("no git identity means no sign-off", async () => {
    const { repos, fake } = await setup();
    const sha = await repos.commit("a.txt", "a\n", "feat: add a", { signoff: false });
    const config = configFor(repos, fake);
    const result = await signoffRange(argsFor("signoff", "--expect-head", sha), {
      ...config,
      runRepo: async (args, options) => (args[0] === "config" ? { code: 1, stdout: "", stderr: "" } : config.runRepo(args, options)),
    });
    expect(result).toMatchObject({ kind: "refused", code: 3 });
    expect(await repos.head()).toBe(sha);
  });

  test("a git failure inside the rewrite is a refusal (exit 3), not a crash, in the library and on the command line", async () => {
    const { repos, fake } = await setup();
    const sha = await repos.commit("a.txt", "a\n", "feat: add a", { signoff: false });
    const config = configFor(repos, fake);
    const failing = {
      ...config,
      runRepo: async (args: readonly string[], options: Parameters<typeof config.runRepo>[1]) =>
        args[0] === "commit-tree" ? { code: 128, stdout: "", stderr: "fatal: boom" } : config.runRepo(args, options),
    };
    const result = await signoffRange(argsFor("signoff", "--expect-head", sha), failing);
    expect(result).toMatchObject({ kind: "refused", code: 3 });
    expect(result.kind === "refused" ? result.reasons.join(" ") : "").toContain("git commit-tree failed: fatal: boom");
    expect(await repos.head()).toBe(sha);
    const cli = await runCli(["signoff", "--json", "--expect-head", sha], repos, fake, { runRepo: failing.runRepo });
    expect(cli.code).toBe(3);
    expect(JSON.parse(cli.out)).toMatchObject({ schema: 1, mode: "signoff", refused: true, exit: 3 });
    expect(await repos.head()).toBe(sha);
  });

  test("a rebuilt commit that differs from its original stops before the branch moves", async () => {
    const { repos, fake } = await setup();
    const sha = await repos.commit("a.txt", "a\n", "feat: add a", { signoff: false });
    const config = configFor(repos, fake);
    const result = await signoffRange(argsFor("signoff", "--expect-head", sha), {
      ...config,
      // A rewrite that changes the author date.
      runRepo: (args, options) => config.runRepo(args, args[0] === "commit-tree" ? { ...options, env: { ...options.env, GIT_AUTHOR_DATE: "1600000000 +0000" } } : options),
    });
    expect(result).toMatchObject({ kind: "refused", code: 3 });
    expect(result.kind === "refused" ? result.reasons[0] : "").toContain("author name, email, or date changed");
    expect(await repos.head()).toBe(sha);
  });

  test("a mid-range commit whose tree differs stops before the branch moves", async () => {
    const { repos, fake } = await setup();
    await repos.commit("a.txt", "a\n", "feat: add a", { signoff: false });
    const tip = await repos.commit("b.txt", "b\n", "feat: add b", { signoff: false });
    const other = (await repos.git(["rev-parse", "main^{tree}"])).trim();
    const config = configFor(repos, fake);
    let calls = 0;
    const result = await signoffRange(argsFor("signoff", "--expect-head", tip), {
      ...config,
      // The first rebuilt commit gets another tree. The last one keeps its own, so only the per-commit check can see it.
      runRepo: (args, options) => {
        if (args[0] !== "commit-tree") return config.runRepo(args, options);
        calls += 1;
        // The tree is the last argument of `git commit-tree`.
        return config.runRepo(calls === 1 ? [...args.slice(0, -1), other] : args, options);
      },
    });
    expect(result).toMatchObject({ kind: "refused", code: 3 });
    expect(result.kind === "refused" ? result.reasons[0] : "").toContain("the tree changed");
    expect(await repos.head()).toBe(tip);
  });

  test("a message that differs by more than the trailer stops before the branch moves", async () => {
    const { repos, fake } = await setup();
    const sha = await repos.commit("a.txt", "a\n", "feat: add a", { signoff: false });
    const config = configFor(repos, fake);
    const result = await signoffRange(argsFor("signoff", "--expect-head", sha), {
      ...config,
      runRepo: (args, options) =>
        config.runRepo(args, args[0] === "commit-tree" && options.stdin !== undefined ? { ...options, stdin: options.stdin.replace("feat: add a", "feat: changed a") } : options),
    });
    expect(result).toMatchObject({ kind: "refused", code: 3 });
    expect(result.kind === "refused" ? result.reasons[0] : "").toContain("more than the added trailer");
    expect(await repos.head()).toBe(sha);
  });

  test("a commit that needs no trailer must keep its message", async () => {
    const { repos, fake } = await setup();
    await repos.commit("a.txt", "a\n", "feat: add a", { signoff: false });
    const tip = await repos.commit("b.txt", "b\n", "feat: add b");
    const config = configFor(repos, fake);
    let calls = 0;
    const result = await signoffRange(argsFor("signoff", "--expect-head", tip), {
      ...config,
      runRepo: (args, options) => {
        if (args[0] !== "commit-tree") return config.runRepo(args, options);
        calls += 1;
        return config.runRepo(args, calls === 2 && options.stdin !== undefined ? { ...options, stdin: options.stdin.replace("feat: add b", "feat: add B") } : options);
      },
    });
    expect(result).toMatchObject({ kind: "refused", code: 3 });
    expect(result.kind === "refused" ? result.reasons[0] : "").toContain("the message changed on a commit that needs no trailer");
    expect(await repos.head()).toBe(tip);
  });

  test("the command line prints the new head and exits 0; JSON has schema 1", async () => {
    const { repos, fake } = await setup();
    const sha = await repos.commit("a.txt", "a\n", "feat: add a", { signoff: false });
    const text = await runCli(["signoff", "--expect-head", sha], repos, fake);
    expect(text.code).toBe(0);
    expect(text.out).toContain("signed off 1 commit on feat/topic; trees unchanged");
    expect(text.out).toContain(`head: ${await repos.head()}`);
    expect(text.out).toContain("Nothing was pushed.");
    const again = await runCli(["signoff", "--expect-head", await repos.head()], repos, fake);
    expect(again.code).toBe(3);
    expect(again.err).toContain("no unpushed commit needs a sign-off");
  });

  test("JSON output", async () => {
    const { repos, fake } = await setup();
    const sha = await repos.commit("a.txt", "a\n", "feat: add a", { signoff: false });
    const out = JSON.parse((await runCli(["signoff", "--json", "--expect-head", sha], repos, fake)).out);
    expect(out).toMatchObject({ schema: 1, mode: "signoff", exit: 0, trailersAdded: 1, oldHead: sha });
  });
});

describe("rewriteRefusal", () => {
  const commit = (char: string, parents: readonly string[] = ["0"]): RangeCommit => ({
    sha: sha(char),
    tree: sha("1"),
    parents: parents.map((p) => sha(p)),
    authorName: "Dev A",
    authorEmail: "dev-a@example.invalid",
    authorDate: "1700000000 +0000",
    message: "feat: x\n",
    signed: false,
    unsupportedHeader: null,
  });
  const planOf = (...rewrite: RangeCommit[]): RewritePlan => ({ firstUnsigned: sha("a"), rewrite, needsTrailer: new Set(rewrite.map((c) => c.sha)) });

  test("a commit that the remote holds is refused with pushed_commit, naming the skill that can fix it", () => {
    const refusal = rewriteRefusal(new Set([sha("b")]))(planOf(commit("a"), commit("b", ["a"])));
    expect(refusal?.code).toBe("pushed_commit");
    expect(refusal?.headline).toContain("already on the remote branch");
    expect(refusal?.headline).toContain("bbbbbbb");
    expect(refusal?.next).toContain("tailrocks-pr-refresh");
  });

  test("a merge or a root commit is refused, and a plain local range is not", () => {
    expect(rewriteRefusal(new Set())(planOf(commit("a"), commit("c", ["a", "b"])))?.code).toBe("merge_commit");
    expect(rewriteRefusal(new Set())(planOf(commit("a", [])))?.code).toBe("merge_commit");
    expect(rewriteRefusal(new Set([sha("f")]))(planOf(commit("a"), commit("c", ["a"])))).toBeNull();
  });
});

describe("signoff text helpers", () => {
  const trailer = "Signed-off-by: A <a@example.invalid>";
  test("the trailer joins a trailer block or starts one", () => {
    expect(appendSignoff("feat: x\n", trailer)).toBe(`feat: x\n\n${trailer}\n`);
    expect(appendSignoff("feat: x\n\nBody.\n\nCo-authored-by: B <b@example.invalid>\n", trailer)).toBe(`feat: x\n\nBody.\n\nCo-authored-by: B <b@example.invalid>\n${trailer}\n`);
    expect(appendSignoff("", trailer)).toBe(`${trailer}\n`);
  });

  test("only an added trailer passes the message check", () => {
    expect(onlyTrailerAdded("feat: x\n", `feat: x\n\n${trailer}\n`, trailer)).toBe(true);
    expect(onlyTrailerAdded("feat: x\n", `feat: y\n\n${trailer}\n`, trailer)).toBe(false);
    expect(onlyTrailerAdded("feat: x\n", `feat: x\n\n${trailer}\nextra\n`, trailer)).toBe(false);
  });

  test("a commit object is parsed, and a malformed one is not", () => {
    const sha = "a".repeat(40);
    const raw = `tree ${"b".repeat(40)}\nparent ${"c".repeat(40)}\nauthor Dev <d@example.invalid> 1700000000 +0100\ncommitter Dev <d@example.invalid> 1700000000 +0100\n\nmsg\n`;
    const parsed = parseCommitObject(sha as never, raw);
    expect(parsed).toMatchObject({ authorName: "Dev", authorEmail: "d@example.invalid", authorDate: "1700000000 +0100", signed: false, unsupportedHeader: null });
    expect(parseCommitObject(sha as never, "tree nope\n\nmsg")).toBeNull();
    expect(parseCommitObject(sha as never, raw.replace("committer", "encoding latin1\ncommitter"))?.unsupportedHeader).toBe("encoding");
  });
});
