// Allow-list guard for `git` (design section 8).
//
// Only the listed subcommands run, and each one only in the listed shapes.
// There is no rebase, reset, clean, stash, tag, or branch deletion. A push
// has exactly one shape. The one force-with-lease shape needs a capability
// that only the DCO module mints.

import { DcoCapability } from "./dco-capability.ts";
import { ALLOWED, type Guard, isFlag, refuse } from "./guard.ts";
import { isSha } from "./types.ts";

const READ_ONLY: ReadonlySet<string> = new Set([
  "rev-parse",
  "rev-list",
  "log",
  "show",
  "cat-file",
  "merge-base",
  "merge-tree",
  "diff",
  "ls-files",
  "status",
]);

// Flags that write files or run helper programs, refused for read-only commands.
const READ_ONLY_REFUSED = /^(?:--output(?:=.*)?|--ext-diff|--open-files-in-pager(?:=.*)?|--no-index|--exec(?:=.*)?|--upload-pack(?:=.*)?)$/;

const REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const BRANCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const REV_NAME = /^[A-Za-z0-9_][A-Za-z0-9_./@{}^~-]*$/;
const CONFIG_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const GLOB_CHARS = /[*?[\]{}]/;
const ABSOLUTE_PATH = /^\/[A-Za-z0-9._+@=/-]+$/;

function isBranchName(name: string): boolean {
  return (
    BRANCH_NAME.test(name) &&
    !name.includes("..") &&
    !name.includes("//") &&
    !name.endsWith("/") &&
    !name.endsWith(".") &&
    !name.endsWith(".lock") &&
    !name.includes("/.") &&
    !name.includes("@{")
  );
}

function isRev(name: string): boolean {
  return REV_NAME.test(name) && !name.includes("..");
}

function isExactAbsolutePath(path: string): boolean {
  if (!ABSOLUTE_PATH.test(path) || path.endsWith("/") || path.includes("//")) {
    return false;
  }
  const segments = path.split("/").filter((s) => s.length > 0);
  return segments.length >= 2 && !segments.some((s) => s === "." || s === "..");
}

function checkReadOnly(sub: string, rest: readonly string[]): Guard {
  for (const token of rest) {
    if (READ_ONLY_REFUSED.test(token)) {
      return refuse(`git ${sub} flag ${token} is not allowed`);
    }
  }
  return ALLOWED;
}

function checkPush(rest: readonly string[]): Guard {
  const [remote, refspec, extra] = rest;
  if (remote === undefined || refspec === undefined || extra !== undefined) {
    return refuse("git push must be exactly: push <remote> <sha>:refs/heads/<branch>");
  }
  if (!REMOTE_NAME.test(remote)) {
    return refuse("git push remote must be a plain remote name");
  }
  const colon = refspec.indexOf(":");
  if (colon <= 0) {
    return refuse("git push refspec needs a non-empty source");
  }
  const source = refspec.slice(0, colon);
  const destination = refspec.slice(colon + 1);
  // HEAD is a moving source: the caller resolves it to a commit id first.
  if (!isSha(source)) {
    return refuse("git push source must be a 40-hex commit id");
  }
  if (!destination.startsWith("refs/heads/") || !isBranchName(destination.slice("refs/heads/".length))) {
    return refuse("git push destination must be refs/heads/<branch>");
  }
  return ALLOWED;
}

/** Decide whether a DCO rewrite push may run with this capability. */
export function checkGitDcoPush(args: readonly string[], capability: DcoCapability): Guard {
  if (!(capability instanceof DcoCapability)) {
    return refuse("force-with-lease push needs a DCO capability");
  }
  const { branch, oldHead, newHead } = capability.grant;
  const expected = [
    "push",
    `--force-with-lease=${branch}:${oldHead}`,
    args[2] ?? "",
    `${newHead}:refs/heads/${branch}`,
  ];
  const remote = args[2];
  if (
    args.length !== 4 ||
    remote === undefined ||
    !REMOTE_NAME.test(remote) ||
    args.some((token, index) => token !== expected[index])
  ) {
    return refuse("DCO push must be: push --force-with-lease=<branch>:<old> <remote> <new>:refs/heads/<branch>");
  }
  if (!isBranchName(branch) || !isSha(oldHead) || !isSha(newHead)) {
    return refuse("DCO capability holds an invalid branch or commit id");
  }
  return ALLOWED;
}

function checkMerge(rest: readonly string[]): Guard {
  if (rest.length === 1 && rest[0] === "--abort") {
    return ALLOWED;
  }
  let signoff = false;
  const positionals: string[] = [];
  for (const token of rest) {
    if (token === "--signoff") {
      signoff = true;
    } else if (token === "--no-ff" || token === "--no-edit") {
      continue;
    } else if (isFlag(token)) {
      return refuse(`git merge flag ${token} is not in the allow-list`);
    } else {
      positionals.push(token);
    }
  }
  if (!signoff) {
    return refuse("git merge needs --signoff");
  }
  const [target, ...more] = positionals;
  if (target === undefined || more.length > 0 || !isRev(target)) {
    return refuse("git merge needs exactly one plain commit-ish");
  }
  return ALLOWED;
}

function checkCommit(rest: readonly string[]): Guard {
  let signoff = false;
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i] ?? "";
    if (token === "-s" || token === "--signoff") {
      signoff = true;
    } else if (token === "--allow-empty" || token === "--no-edit") {
      continue;
    } else if (token === "-m" || token === "--message" || token === "-F" || token === "--file") {
      i += 1;
      if (rest[i] === undefined) {
        return refuse(`git commit flag ${token} needs a value`);
      }
    } else if (token.startsWith("--message=") || token.startsWith("--file=")) {
      continue;
    } else {
      return refuse(`git commit argument ${token} is not in the allow-list`);
    }
  }
  return signoff ? ALLOWED : refuse("git commit needs -s or --signoff");
}

function checkCommitTree(rest: readonly string[]): Guard {
  let tree: string | null = null;
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i] ?? "";
    if (token === "-p") {
      i += 1;
      if (!isSha(rest[i] ?? "")) {
        return refuse("git commit-tree parent must be a 40-hex commit id");
      }
    } else if (token === "-m" || token === "-F") {
      i += 1;
      if (rest[i] === undefined) {
        return refuse(`git commit-tree flag ${token} needs a value`);
      }
    } else if (isFlag(token)) {
      return refuse(`git commit-tree flag ${token} is not in the allow-list`);
    } else if (tree === null && isSha(token)) {
      tree = token;
    } else {
      return refuse("git commit-tree needs exactly one 40-hex tree id");
    }
  }
  return tree === null ? refuse("git commit-tree needs a tree id") : ALLOWED;
}

function checkAdd(rest: readonly string[]): Guard {
  const paths = rest[0] === "--" ? rest.slice(1) : rest;
  if (paths.length === 0) {
    return refuse("git add needs explicit paths");
  }
  for (const path of paths) {
    if (isFlag(path)) {
      return refuse(`git add flag ${path} is not allowed; pass explicit paths only`);
    }
    if (
      path === "." ||
      path === ".." ||
      path === "./" ||
      path.endsWith("/") ||
      path.startsWith(":") ||
      path.includes("\0") ||
      GLOB_CHARS.test(path) ||
      path.split("/").includes("..")
    ) {
      return refuse(`git add path "${path}" is not an explicit file path`);
    }
  }
  return ALLOWED;
}

function checkNewBranch(sub: string, flag: string, rest: readonly string[]): Guard {
  const [firstFlag, name, start, extra] = rest;
  if (firstFlag !== flag) {
    return refuse(`git ${sub} may only create a new branch with ${flag}`);
  }
  if (name === undefined || !isBranchName(name)) {
    return refuse(`git ${sub} ${flag} needs a plain new branch name`);
  }
  if (extra !== undefined || (start !== undefined && (isFlag(start) || !isRev(start)))) {
    return refuse(`git ${sub} ${flag} takes a name and at most one start point`);
  }
  return ALLOWED;
}

function checkWorktree(rest: readonly string[]): Guard {
  const [action, ...tail] = rest;
  if (action === "list") {
    return tail.length === 1 && tail[0] === "--porcelain" ? ALLOWED : refuse("git worktree list may only run: worktree list --porcelain");
  }
  if (action === "remove") {
    const [path, extra] = tail;
    if (path === undefined || extra !== undefined || !isExactAbsolutePath(path)) {
      return refuse("git worktree remove needs exactly one absolute worktree path");
    }
    return ALLOWED;
  }
  if (action === "add") {
    const args = [...tail];
    if (args[0] === "--detach") {
      args.shift();
    } else if (args[0] === "-b") {
      const name = args[1];
      if (name === undefined || !isBranchName(name)) {
        return refuse("git worktree add -b needs a plain new branch name");
      }
      args.splice(0, 2);
    }
    const [path, commitish, extra] = args;
    if (
      path === undefined ||
      commitish === undefined ||
      extra !== undefined ||
      !isExactAbsolutePath(path) ||
      !isRev(commitish)
    ) {
      return refuse("git worktree add needs an absolute path and one commit-ish");
    }
    return ALLOWED;
  }
  return refuse("git worktree allows only add, remove, and list --porcelain");
}

function checkFetch(rest: readonly string[]): Guard {
  const positionals: string[] = [];
  for (const token of rest) {
    if (token === "--no-tags" || token === "--quiet" || token === "-q" || token === "--unshallow") {
      continue;
    }
    if (/^--depth=\d+$/.test(token)) {
      continue;
    }
    if (isFlag(token)) {
      return refuse(`git fetch flag ${token} is not in the allow-list`);
    }
    positionals.push(token);
  }
  const [remote, ...refs] = positionals;
  if (remote === undefined || !REMOTE_NAME.test(remote)) {
    return refuse("git fetch needs a plain remote name");
  }
  for (const ref of refs) {
    if (ref.startsWith("+") || ref.includes(":") || ref.startsWith("-") || ref.length === 0) {
      return refuse(`git fetch refspec "${ref}" may not force or rename refs`);
    }
  }
  return ALLOWED;
}

function checkSymbolicRef(rest: readonly string[]): Guard {
  const positionals: string[] = [];
  for (const token of rest) {
    if (token === "-q" || token === "--quiet" || token === "--short") {
      continue;
    }
    if (isFlag(token)) {
      return refuse(`git symbolic-ref flag ${token} is not allowed`);
    }
    positionals.push(token);
  }
  const [name] = positionals;
  if (positionals.length !== 1 || name === undefined || !/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(name)) {
    return refuse("git symbolic-ref may only read one ref");
  }
  return ALLOWED;
}

/** Decide whether `git <args>` may run. Force pushes never pass here. */
export function checkGit(args: readonly string[]): Guard {
  const [sub, ...rest] = args;
  if (sub === undefined) {
    return refuse("empty git command");
  }
  if (args.some((token) => token.includes("\0"))) {
    return refuse("argument contains a NUL byte");
  }
  if (READ_ONLY.has(sub)) {
    return checkReadOnly(sub, rest);
  }
  switch (sub) {
    case "push":
      return checkPush(rest);
    case "fetch":
      return checkFetch(rest);
    case "merge":
      return checkMerge(rest);
    case "commit":
      return checkCommit(rest);
    case "commit-tree":
      return checkCommitTree(rest);
    case "add":
      return checkAdd(rest);
    case "checkout":
      return checkNewBranch(sub, "-b", rest);
    case "switch":
      return checkNewBranch(sub, "-c", rest);
    case "worktree":
      return checkWorktree(rest);
    case "symbolic-ref":
      return checkSymbolicRef(rest);
    case "branch":
      return rest.length === 1 && rest[0] === "--show-current"
        ? ALLOWED
        : refuse("git branch may only run --show-current");
    case "config": {
      const [flag, key, extra] = rest;
      return flag === "--get" && key !== undefined && extra === undefined && CONFIG_KEY.test(key)
        ? ALLOWED
        : refuse("git config may only run: config --get <key>");
    }
    default:
      return refuse(`git ${sub} is not in the allow-list`);
  }
}
