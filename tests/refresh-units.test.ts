import { afterEach, describe, expect, test, setDefaultTimeout } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  appendSignoff,
  dcoRefusal,
  onlyTrailerAdded,
  parseCommitObject,
  planRewrite,
  verifyRewrite,
  type RangeCommit,
} from "../lib/dco.ts";
import { main, parseArgs } from "../lib/refresh/cli.ts";
import { writeRefusal } from "../lib/refresh/gate.ts";
import { guardedGit, repoAt } from "../lib/refresh/gitx.ts";
import { inventoryMisses } from "../lib/refresh/steps.ts";
import { withWorktree } from "../lib/refresh/worktree.ts";
import type { Sha } from "../lib/types.ts";
import { sandbox, type Sandbox } from "./helpers/refresh-env.ts";
import { green, policyFromText, sha } from "./helpers/status.ts";

// Each test makes several git repositories; give it room.
setDefaultTimeout(60_000);

const TRAILER = "Signed-off-by: Dev A <dev-a@example.com>";
const made: Sandbox[] = [];
afterEach(() => {
  for (const sb of made.splice(0)) {
    sb.cleanup();
  }
});

describe("appendSignoff and onlyTrailerAdded", () => {
  test.each([
    ["subject only", "feat: x\n", `feat: x\n\n${TRAILER}\n`],
    ["subject and body", "feat: x\n\nbody\n", `feat: x\n\nbody\n\n${TRAILER}\n`],
    ["an existing trailer block", "feat: x\n\nbody\n\nCo-authored-by: A <a@x.org>\n", `feat: x\n\nbody\n\nCo-authored-by: A <a@x.org>\n${TRAILER}\n`],
    ["trailing blank lines", "feat: x\n\n\n", `feat: x\n\n${TRAILER}\n`],
    ["no final newline", "feat: x", `feat: x\n\n${TRAILER}\n`],
    ["an empty message", "", `${TRAILER}\n`],
  ])("%s", (_name, before, after) => {
    expect(appendSignoff(before, TRAILER)).toBe(after);
    expect(onlyTrailerAdded(before, after, TRAILER)).toBe(true);
  });

  test("any other difference is not a trailer-only change", () => {
    expect(onlyTrailerAdded("feat: x\n", `feat: y\n\n${TRAILER}\n`, TRAILER)).toBe(false);
    expect(onlyTrailerAdded("feat: x\n", `feat: x\n\nextra\n${TRAILER}\n`, TRAILER)).toBe(false);
    expect(onlyTrailerAdded("feat: x\n", "feat: x\n", TRAILER)).toBe(false);
    expect(onlyTrailerAdded("feat: x\n", `feat: x\n\n${TRAILER}\n${TRAILER}\n`, TRAILER)).toBe(false);
  });
});

describe("parseCommitObject", () => {
  const object = (extra: string) =>
    [
      `tree ${"1".repeat(40)}`,
      `parent ${"2".repeat(40)}`,
      "author A B <a@x.org> 1700000000 +0100",
      "committer A B <a@x.org> 1700000001 +0100",
      extra,
      "",
      "msg",
      "",
    ]
      .filter((l) => l !== null)
      .join("\n");

  test("reads the fields", () => {
    const c = parseCommitObject(sha("a"), object("encoding latin1").replace("encoding latin1\n", ""));
    expect(c?.authorName).toBe("A B");
    expect(c?.authorDate).toBe("1700000000 +0100");
    expect(c?.message).toBe("msg\n");
    expect(c?.signed).toBe(false);
    expect(c?.unsupportedHeader).toBeNull();
  });

  test("flags signatures and headers that a rewrite would drop", () => {
    expect(parseCommitObject(sha("a"), object("gpgsig -----BEGIN PGP SIGNATURE-----\n x\n -----END PGP SIGNATURE-----"))?.signed).toBe(true);
    expect(parseCommitObject(sha("a"), object("gpgsig-sha256 abc"))?.signed).toBe(true);
    expect(parseCommitObject(sha("a"), object("mergetag object abc\n type commit"))?.signed).toBe(true);
    expect(parseCommitObject(sha("a"), object("encoding latin1"))?.unsupportedHeader).toBe("encoding");
  });

  test("a malformed object gives null", () => {
    expect(parseCommitObject(sha("a"), "tree nope\n\nmsg")).toBeNull();
  });
});

function commit(id: string, parents: readonly string[], message: string, patch: Partial<RangeCommit> = {}): RangeCommit {
  return {
    sha: sha(id),
    tree: sha("9"),
    parents: parents.map(sha),
    authorName: "A",
    authorEmail: "a@x.org",
    authorDate: "1700000000 +0000",
    message,
    signed: false,
    unsupportedHeader: null,
    ...patch,
  };
}

describe("planRewrite and verifyRewrite", () => {
  const range = [commit("1", ["0"], `a\n\n${TRAILER}\n`), commit("2", ["1"], "b\n"), commit("3", ["2"], `c\n\n${TRAILER}\n`)];
  const needs = (c: RangeCommit): boolean => !c.message.includes("Signed-off-by");

  test("the rewrite starts at the first unsigned commit and keeps the earlier ones", () => {
    const plan = planRewrite(range, needs);
    expect(plan?.rewrite.map((c) => c.sha)).toEqual([sha("2"), sha("3")]);
    expect([...(plan?.needsTrailer ?? [])]).toEqual([sha("2")]);
    expect(planRewrite([range[0] as RangeCommit], needs)).toBeNull();
  });

  function good() {
    const plan = planRewrite(range, needs);
    if (plan === null) throw new Error("no plan");
    const n2 = commit("b", ["1"], `b\n\n${TRAILER}\n`);
    const n3 = commit("c", ["b"], `c\n\n${TRAILER}\n`);
    const mapping = new Map<Sha, Sha>([[sha("2"), sha("b")], [sha("3"), sha("c")]]);
    const rebuilt = new Map<Sha, RangeCommit>([[sha("b"), n2], [sha("c"), n3]]);
    return { plan, mapping, rebuilt };
  }

  test("accepts a faithful rewrite", () => {
    const { plan, mapping, rebuilt } = good();
    expect(verifyRewrite(plan, rebuilt, mapping, TRAILER, sha("3"))).toBeNull();
  });

  test.each([
    ["a changed tree", (m: Map<Sha, RangeCommit>) => m.set(sha("b"), commit("b", ["1"], `b\n\n${TRAILER}\n`, { tree: sha("8") })), "tree"],
    ["a changed author", (m: Map<Sha, RangeCommit>) => m.set(sha("b"), commit("b", ["1"], `b\n\n${TRAILER}\n`, { authorEmail: "z@x.org" })), "author"],
    ["a changed author date", (m: Map<Sha, RangeCommit>) => m.set(sha("b"), commit("b", ["1"], `b\n\n${TRAILER}\n`, { authorDate: "1700000001 +0000" })), "author"],
    ["an extra message line", (m: Map<Sha, RangeCommit>) => m.set(sha("b"), commit("b", ["1"], `b\n\nmore\n${TRAILER}\n`)), "message"],
    ["a missing trailer", (m: Map<Sha, RangeCommit>) => m.set(sha("b"), commit("b", ["1"], "b\n")), "message"],
    ["a changed message on a signed commit", (m: Map<Sha, RangeCommit>) => m.set(sha("c"), commit("c", ["b"], `c2\n\n${TRAILER}\n`)), "message"],
    ["a signature", (m: Map<Sha, RangeCommit>) => m.set(sha("b"), commit("b", ["1"], `b\n\n${TRAILER}\n`, { signed: true })), "signature"],
    ["a wrong parent", (m: Map<Sha, RangeCommit>) => m.set(sha("c"), commit("c", ["2"], `c\n\n${TRAILER}\n`)), "parents"],
    ["a changed first parent", (m: Map<Sha, RangeCommit>) => m.set(sha("b"), commit("b", ["7"], `b\n\n${TRAILER}\n`)), "parents"],
  ])("rejects %s", (_name, tamper, word) => {
    const { plan, mapping, rebuilt } = good();
    tamper(rebuilt);
    expect(verifyRewrite(plan, rebuilt, mapping, TRAILER, sha("3"))).toContain(word);
  });

  test("rejects a merge whose second parent changed or whose parents are swapped or extra", () => {
    const merge = [commit("1", ["0"], `a\n\n${TRAILER}\n`), commit("2", ["1"], "b\n"), commit("4", ["2", "7"], "Merge\n")];
    const plan = planRewrite(merge, (c) => c.parents.length <= 1 && needs(c));
    if (plan === null) throw new Error("no plan");
    const mapping = new Map<Sha, Sha>([[sha("2"), sha("b")], [sha("4"), sha("d")]]);
    const rebuilt = (parents: readonly string[]) =>
      new Map<Sha, RangeCommit>([[sha("b"), commit("b", ["1"], `b\n\n${TRAILER}\n`)], [sha("d"), commit("d", parents, "Merge\n")]]);
    expect(verifyRewrite(plan, rebuilt(["b", "7"]), mapping, TRAILER, sha("4"))).toBeNull();
    expect(verifyRewrite(plan, rebuilt(["7", "b"]), mapping, TRAILER, sha("4"))).toContain("parents");
    expect(verifyRewrite(plan, rebuilt(["b", "8"]), mapping, TRAILER, sha("4"))).toContain("parents");
    expect(verifyRewrite(plan, rebuilt(["b"]), mapping, TRAILER, sha("4"))).toContain("parents");
    expect(verifyRewrite(plan, rebuilt(["b", "7", "8"]), mapping, TRAILER, sha("4"))).toContain("parents");
  });

  test("rejects a different count", () => {
    const { plan, mapping, rebuilt } = good();
    rebuilt.delete(sha("c"));
    expect(verifyRewrite(plan, rebuilt, mapping, TRAILER, sha("3"))).toContain("expected 2");
  });
});

describe("refusals", () => {
  const policy = (text = "schema = 1\n") => policyFromText(text);

  test.each([
    ["the default branch", { headRef: "main" }, "protected_branch"],
    ["a protected glob", { headRef: "release/1" }, "protected_branch"],
    ["a fork", { isCrossRepository: true }, "cross_repository"],
    ["another author", { author: "someone" }, "not_owner"],
    ["a closed PR", { state: "CLOSED" as const }, "pr_not_open"],
  ])("refuses %s", (_name, patch, code) => {
    const p = policy('schema = 1\n[branches]\nprotected = ["main", "release/*"]\n');
    expect(writeRefusal(green({ author: "user-a", ...patch }), p, "user-a", { allowQueued: false })?.code).toBe(code);
    expect(dcoRefusal(green({ author: "user-a", ...patch }), p, "user-a")?.code).toBe(code);
  });

  test("a queued PR is refused unless the policy allows the dequeue", () => {
    const queue = { id: "Q", position: 1, state: "QUEUED" as const, jump: false, enqueuedAt: "2026-01-01T00:00:00Z" };
    const snapshot = green({ author: "user-a", queueEntry: queue });
    expect(dcoRefusal(snapshot, policy(), "user-a")?.code).toBe("queued");
    expect(dcoRefusal(snapshot, policy("schema = 1\n[dco]\ndequeue_for_fix = true\n"), "user-a")).toBeNull();
    expect(writeRefusal(snapshot, policy("schema = 1\n[dco]\ndequeue_for_fix = true\n"), "user-a", { allowQueued: false })?.code).toBe("queued");
  });

  test("a listed bot author may own the PR; the gh user may own it", () => {
    expect(dcoRefusal(green({ author: "bot[bot]" }), policy('schema = 1\n[dco]\nbot_authors = ["bot[bot]"]\n'), "user-a")).toBeNull();
    expect(dcoRefusal(green({ author: "User-A" }), policy(), "user-a")).toBeNull();
  });

  test("a cut-off commit list is refused", () => {
    expect(dcoRefusal(green({ author: "user-a", commitsTruncated: true }), policy(), "user-a")?.code).toBe("unknown_state");
  });
});

describe("inventoryMisses", () => {
  const inventory = {
    name: "i",
    file: "docs/inv.txt",
    added: ["src/**"],
    exclude: ["**/tests/**"],
    group_depth: 2,
    update: [],
  };

  test("enforces only for groups that the inventory already lists", () => {
    const text = "src/a/one.txt\n";
    expect(inventoryMisses(inventory, ["src/a/two.txt", "src/b/new.txt", "src/a/tests/t.txt", "README.md"], text)).toEqual(["src/a/two.txt"]);
  });

  test("a named file is not a miss, in any list format", () => {
    expect(inventoryMisses(inventory, ["src/a/two.txt"], '- "src/a/one.txt",\n- "src/a/two.txt",\n')).toEqual([]);
  });

  test("a longer path does not count as naming a shorter one", () => {
    expect(inventoryMisses(inventory, ["src/a/two.txt"], "src/a/one.txt\nsrc/a/two.txt.bak\n")).toEqual(["src/a/two.txt"]);
  });
});

describe("parseArgs", () => {
  const ok = (argv: readonly string[]) => {
    const r = parseArgs(argv);
    if (!r.ok) throw new Error(r.message);
    return r.args;
  };

  test("modes and options", () => {
    expect(ok(["sync", "12", "--fresh-ci", "--run-ci", "--repo", "example-org/example-repo"]).command).toEqual({ mode: "sync", freshCi: true, runCi: true, keepWorktree: false });
    expect(ok(["dco-fix", "#3"]).number).toBe(3);
    expect(ok(["metadata", "4", "show"]).command).toEqual({ mode: "metadata-show" });
    expect(ok(["metadata", "4", "write", "--title", "t", "--expect-head", "a".repeat(40), "--expect-state", "b".repeat(16)]).command).toMatchObject({ mode: "metadata-write", title: "t", bodyFile: null });
    expect(ok(["sync", "1"]).remote).toBe("origin");
  });

  test("--help and -h exit 0 and print the usage", async () => {
    for (const flag of ["--help", "-h"]) {
      const lines: string[] = [];
      const code = await main([flag], { out: (l) => lines.push(l), err: (l) => lines.push(`ERR ${l}`) });
      expect(code).toBe(0);
      expect(lines.join("\n")).toContain("usage:");
      expect(lines.join("\n")).not.toContain("ERR");
    }
    expect(await main(["sync", "--help"], { out: () => undefined, err: () => undefined })).toBe(0);
  });

  test("continue and abort need the absolute worktree path; --keep-worktree belongs to sync", () => {
    expect(ok(["continue", "5", "--worktree", "/tmp/pr-refresh-x/work"]).command).toEqual({ mode: "continue", worktree: "/tmp/pr-refresh-x/work", runCi: false });
    expect(ok(["abort", "5", "--worktree", "/tmp/pr-refresh-x/work"]).command).toEqual({ mode: "abort", worktree: "/tmp/pr-refresh-x/work" });
    expect(ok(["sync", "5", "--keep-worktree"]).command).toMatchObject({ keepWorktree: true });
    expect(parseArgs(["continue", "5"]).ok).toBe(false);
    expect(parseArgs(["continue", "5", "--worktree", "relative"]).ok).toBe(false);
    expect(parseArgs(["abort", "5", "--worktree", "/x", "--fresh-ci"]).ok).toBe(false);
    expect(parseArgs(["dco-fix", "5", "--keep-worktree"]).ok).toBe(false);
  });

  test("metadata write needs --expect-state", () => {
    expect(parseArgs(["metadata", "1", "write", "--title", "t", "--expect-head", "a".repeat(40)]).ok).toBe(false);
    expect(parseArgs(["metadata", "1", "write", "--title", "t", "--expect-head", "a".repeat(40), "--expect-state", "short"]).ok).toBe(false);
  });

  test.each([
    [[]],
    [["sync"]],
    [["merge", "1"]],
    [["sync", "1", "--force"]],
    [["dco-fix", "1", "--fresh-ci"]],
    [["metadata", "1"]],
    [["metadata", "1", "write", "--title", "t"]],
    [["metadata", "1", "write", "--expect-head", "abc", "--title", "t"]],
    [["metadata", "1", "write", "--expect-head", "a".repeat(40)]],
    [["metadata", "1", "write", "--expect-head", "a".repeat(40), "--body-file", "relative.md"]],
    [["sync", "1", "--worktree-root", "relative"]],
    [["sync", "1", "--repo"]],
  ])("rejects %j", (argv) => {
    expect(parseArgs(argv).ok).toBe(false);
  });
});

describe("withWorktree", () => {
  test("removes a dirty worktree and its admin entry, also when the work throws", async () => {
    const sb = sandbox();
    made.push(sb);
    sb.commit({ "a.txt": "one\n" }, "feat: one");
    const head = sb.git(["rev-parse", "HEAD"]).trim() as Sha;
    let path = "";
    await expect(
      withWorktree({ cwd: sb.clone, root: sb.worktreeRoot, runner: guardedGit }, head, async (w) => {
        path = w.path;
        expect(existsSync(join(w.path, "a.txt"))).toBe(true);
        writeFileSync(join(w.path, "untracked.txt"), "x\n");
        writeFileSync(join(w.path, "a.txt"), "dirty\n");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(path).not.toBe("");
    expect(existsSync(path)).toBe(false);
    expect(sb.git(["worktree", "list", "--porcelain"]).split("\n").filter((l) => l.startsWith("worktree ")).length).toBe(1);
    expect(sb.git(["status", "--porcelain"]).trim()).toBe("");
    expect(Bun.spawnSync(["ls", sb.worktreeRoot]).stdout.toString().trim()).toBe("");
  });

  test("a clean worktree is removed through git", async () => {
    const sb = sandbox();
    made.push(sb);
    const head = sb.git(["rev-parse", "HEAD"]).trim() as Sha;
    const seen: string[][] = [];
    await withWorktree(
      { cwd: sb.clone, root: sb.worktreeRoot, runner: (args, options) => (seen.push([...args]), guardedGit(args, options)) },
      head,
      async (w) => {
        expect(await repoAt(w.path, guardedGit).run(["rev-parse", "HEAD"])).toMatchObject({ code: 0 });
      },
    );
    expect(seen.some((a) => a[0] === "worktree" && a[1] === "remove")).toBe(true);
    expect(Bun.spawnSync(["ls", sb.worktreeRoot]).stdout.toString().trim()).toBe("");
  });

  test("the temporary directory sits under the given root", async () => {
    const sb = sandbox();
    made.push(sb);
    const head = sb.git(["rev-parse", "HEAD"]).trim() as Sha;
    const root = mkdtempSync(join(tmpdir(), "refresh-root-"));
    try {
      let seen = "";
      await withWorktree({ cwd: sb.clone, root, runner: guardedGit }, head, async (w) => {
        seen = w.path;
      });
      expect(seen.startsWith(`${realpathSync(root)}/pr-refresh-`)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("outcome codes and the git environment", () => {
  test("every outcome code that the script can emit is documented", () => {
    const root = join(import.meta.dir, "..");
    const doc = readFileSync(join(root, "skills", "tailrocks-pr-refresh", "references", "outcome-codes.md"), "utf8");
    const sources = [...readdirSync(join(root, "lib", "refresh")).map((f) => join(root, "lib", "refresh", f)), join(root, "lib", "dco.ts")];
    const codes = new Set<string>();
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/(?:blocked|aborted|refused)\(\s*(?:\{\s*code:\s*)?"([a-z_]+)"|\bcode:\s*"([a-z_]+)"|\bcode = "([a-z_]+)"/g)) {
        const code = match[1] ?? match[2] ?? match[3];
        if (code !== undefined && code !== "usage" && code !== "ok") {
          codes.add(code);
        }
      }
    }
    expect(codes.size).toBeGreaterThan(30);
    const missing = [...codes].filter((code) => !doc.includes(`\`${code}\``));
    expect(missing).toEqual([]);
  });

  test("the refresh git environment turns hooks off and leaves signing alone", async () => {
    const { REFRESH_GIT_ENV } = await import("../lib/refresh/gitx.ts");
    const text = JSON.stringify(REFRESH_GIT_ENV);
    expect(text).toContain("core.hooksPath");
    expect(text).not.toContain("gpgsign");
  });
});

describe("the DCO module is the only force-push path", () => {
  test("no other file calls the lease push", () => {
    const root = join(import.meta.dir, "..");
    const offenders: string[] = [];
    for (const dir of ["lib", "skills", "tools"]) {
      for (const entry of readdirSync(join(root, dir), { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name === "dco.ts" || entry.name === "git.ts") {
          continue;
        }
        const path = join(entry.parentPath, entry.name);
        if (/pushDcoRewrite\(|--force-with-lease=/.test(readFileSync(path, "utf8")) && !/safety-git\.ts$/.test(path)) {
          offenders.push(relative(root, path));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
