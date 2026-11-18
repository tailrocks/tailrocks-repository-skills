// A local "GitHub" for refresh tests: a bare remote, a user checkout, and a
// second clone for other people's pushes, all under the OS temp directory.
// The fake gh answers from the live state of the bare remote, so a test can
// move the remote and the PR follows.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { git as guardedGit } from "../../lib/git.ts";
import type { RunOptions, RunResult } from "../../lib/proc.ts";
import type { RefreshDeps } from "../../lib/refresh/context.ts";
import type { GhMutation } from "../../lib/safety-gh.ts";
import { checkGh } from "../../lib/safety.ts";
import { parseRepoSlug, type Sha } from "../../lib/types.ts";
import { baseResponse, fakeGh, prResponse } from "./fake-gh.ts";

// Never read the user's git configuration in tests.
process.env["GIT_CONFIG_GLOBAL"] = "/dev/null";
process.env["GIT_CONFIG_NOSYSTEM"] = "1";

export interface Sandbox {
  readonly root: string;
  readonly remote: string;
  readonly clone: string;
  readonly worktreeRoot: string;
  /** Run git in `cwd` (default: the user checkout). Throws on a non-zero exit. */
  readonly git: (args: readonly string[], cwd?: string) => string;
  /** Like `git`, but returns the exit code and output. */
  readonly gitRaw: (args: readonly string[], cwd?: string, stdin?: string) => { code: number; out: string; err: string };
  /** A second clone, for pushes by other people. Created on first use. */
  readonly other: () => string;
  /** Write files and commit them in `cwd`. A null value deletes the file. */
  readonly commit: (files: Readonly<Record<string, string | null>>, message: string, options?: CommitOptions) => string;
  readonly remoteRev: (ref: string) => Sha;
  readonly cleanup: () => void;
}

export interface CommitOptions {
  readonly cwd?: string;
  readonly signoff?: boolean;
  readonly author?: string;
  readonly date?: string;
}

const GENERATOR = `import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const lines = readFileSync("gen/inputs.txt", "utf8").split("\\n").filter((line) => line !== "");
mkdirSync("out", { recursive: true });
writeFileSync("out/generated.txt", lines.join(",").toUpperCase() + " (" + lines.length + ")\\n");
`;

export function sandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "refresh-test-"));
  const remote = join(root, "remote.git");
  const clone = join(root, "clone");
  const worktreeRoot = join(root, "worktrees");
  let otherPath: string | null = null;

  const raw = (args: readonly string[], cwd: string = clone, stdin?: string) => {
    const proc = Bun.spawnSync({
      cmd: ["git", ...args],
      cwd,
      stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
      stdout: "pipe",
      stderr: "pipe",
    });
    return { code: proc.exitCode, out: proc.stdout.toString(), err: proc.stderr.toString() };
  };
  const git = (args: readonly string[], cwd: string = clone): string => {
    const result = raw(args, cwd);
    if (result.code !== 0) {
      throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.err}`);
    }
    return result.out;
  };
  const config = (cwd: string): void => {
    git(["config", "user.name", "Dev A"], cwd);
    git(["config", "user.email", "dev-a@example.com"], cwd);
    git(["config", "commit.gpgsign", "false"], cwd);
  };
  const commit: Sandbox["commit"] = (files, message, options = {}) => {
    const cwd = options.cwd ?? clone;
    for (const [name, content] of Object.entries(files)) {
      const path = join(cwd, name);
      if (content === null) {
        rmSync(path, { force: true });
      } else {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, content);
      }
    }
    git(["add", "-A"], cwd);
    const args = ["commit", "--allow-empty", "-m", message];
    if (options.signoff !== false) {
      args.push("-s");
    }
    if (options.author !== undefined) {
      args.push(`--author=${options.author}`);
    }
    const env = options.date === undefined ? {} : { GIT_AUTHOR_DATE: options.date, GIT_COMMITTER_DATE: options.date };
    const proc = Bun.spawnSync({ cmd: ["git", ...args], cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
    if (proc.exitCode !== 0) {
      throw new Error(`commit failed: ${proc.stderr.toString()}`);
    }
    return git(["rev-parse", "HEAD"], cwd).trim();
  };

  mkdirSync(worktreeRoot);
  git(["init", "--bare", "-b", "main", remote], root);
  git(["clone", remote, clone], root);
  config(clone);
  git(["checkout", "-b", "main"]);
  commit(
    {
      "README.md": "# demo\n",
      "gen/inputs.txt": ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9"].join("\n") + "\n",
      "gen/gen.ts": GENERATOR,
      "out/generated.txt": "A1,A2,A3,A4,A5,A6,A7,A8,A9 (9)\n",
    },
    "chore: seed",
  );
  git(["push", "origin", "main"]);
  git(["checkout", "-b", "feat/topic"]);

  return {
    root,
    remote,
    clone,
    worktreeRoot,
    git,
    gitRaw: raw,
    other: () => {
      if (otherPath === null) {
        otherPath = join(root, "other");
        git(["clone", remote, otherPath], root);
        config(otherPath);
      }
      return otherPath;
    },
    commit,
    remoteRev: (ref) => {
      const text = git(["rev-parse", ref], remote).trim();
      return text as Sha;
    },
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

// ---------- fake GitHub ----------

export interface PrState {
  number: number;
  headRef: string;
  baseRef: string;
  author: string;
  title: string;
  body: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isCrossRepository: boolean;
  queued: boolean;
  labels: string[];
  /** Serve this head instead of the live remote head (a stale read). */
  pinnedHead: string | null;
  /** Map a commit author email to a GitHub login. Other emails give `dev-a`. */
  logins: Record<string, string>;
}

export interface FakeGithub {
  readonly state: PrState;
  readonly mutations: GhMutation[];
  readonly edits: string[][];
  /** Bodies of `gh pr comment --body-file` calls. */
  readonly comments: string[];
  readonly calls: string[][];
  readonly runGh: (args: readonly string[]) => Promise<RunResult>;
}

const slug = parseRepoSlug("example-org/example-repo");
if (!slug.ok) {
  throw new Error(slug.error);
}
export const REPO = slug.value;

function liveCommits(sb: Sandbox, head: string, base: string, state: PrState) {
  const text = sb.git(["log", "--reverse", "--topo-order", "--format=%H%x1f%P%x1f%T%x1f%ae%x1f%B%x1e", head, `^${base}`], sb.remote);
  return text
    .split("\x1e")
    .map((entry) => entry.replace(/^\n/, ""))
    .filter((entry) => entry !== "")
    .map((entry) => {
      const [oid = "", parents = "", tree = "", email = "", message = ""] = entry.split("\x1f");
      return {
        commit: {
          oid,
          message,
          committedDate: "2026-01-01T00:00:00Z",
          tree: { oid: tree },
          parents: { nodes: parents.split(" ").filter((p) => p !== "").map((p) => ({ oid: p })) },
          author: { email, user: { login: state.logins[email] ?? "dev-a" } },
        },
      };
    });
}

export interface FakeOptions {
  readonly policy?: string | null;
  readonly user?: string;
  readonly template?: string | null;
  readonly files?: readonly unknown[];
  readonly state?: Partial<PrState>;
  /** The fake accepts `gh pr edit` but changes nothing (a lost edit). */
  readonly dropEdits?: boolean;
  /** Extra REST replies, by endpoint. */
  readonly rest?: Readonly<Record<string, unknown>>;
}

export function fakeGithub(sb: Sandbox, options: FakeOptions = {}): FakeGithub {
  const state: PrState = {
    number: 7,
    headRef: "feat/topic",
    baseRef: "main",
    author: "dev-a",
    title: "feat: topic",
    body: "## Why\nbecause\n",
    state: "OPEN",
    isCrossRepository: false,
    queued: false,
    labels: [],
    pinnedHead: null,
    logins: {},
    ...options.state,
  };
  const mutations: GhMutation[] = [];
  const edits: string[][] = [];
  const comments: string[] = [];
  const rulesReply = [
    {
      type: "pull_request",
      parameters: {
        required_approving_review_count: 0,
        require_code_owner_review: false,
        dismiss_stale_reviews_on_push: false,
        required_review_thread_resolution: false,
        allowed_merge_methods: ["squash"],
      },
    },
  ];
  const rest: Record<string, unknown> = {
    [`repos/${REPO}/rules/branches/${state.baseRef}`]: rulesReply,
    [`repos/${REPO}/branches/${state.baseRef}`]: { protected: false, protection: { enabled: false } },
    user: options.user ?? "dev-a",
    [`repos/${REPO}/pulls/${state.number}/files`]: options.files ?? [],
    ...options.rest,
  };
  if (options.policy !== undefined && options.policy !== null) {
    rest[`repos/${REPO}/contents/.config/pr-policy.toml`] = options.policy;
  }
  if (options.template !== undefined && options.template !== null) {
    rest[`repos/${REPO}/contents/.github/PULL_REQUEST_TEMPLATE.md`] = options.template;
  }
  const headOf = (): string => state.pinnedHead ?? sb.remoteRev(`refs/heads/${state.headRef}`);
  const fake = fakeGh(
    {
      pr: () => {
        const head = headOf();
        const base = sb.remoteRev(`refs/heads/${state.baseRef}`);
        const nodes = liveCommits(sb, head, base, state);
        return prResponse({
          title: state.title,
          body: state.body,
          state: state.state,
          author: { login: state.author },
          isCrossRepository: state.isCrossRepository,
          headRefName: state.headRef,
          baseRefName: state.baseRef,
          headRefOid: head,
          baseRefOid: base,
          labels: { totalCount: state.labels.length, nodes: state.labels.map((name) => ({ name })) },
          mergeQueueEntry: state.queued
            ? { id: "MQE_1", position: 1, state: "QUEUED", jump: false, enqueuedAt: "2026-01-01T00:00:00Z" }
            : null,
          commits: { totalCount: nodes.length, nodes },
          latestCommit: {
            nodes: [{ commit: { id: "C_1", oid: head, statusCheckRollup: null } }],
          },
        });
      },
      base: () => baseResponse(),
      issue: () => ({ data: { repository: { issueOrPullRequest: null } } }),
    },
    rest,
  );
  const runGh = async (args: readonly string[]): Promise<RunResult> => {
    if (args[0] === "pr" && args[1] === "comment") {
      const guard = checkGh(args);
      if (!guard.allowed) {
        throw new Error(`the guard refused gh pr comment: ${guard.reason}`);
      }
      comments.push(readFileSync(args[args.indexOf("--body-file") + 1] ?? "", "utf8"));
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args[0] === "pr" && args[1] === "edit") {
      const guard = checkGh(args);
      if (!guard.allowed) {
        throw new Error(`the guard refused gh pr edit: ${guard.reason}`);
      }
      edits.push([...args]);
      if (options.dropEdits === true) {
        return { code: 0, stdout: "", stderr: "" };
      }
      const title = args.indexOf("--title");
      if (title >= 0) {
        state.title = args[title + 1] ?? state.title;
      }
      const bodyFile = args.indexOf("--body-file");
      if (bodyFile >= 0) {
        state.body = readFileSync(args[bodyFile + 1] ?? "", "utf8");
      }
      const label = args.indexOf("--add-label");
      if (label >= 0) {
        state.labels.push(args[label + 1] ?? "");
      }
      return { code: 0, stdout: "", stderr: "" };
    }
    return fake.run(args);
  };
  return { state, mutations, edits, comments, calls: fake.calls, runGh };
}

export interface TestDeps {
  readonly deps: RefreshDeps;
  readonly gitCalls: string[][];
}

export function testDeps(sb: Sandbox, gh: FakeGithub, extra: Partial<RefreshDeps> = {}): TestDeps {
  const gitCalls: string[][] = [];
  const deps: RefreshDeps = {
    cwd: sb.clone,
    remote: "origin",
    worktreeRoot: sb.worktreeRoot,
    stateRoot: join(sb.root, "state"),
    runGh: gh.runGh,
    mutate: async (op) => {
      gh.mutations.push(op);
      return { code: 0, stdout: "", stderr: "" };
    },
    git: (args: readonly string[], options: RunOptions) => {
      gitCalls.push([...args]);
      return guardedGit(args, options);
    },
    sleep: async () => undefined,
    ...extra,
  };
  return { deps, gitCalls };
}

export function policyToml(...sections: readonly string[]): string {
  return ["schema = 1", "", ...sections].join("\n");
}

export const BUN = process.execPath;

/** The `[[regenerate]]` section for the generator in the sandbox. */
export function regenerateSection(whenChanged: readonly string[] = ["gen/**"]): string {
  return [
    "[[regenerate]]",
    'name = "gen"',
    `run = [${JSON.stringify(BUN)}, "gen/gen.ts"]`,
    `when_changed = ${JSON.stringify(whenChanged)}`,
    'outputs = ["out/**"]',
  ].join("\n");
}

export function worktreeLeftovers(sb: Sandbox): { readonly entries: string[]; readonly list: string } {
  const entries = existsSync(sb.worktreeRoot) ? Bun.spawnSync(["ls", sb.worktreeRoot]).stdout.toString().split("\n").filter((e) => e !== "") : [];
  return { entries, list: sb.git(["worktree", "list", "--porcelain"]) };
}
