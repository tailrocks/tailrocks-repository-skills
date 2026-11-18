import { afterEach, describe, expect, test, setDefaultTimeout } from "bun:test";
import { git as guardedGit } from "../lib/git.ts";
import { dcoComment } from "../lib/refresh/dco-fix.ts";
import { main } from "../lib/refresh/cli.ts";
import { fakeGithub, policyToml, REPO, sandbox, testDeps, worktreeLeftovers, type FakeOptions, type Sandbox } from "./helpers/refresh-env.ts";

// Each test makes several git repositories; give it room.
setDefaultTimeout(60_000);

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

const TRAILER = "Signed-off-by: Dev A <dev-a@example.com>";

interface Topic {
  readonly c1: string;
  readonly c2: string;
  readonly c3: string;
  readonly c4: string;
}

/** c1 signed, c2 and c3 unsigned, c4 signed. Pushed to origin/feat/topic. */
function topic(sb: Sandbox): Topic {
  const c1 = sb.commit({ "a.txt": "one\n" }, "feat: one");
  const c2 = sb.commit({ "b.txt": "two\n" }, "feat: two", { signoff: false, author: "Other Dev <other@example.com>", date: "2026-02-01T10:00:00+0100" });
  const c3 = sb.commit({ "a.txt": "one\nthree\n" }, "feat: three\n\nBody line.\n\nCo-authored-by: X <x@example.com>", {
    signoff: false,
    date: "2026-02-02T11:30:00-0500",
  });
  const c4 = sb.commit({ "c.txt": "four\n" }, "feat: four");
  sb.git(["push", "origin", "feat/topic"]);
  return { c1, c2, c3, c4 };
}

async function run(sb: Sandbox, options: FakeOptions, extra: Parameters<typeof testDeps>[2] = {}) {
  const gh = fakeGithub(sb, options);
  const { deps, gitCalls } = testDeps(sb, gh, extra);
  const lines: string[] = [];
  const code = await main(["dco-fix", "7", "--repo", REPO, "--json"], { cwd: sb.clone, deps, out: (l) => lines.push(l), err: (l) => lines.push(l) });
  const text = lines.join("\n");
  if (process.env["DBG"] !== undefined) console.log(text);
  return { gh, gitCalls, code, text, json: (): { code: string; state: string; data: Record<string, unknown>; headline: string; details: string[] } => JSON.parse(text) };
}

function log(sb: Sandbox, ref: string, format: string, cwd = sb.remote): string[] {
  return sb
    .git(["log", "--reverse", "--topo-order", `--format=${format}`, "--date=raw", ref, "^refs/heads/main"], cwd)
    .split("\x1e")
    .map((e) => e.replace(/^\n/, ""))
    .filter((e) => e !== "");
}

describe("dco-fix rewrite", () => {
  test("adds the trailer, keeps trees, authors, dates, and earlier commits", async () => {
    const sb = box();
    const t = topic(sb);
    const clonePath = sb.clone;
    const userHead = sb.git(["rev-parse", "HEAD"]).trim();
    const result = await run(sb, { policy: policyToml() });
    expect(result.text).toContain("DONE");
    expect(result.code).toBe(0);

    const newHead = sb.remoteRev("refs/heads/feat/topic");
    expect(newHead).not.toBe(t.c4);
    const before = log(sb, t.c4, "%H%x1f%T%x1f%an%x1f%ae%x1f%ad%x1f%B%x1e");
    const after = log(sb, newHead, "%H%x1f%T%x1f%an%x1f%ae%x1f%ad%x1f%B%x1e");
    expect(after.length).toBe(4);
    const rows = (entries: string[]) => entries.map((e) => e.split("\x1f"));
    const [b1, b2, b3, b4] = rows(before);
    const [a1, a2, a3, a4] = rows(after);
    // The first commit keeps its id.
    expect(a1?.[0]).toBe(t.c1);
    // Trees, authors, and dates match one to one.
    for (const [b, a] of [[b1, a1], [b2, a2], [b3, a3], [b4, a4]] as const) {
      expect(a?.slice(1, 5)).toEqual(b?.slice(1, 5));
    }
    // Messages: trailer only where it was missing.
    expect(a1?.[5]).toBe(b1?.[5]);
    expect(a2?.[5]).toBe(`feat: two\n\n${TRAILER}\n`);
    expect(a3?.[5]).toBe(`feat: three\n\nBody line.\n\nCo-authored-by: X <x@example.com>\n${TRAILER}\n`);
    expect(a4?.[5]).toBe(b4?.[5]);
    expect(a4?.[0]).not.toBe(t.c4);
    // The chain is linear on the kept commit.
    expect(sb.git(["rev-parse", `${a2?.[0]}^`], sb.remote).trim()).toBe(t.c1);
    expect(sb.git(["rev-parse", `${newHead}^{tree}`], sb.remote)).toBe(sb.git(["rev-parse", `${t.c4}^{tree}`], sb.remote));
    // No signature header on any new commit.
    for (const row of after) {
      expect(sb.git(["cat-file", "commit", row.split("\x1f")[0] ?? ""], sb.remote)).not.toContain("gpgsig");
    }
    expect(result.json().details.join("\n")).toContain('posted the PR comment: "Added missing DCO sign-off to 2 commits');
    // The comment has the exact text.
    expect(result.gh.mutations).toEqual([
      { kind: "issue-comment", repo: REPO, number: 7, body: `Added missing DCO sign-off to 2 commits; trees unchanged (old \`${t.c4}\` → new \`${newHead}\`)` },
    ]);
    // The user's checkout is untouched, and the temporary worktree is gone.
    expect(sb.git(["rev-parse", "HEAD"]).trim()).toBe(userHead);
    expect(sb.git(["status", "--porcelain"]).trim()).toBe("");
    expect(clonePath).toBe(sb.clone);
    const left = worktreeLeftovers(sb);
    expect(left.entries).toEqual([]);
    expect(left.list.split("\n").filter((l) => l.startsWith("worktree ")).length).toBe(1);
  });

  test("a clean history changes nothing", async () => {
    const sb = box();
    sb.commit({ "a.txt": "one\n" }, "feat: one");
    sb.git(["push", "origin", "feat/topic"]);
    const before = sb.remoteRev("refs/heads/feat/topic");
    const result = await run(sb, { policy: policyToml() });
    expect(result.code).toBe(0);
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(before);
    expect(result.gh.mutations).toEqual([]);
  });

  test("a merge commit above the first unsigned commit is rebuilt with the same message", async () => {
    const sb = box();
    sb.commit({ "a.txt": "one\n" }, "feat: one", { signoff: false });
    sb.git(["push", "origin", "feat/topic"]);
    const other = sb.other();
    sb.commit({ "base.txt": "b\n" }, "chore: base", { cwd: other });
    sb.git(["push", "origin", "main"], other);
    sb.git(["fetch", "origin", "main"]);
    sb.git(["merge", "--no-ff", "--signoff", "-m", "Merge main", "origin/main"]);
    sb.git(["push", "origin", "feat/topic"]);
    const oldHead = sb.remoteRev("refs/heads/feat/topic");
    const result = await run(sb, { policy: policyToml() });
    expect(result.code).toBe(0);
    const newHead = sb.remoteRev("refs/heads/feat/topic");
    expect(newHead).not.toBe(oldHead);
    expect(sb.git(["log", "-1", "--format=%B", newHead], sb.remote)).toBe(sb.git(["log", "-1", "--format=%B", oldHead], sb.remote));
    const parents = sb.git(["rev-list", "--parents", "-n", "1", newHead], sb.remote).trim().split(" ");
    expect(parents.length).toBe(3);
    expect(sb.git(["rev-parse", `${newHead}^{tree}`], sb.remote)).toBe(sb.git(["rev-parse", `${oldHead}^{tree}`], sb.remote));
    expect(sb.git(["log", "-1", "--format=%B", `${newHead}^1`], sb.remote)).toContain(TRAILER);
  });
});

describe("dco-fix refusals and aborts", () => {
  test("the remote moved before the run: abort, nothing pushed", async () => {
    const sb = box();
    const t = topic(sb);
    const other = sb.other();
    sb.git(["checkout", "-b", "feat/topic", "origin/feat/topic"], other);
    const moved = sb.commit({ "z.txt": "z\n" }, "feat: other work", { cwd: other });
    sb.git(["push", "origin", "feat/topic"], other);
    const result = await run(sb, { policy: policyToml(), state: { pinnedHead: t.c4 } });
    expect(result.code).toBe(20);
    expect(result.json().code).toBe("remote_moved");
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(moved as never);
    expect(result.gh.mutations).toEqual([]);
  });

  test("the remote moves after the last check: the lease rejects the push", async () => {
    const sb = box();
    topic(sb);
    const other = sb.other();
    sb.git(["checkout", "-b", "feat/topic", "origin/feat/topic"], other);
    let moved = "";
    const result = await run(sb, { policy: policyToml() }, {
      beforeLease: async () => {
        moved = sb.commit({ "z.txt": "z\n" }, "feat: raced work", { cwd: other });
        sb.git(["push", "origin", "feat/topic"], other);
      },
    });
    expect(result.code).toBe(20);
    expect(result.json().code).toBe("push_rejected");
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(moved as never);
    expect(result.gh.mutations).toEqual([]);
  });

  test("the PR head moves on GitHub during the run: abort before the push", async () => {
    const sb = box();
    topic(sb);
    const other = sb.other();
    sb.git(["checkout", "-b", "feat/topic", "origin/feat/topic"], other);
    let moved = false;
    const result = await run(sb, { policy: policyToml() }, {
      git: (args, options) => {
        // The first commit-tree call runs after the worktree exists and before the re-read.
        if (args[0] === "commit-tree" && !moved) {
          moved = true;
          sb.commit({ "z.txt": "z\n" }, "feat: raced", { cwd: other });
          sb.git(["push", "origin", "feat/topic"], other);
        }
        return guardedGit(args, options);
      },
    });
    expect(result.code).toBe(20);
    expect(result.json().code).toBe("head_moved");
    expect(sb.git(["log", "-1", "--format=%s", "refs/heads/feat/topic"], sb.remote).trim()).toBe("feat: raced");
    expect(result.gh.mutations).toEqual([]);
  });

  test("a protected branch is refused", async () => {
    const sb = box();
    sb.git(["checkout", "-b", "release/1"]);
    sb.commit({ "a.txt": "one\n" }, "feat: one", { signoff: false });
    sb.git(["push", "origin", "release/1"]);
    const before = sb.remoteRev("refs/heads/release/1");
    const result = await run(sb, { policy: policyToml("[branches]", 'protected = ["main", "release/*"]'), state: { headRef: "release/1" } });
    expect(result.code).toBe(20);
    expect(result.json().code).toBe("protected_branch");
    expect(sb.remoteRev("refs/heads/release/1")).toBe(before);
  });

  test.each([
    ["a GPG signature", "gpgsig -----BEGIN PGP SIGNATURE-----\n \n wsBc\n -----END PGP SIGNATURE-----"],
    ["an SSH signature", "gpgsig -----BEGIN SSH SIGNATURE-----\n \n U1NIU0lH\n -----END SSH SIGNATURE-----"],
  ])("a commit in the range with %s is refused", async (_name, header) => {
    const sb = box();
    const c1 = sb.commit({ "a.txt": "one\n" }, "feat: one", { signoff: false });
    const tree = sb.git(["rev-parse", `${c1}^{tree}`]).trim();
    const parent = sb.git(["rev-parse", `${c1}^`]).trim();
    const object = [
      `tree ${tree}`,
      `parent ${parent}`,
      "author Dev A <dev-a@example.com> 1700000000 +0000",
      "committer Dev A <dev-a@example.com> 1700000000 +0000",
      header,
      "",
      "feat: signed but no trailer",
      "",
    ].join("\n");
    const signed = sb.gitRaw(["hash-object", "-t", "commit", "-w", "--literally", "--stdin"], sb.clone, object).out.trim();
    sb.git(["update-ref", "refs/heads/feat/topic", signed]);
    sb.git(["push", "origin", "feat/topic"]);
    const before = sb.remoteRev("refs/heads/feat/topic");
    const result = await run(sb, { policy: policyToml() });
    expect(result.code).toBe(20);
    expect(result.json().code).toBe("signed_commit");
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(before);
    expect(result.gh.mutations).toEqual([]);
  });

  test("a queued PR is refused when the policy does not allow a dequeue", async () => {
    const sb = box();
    topic(sb);
    const before = sb.remoteRev("refs/heads/feat/topic");
    const result = await run(sb, { policy: policyToml(), state: { queued: true } });
    expect(result.code).toBe(20);
    expect(result.json().code).toBe("queued");
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(before);
    expect(result.gh.mutations).toEqual([]);
  });

  test("a queued PR is dequeued first when the policy allows it", async () => {
    const sb = box();
    const t = topic(sb);
    const result = await run(sb, { policy: policyToml("[dco]", "dequeue_for_fix = true"), state: { queued: true } });
    expect(result.code).toBe(0);
    expect(result.gh.mutations.map((m) => m.kind)).toEqual(["dequeuePullRequest", "issue-comment"]);
    expect(sb.remoteRev("refs/heads/feat/topic")).not.toBe(t.c4 as never);
  });

  test("a PR from a fork is refused", async () => {
    const sb = box();
    topic(sb);
    const result = await run(sb, { policy: policyToml(), state: { isCrossRepository: true } });
    expect(result.json().code).toBe("cross_repository");
  });

  test("a PR of another user is refused, a listed bot author is allowed", async () => {
    const sb = box();
    const t = topic(sb);
    const refused = await run(sb, { policy: policyToml(), state: { author: "someone-else" } });
    expect(refused.json().code).toBe("not_owner");
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(t.c4 as never);
    const allowed = await run(sb, { policy: policyToml("[dco]", 'bot_authors = ["dep-bot[bot]"]'), state: { author: "dep-bot[bot]" } });
    expect(allowed.code).toBe(0);
  });

  test("the policy can turn the rewrite off", async () => {
    const sb = box();
    topic(sb);
    const result = await run(sb, { policy: policyToml("[dco]", 'fix = "report"') });
    expect(result.json().code).toBe("policy_report_only");
  });

  test("bot commits are exempt by default and rewritten when the policy says so", async () => {
    const sb = box();
    sb.commit({ "bot.txt": "bot\n" }, "chore: bump", { signoff: false, author: "Bot <bot@example.com>" });
    sb.commit({ "a.txt": "one\n" }, "feat: one", { signoff: false });
    sb.git(["push", "origin", "feat/topic"]);
    const logins = { "bot@example.com": "dep-bot[bot]" };
    const exempt = await run(sb, { policy: policyToml("[dco]", 'bot_authors = ["dep-bot[bot]"]'), state: { logins } });
    expect(exempt.code).toBe(0);
    const messages = sb.git(["log", "--reverse", "--format=%B%x1e", "refs/heads/feat/topic", "^refs/heads/main"], sb.remote).split("\x1e").filter((m) => m.trim() !== "");
    expect(messages[0]).toBe("chore: bump\n");
    expect(messages[1]).toContain(TRAILER);

    const sb2 = box();
    sb2.commit({ "bot.txt": "bot\n" }, "chore: bump", { signoff: false, author: "Bot <bot@example.com>" });
    sb2.git(["push", "origin", "feat/topic"]);
    const rewrite = await run(sb2, { policy: policyToml("[dco]", 'bot_authors = ["dep-bot[bot]"]', 'bot_commits = "rewrite"'), state: { logins } });
    expect(rewrite.code).toBe(0);
    expect(rewrite.text).toContain("bot commits were rewritten");
    expect(sb2.git(["log", "-1", "--format=%B", "refs/heads/feat/topic"], sb2.remote)).toContain(TRAILER);
  });

  test("a rewrite that fails verification pushes nothing", async () => {
    const sb = box();
    const t = topic(sb);
    // A runner that tampers with the message that commit-tree reads.
    const tamper: Parameters<typeof testDeps>[2] = {
      git: (args, options) => {
        if (args[0] === "commit-tree" && options.stdin !== undefined && options.stdin.includes("feat: two")) {
          return guardedGit(args, { ...options, stdin: `${options.stdin}extra line\n` });
        }
        return guardedGit(args, options);
      },
    };
    const result = await run(sb, { policy: policyToml() }, tamper);
    expect(result.code).toBe(20);
    expect(result.json().code).toBe("verification_failed");
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(t.c4 as never);
    expect(result.gitCalls.some((a) => a[0] === "push")).toBe(false);
  });

  test("a rewrite that changes a tree pushes nothing", async () => {
    const sb = box();
    const t = topic(sb);
    const empty = sb.git(["hash-object", "-t", "tree", "-w", "--stdin"], sb.clone).trim();
    const result = await run(sb, { policy: policyToml() }, {
      git: (args, options) => {
        const last = args[args.length - 1];
        if (args[0] === "commit-tree" && last !== undefined && last === sb.git(["rev-parse", `${t.c3}^{tree}`]).trim()) {
          return guardedGit([...args.slice(0, -1), empty], options);
        }
        return guardedGit(args, options);
      },
    });
    expect(result.json().code).toBe("verification_failed");
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(t.c4 as never);
  });
});

function rawCommit(sb: Sandbox, parent: string, tree: string, message: Buffer, author = "Dev A <dev-a@example.com>"): string {
  const head = Buffer.from(`tree ${tree}\nparent ${parent}\nauthor ${author} 1700000000 +0000\ncommitter ${author} 1700000000 +0000\n\n`);
  const proc = Bun.spawnSync({ cmd: ["git", "hash-object", "-t", "commit", "-w", "--literally", "--stdin"], cwd: sb.clone, stdin: Buffer.concat([head, message]), stdout: "pipe", stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString());
  const sha = proc.stdout.toString().trim();
  sb.git(["update-ref", "refs/heads/feat/topic", sha]);
  sb.git(["push", "origin", "feat/topic"]);
  return sha;
}

function treeOf(sb: Sandbox, rev: string): string {
  return sb.git(["rev-parse", `${rev}^{tree}`]).trim();
}

describe("dco-fix message bytes and sign-off identity", () => {
  test("a message that is not valid UTF-8 is refused and nothing is pushed", async () => {
    const sb = box();
    const base = sb.git(["rev-parse", "HEAD"]).trim();
    const sha = rawCommit(sb, base, treeOf(sb, "HEAD"), Buffer.concat([Buffer.from("feat: caf"), Buffer.from([0xe9]), Buffer.from("\n")]));
    const result = await run(sb, { policy: policyToml() });
    expect(result.code).toBe(20);
    expect(result.json().code).toBe("non_utf8_commit");
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(sha as never);
    expect(result.gh.mutations).toEqual([]);
  });

  test("a valid UTF-8 message keeps its bytes and gains only the trailer bytes", async () => {
    const sb = box();
    const base = sb.git(["rev-parse", "HEAD"]).trim();
    const original = Buffer.from("feat: caf\u00e9 \ud83d\ude80\n\nbody \u00fc\n");
    rawCommit(sb, base, treeOf(sb, "HEAD"), original);
    const result = await run(sb, { policy: policyToml() });
    expect(result.code).toBe(0);
    const head = sb.remoteRev("refs/heads/feat/topic");
    const bytes = Bun.spawnSync(["git", "cat-file", "commit", head], { cwd: sb.remote }).stdout;
    const message = Buffer.from(bytes).subarray(Buffer.from(bytes).indexOf("\n\n") + 2);
    expect(message.equals(Buffer.concat([original.subarray(0, original.length - 1), Buffer.from(`\n\n${TRAILER}\n`)]))).toBe(true);
  });

  test("a sign-off of another identity counts as signed, and the report names the commit", async () => {
    const sb = box();
    const sha = sb.commit({ "a.txt": "one\n" }, "feat: one\n\nSigned-off-by: Someone Else <else@example.com>", { signoff: false, author: "Other Dev <other@example.com>" });
    sb.git(["push", "origin", "feat/topic"]);
    const result = await run(sb, { policy: policyToml() });
    expect(result.code).toBe(0);
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(sha as never);
    expect(result.json().data["signoffMismatch"]).toEqual([sha.slice(0, 12)]);
    expect(result.text).toContain("another identity than the author");
  });
});

describe("dco comment text", () => {
  test("uses the exact words", () => {
    expect(dcoComment(3, "aaa", "bbb")).toBe("Added missing DCO sign-off to 3 commits; trees unchanged (old `aaa` → new `bbb`)");
    expect(dcoComment(1, "aaa", "bbb")).toContain("to 1 commit;");
  });
});
