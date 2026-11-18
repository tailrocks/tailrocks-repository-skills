import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { DcoCapability, mintDcoCapability } from "../lib/dco-capability.ts";
import { pushDcoRewrite } from "../lib/git.ts";
import { checkGit, checkGitDcoPush, SafetyError } from "../lib/safety.ts";
import { type Sha } from "../lib/types.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);

function allowed(args: readonly string[]): boolean {
  return checkGit(args).allowed;
}

describe("git allow-list: accepted forms", () => {
  const accepted: readonly (readonly string[])[] = [
    ["rev-parse", "HEAD"],
    ["rev-parse", `${A}^{tree}`],
    ["rev-list", "--count", "main..HEAD"],
    ["log", "--format=%H", "-n", "5"],
    ["show", "--stat", "HEAD"],
    ["cat-file", "-p", A],
    ["merge-base", "--is-ancestor", A, B],
    ["merge-tree", "--write-tree", A, B],
    ["diff", "--name-only", "main...HEAD"],
    ["ls-files", "--others"],
    ["status", "--porcelain"],
    ["fetch", "origin", "main"],
    ["fetch", "--no-tags", "origin", "refs/pull/1/head"],
    ["merge", "--no-ff", "--signoff", "--no-edit", "origin/main"],
    ["merge", "--signoff", "origin/main"],
    ["merge", "--abort"],
    ["commit", "-s", "-m", "feat: x"],
    ["commit", "--signoff", "--allow-empty", "-m", "ci: refresh"],
    ["commit", "-m", "x", "-s"],
    ["commit-tree", A, "-p", B, "-m", "msg\n\nSigned-off-by: A <a@example.invalid>"],
    ["add", "--", "src/a.ts", "docs/b.md"],
    ["add", "src/a.ts"],
    ["checkout", "-b", "feat/new-thing"],
    ["checkout", "-b", "feat/new-thing", "origin/main"],
    ["switch", "-c", "fix/x", A],
    ["worktree", "add", "/work/tree/one", "origin/main"],
    ["worktree", "add", "--detach", "/work/tree/one", A],
    ["worktree", "add", "-b", "feat/x", "/work/tree/one", "origin/main"],
    ["worktree", "remove", "/work/tree/one"],
    ["config", "--get", "user.email"],
    ["branch", "--show-current"],
    ["symbolic-ref", "--short", "HEAD"],
    ["symbolic-ref", "refs/remotes/origin/HEAD"],
    ["push", "origin", `${A}:refs/heads/feat/x`],
    ["push", "origin", "HEAD:refs/heads/feat/x"],
  ];
  for (const args of accepted) {
    test(JSON.stringify(args), () => {
      const guard = checkGit(args);
      expect(guard.allowed ? "ok" : guard.reason).toBe("ok");
    });
  }
});

describe("git allow-list: forbidden forms are refused", () => {
  test.each([
    // push
    ["push --force", ["push", "--force", "origin", `${A}:refs/heads/x`]],
    ["push -f", ["push", "-f", "origin", `${A}:refs/heads/x`]],
    ["push --force-if-includes", ["push", "--force-if-includes", "origin", `${A}:refs/heads/x`]],
    ["push --force-with-lease through the generic guard", ["push", `--force-with-lease=x:${A}`, "origin", `${B}:refs/heads/x`]],
    ["push --delete", ["push", "--delete", "origin", "x"]],
    ["push -d", ["push", "-d", "origin", "x"]],
    ["push --mirror", ["push", "--mirror", "origin"]],
    ["push --all", ["push", "--all", "origin"]],
    ["push --tags", ["push", "--tags", "origin"]],
    ["push +refspec", ["push", "origin", `+${A}:refs/heads/x`]],
    ["push :refspec (delete)", ["push", "origin", ":refs/heads/x"]],
    ["push empty source", ["push", "origin", ":x"]],
    ["push branch name as source", ["push", "origin", "main:refs/heads/x"]],
    ["push short destination", ["push", "origin", `${A}:x`]],
    ["push to a tag ref", ["push", "origin", `${A}:refs/tags/v1`]],
    ["push set-upstream flag", ["push", "-u", "origin", `${A}:refs/heads/x`]],
    ["push URL remote", ["push", "https://example.invalid/x.git", `${A}:refs/heads/x`]],
    ["push option remote", ["push", "--receive-pack=x", `${A}:refs/heads/x`]],
    ["push no refspec", ["push", "origin"]],
    ["push two refspecs", ["push", "origin", `${A}:refs/heads/x`, `${B}:refs/heads/y`]],
    ["push bare", ["push"]],
    ["push destination with ..", ["push", "origin", `${A}:refs/heads/a/../b`]],
    ["push destination .lock", ["push", "origin", `${A}:refs/heads/x.lock`]],
    // never
    ["rebase", ["rebase", "main"]],
    ["rebase -i", ["rebase", "-i", "HEAD~3"]],
    ["reset --hard", ["reset", "--hard", "HEAD~1"]],
    ["reset", ["reset", "HEAD"]],
    ["clean", ["clean", "-fdx"]],
    ["branch -D", ["branch", "-D", "x"]],
    ["branch -d", ["branch", "-d", "x"]],
    ["branch --delete", ["branch", "--delete", "x"]],
    ["branch create", ["branch", "x"]],
    ["branch -m", ["branch", "-m", "a", "b"]],
    ["stash", ["stash"]],
    ["restore", ["restore", "."]],
    ["checkout existing branch", ["checkout", "main"]],
    ["checkout -- .", ["checkout", "--", "."]],
    ["checkout -B", ["checkout", "-B", "x"]],
    ["checkout -b with force flag", ["checkout", "-b", "x", "--force"]],
    ["switch existing", ["switch", "main"]],
    ["switch -C", ["switch", "-C", "x"]],
    ["switch --force-create", ["switch", "--force-create", "x"]],
    ["checkout -b option-like name", ["checkout", "-b", "--orphan"]],
    ["tag", ["tag", "-d", "v1"]],
    ["remote", ["remote", "add", "x", "https://example.invalid"]],
    ["gc", ["gc", "--prune=now"]],
    ["filter-branch", ["filter-branch"]],
    ["update-ref -d", ["update-ref", "-d", "refs/heads/x"]],
    ["cherry-pick", ["cherry-pick", A]],
    ["revert", ["revert", A]],
    ["pull", ["pull"]],
    ["am", ["am"]],
    ["apply", ["apply", "x.patch"]],
    ["rm", ["rm", "-rf", "."]],
    ["mv", ["mv", "a", "b"]],
    ["submodule", ["submodule", "update"]],
    ["-c config override", ["-c", "core.hooksPath=/x", "status"]],
    ["-C dir", ["-C", "/", "status"]],
    ["empty", []],
    // read-only helpers that write
    ["diff --output", ["diff", "--output=/tmp/x", "HEAD"]],
    ["log --output", ["log", "--output", "x"]],
    ["diff --ext-diff", ["diff", "--ext-diff"]],
    // config
    ["config set", ["config", "user.email", "x@example.invalid"]],
    ["config --global", ["config", "--global", "user.email", "x"]],
    ["config --unset", ["config", "--unset", "user.email"]],
    ["config --get with extra", ["config", "--get", "a", "b"]],
    ["symbolic-ref set", ["symbolic-ref", "HEAD", "refs/heads/x"]],
    ["symbolic-ref -d", ["symbolic-ref", "-d", "HEAD"]],
    // merge
    ["merge without signoff", ["merge", "--no-ff", "origin/main"]],
    ["merge --squash", ["merge", "--squash", "--signoff", "origin/main"]],
    ["merge -X theirs", ["merge", "--signoff", "-X", "theirs", "origin/main"]],
    ["merge two refs", ["merge", "--signoff", "a", "b"]],
    ["merge --abort with extra", ["merge", "--abort", "--signoff"]],
    ["merge no target", ["merge", "--signoff"]],
    // commit
    ["commit without signoff", ["commit", "-m", "x"]],
    ["commit --amend", ["commit", "--amend", "-s", "-m", "x"]],
    ["commit -a", ["commit", "-a", "-s", "-m", "x"]],
    ["commit --no-verify", ["commit", "-s", "--no-verify", "-m", "x"]],
    ["commit -sm cluster", ["commit", "-sm", "x"]],
    ["commit with pathspec", ["commit", "-s", "-m", "x", "file"]],
    ["commit -m without value", ["commit", "-s", "-m"]],
    // commit-tree
    ["commit-tree short tree", ["commit-tree", "abc123"]],
    ["commit-tree -S", ["commit-tree", "-S", A]],
    ["commit-tree two trees", ["commit-tree", A, B]],
    ["commit-tree bad parent", ["commit-tree", A, "-p", "HEAD"]],
    // add
    ["add -A", ["add", "-A"]],
    ["add --all", ["add", "--all"]],
    ["add .", ["add", "."]],
    ["add -- .", ["add", "--", "."]],
    ["add -u", ["add", "-u"]],
    ["add -f", ["add", "-f", "x"]],
    ["add glob", ["add", "src/*.ts"]],
    ["add directory", ["add", "src/"]],
    ["add parent", ["add", "../x"]],
    ["add pathspec magic", ["add", ":/"]],
    ["add nothing", ["add"]],
    ["add -- nothing", ["add", "--"]],
    // fetch
    ["fetch +refspec", ["fetch", "origin", "+refs/heads/*:refs/heads/*"]],
    ["fetch refspec with colon", ["fetch", "origin", "main:main"]],
    ["fetch --force", ["fetch", "--force", "origin"]],
    ["fetch --prune", ["fetch", "--prune", "origin"]],
    ["fetch --update-head-ok", ["fetch", "--update-head-ok", "origin", "main"]],
    ["fetch URL", ["fetch", "https://example.invalid/x.git"]],
    ["fetch no remote", ["fetch"]],
    // worktree
    ["worktree remove --force", ["worktree", "remove", "--force", "/work/tree/one"]],
    ["worktree remove relative", ["worktree", "remove", "tree"]],
    ["worktree remove glob", ["worktree", "remove", "/work/tree/*"]],
    ["worktree remove root-level", ["worktree", "remove", "/work"]],
    ["worktree remove dotdot", ["worktree", "remove", "/work/../etc"]],
    ["worktree remove trailing slash", ["worktree", "remove", "/work/tree/"]],
    ["worktree prune", ["worktree", "prune"]],
    ["worktree add --force", ["worktree", "add", "--force", "/work/tree/one", "main"]],
    ["worktree add relative", ["worktree", "add", "tree", "main"]],
    ["worktree add -B", ["worktree", "add", "-B", "x", "/work/tree/one", "main"]],
    ["worktree add no commit-ish", ["worktree", "add", "/work/tree/one"]],
  ] satisfies readonly (readonly [string, readonly string[]])[])("%s", (_name, args) => {
    expect(checkGit(args).allowed).toBe(false);
  });

  test("refusals say why", () => {
    const guard = checkGit(["rebase", "main"]);
    expect(guard.allowed ? "" : guard.reason).toContain("not in the allow-list");
  });
});

describe("DCO rewrite push", () => {
  const grant = { branch: "feat/x", oldHead: A as Sha, newHead: B as Sha };
  const capability = mintDcoCapability(grant);
  const good = ["push", `--force-with-lease=feat/x:${A}`, "origin", `${B}:refs/heads/feat/x`];

  test("passes only through its own guard and only with the exact shape", () => {
    expect(checkGitDcoPush(good, capability).allowed).toBe(true);
    expect(checkGit(good).allowed).toBe(false);
  });

  test("any deviation from the capability is refused", () => {
    const deviations: readonly (readonly string[])[] = [
      ["push", `--force-with-lease=feat/y:${A}`, "origin", `${B}:refs/heads/feat/x`],
      ["push", `--force-with-lease=feat/x:${B}`, "origin", `${B}:refs/heads/feat/x`],
      ["push", `--force-with-lease=feat/x:${A}`, "origin", `${A}:refs/heads/feat/x`],
      ["push", `--force-with-lease=feat/x:${A}`, "origin", `${B}:refs/heads/feat/y`],
      ["push", "--force", "origin", `${B}:refs/heads/feat/x`],
      ["push", "-f", `--force-with-lease=feat/x:${A}`, "origin", `${B}:refs/heads/feat/x`],
      ["push", `--force-with-lease=feat/x:${A}`, "https://example.invalid/x.git", `${B}:refs/heads/feat/x`],
      ["push", `--force-with-lease=feat/x`, "origin", `${B}:refs/heads/feat/x`],
      ["push", `--force-with-lease=feat/x:${A}`, "origin", `${B}:refs/heads/feat/x`, "--delete"],
    ];
    for (const args of deviations) {
      expect(checkGitDcoPush(args, capability).allowed).toBe(false);
    }
  });

  test("a forged capability is refused", () => {
    const forged: unknown = { grant };
    expect(forged instanceof DcoCapability).toBe(false);
    // @ts-expect-error The constructor is private: a type error blocks forgery at build time.
    expect(() => new DcoCapability(grant, Symbol("guess"))).toThrow(TypeError);
  });

  test("a capability for a bad branch is refused", () => {
    const bad = mintDcoCapability({ branch: "--delete", oldHead: A as Sha, newHead: B as Sha });
    expect(checkGitDcoPush(["push", `--force-with-lease=--delete:${A}`, "origin", `${B}:refs/heads/--delete`], bad).allowed).toBe(false);
  });

  test("pushDcoRewrite refuses before it spawns when the capability is bad", async () => {
    const bad = mintDcoCapability({ branch: "a/../b", oldHead: A as Sha, newHead: B as Sha });
    await expect(pushDcoRewrite(bad, { remote: "origin" }, { cwd: "." })).rejects.toBeInstanceOf(SafetyError);
  });

  test("only the DCO module may mint a capability", () => {
    const root = join(import.meta.dir, "..");
    const offenders: string[] = [];
    for (const dir of ["lib", "skills", "tools"]) {
      let entries;
      try {
        entries = readdirSync(join(root, dir), { recursive: true, withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".ts")) {
          continue;
        }
        const path = join(entry.parentPath, entry.name);
        if (entry.name === "dco.ts" || entry.name === "dco-capability.ts") {
          continue;
        }
        if (readFileSync(path, "utf8").includes("mintDcoCapability")) {
          offenders.push(relative(root, path));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
