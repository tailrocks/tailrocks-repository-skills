// Helpers for the pr-create tests: real temp git repositories (a bare remote
// and a clone) and a fake `gh` that keeps the state of one repository.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "../../lib/create/args.ts";
import { main, type MainOptions } from "../../lib/create/cli.ts";
import type { CreateArgs, CreateConfig } from "../../lib/create/types.ts";
import { defaultGit } from "../../lib/github/git-facts.ts";
import type { GhRun } from "../../lib/github/graphql.ts";
import type { GhMutation } from "../../lib/safety-gh.ts";
import { run, type RunResult } from "../../lib/proc.ts";
import { fakeGh, type FakeGh, type Reply } from "./fake-gh.ts";

const IDENTITY: Readonly<Record<string, string>> = {
  GIT_AUTHOR_NAME: "Dev A",
  GIT_AUTHOR_EMAIL: "dev-a@example.invalid",
  GIT_COMMITTER_NAME: "Dev A",
  GIT_COMMITTER_EMAIL: "dev-a@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

export const REPO = "example-org/example-repo";

export interface Repos {
  readonly root: string;
  readonly remote: string;
  readonly work: string;
  /** Run plain git (not the guarded runner) in a directory. Throws on a failure. */
  git(args: readonly string[], cwd?: string): Promise<string>;
  /** Write a file, add it, and commit it. Signs off unless `signoff` is false. */
  commit(file: string, content: string, message: string, options?: { signoff?: boolean; cwd?: string; author?: string }): Promise<string>;
  head(cwd?: string): Promise<string>;
  /** The sha of a branch in the bare remote, or null. */
  remoteRef(branch: string): Promise<string | null>;
  /** A second clone, to move the remote behind the back of the first. */
  otherClone(): Promise<string>;
  cleanup(): void;
}

export async function makeRepos(): Promise<Repos> {
  const root = mkdtempSync(join(tmpdir(), "create-test-"));
  const remote = join(root, "remote.git");
  const work = join(root, "work");
  const git = async (args: readonly string[], cwd: string = work): Promise<string> => {
    const result: RunResult = await run(["git", ...args], { cwd, env: IDENTITY });
    if (result.code !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
    }
    return result.stdout;
  };
  await git(["init", "--bare", "-b", "main", remote], root);
  const seed = join(root, "seed");
  await git(["clone", remote, seed], root);
  writeFileSync(join(seed, "README.md"), "# Example\n");
  await git(["add", "README.md"], seed);
  await git(["commit", "-s", "-m", "chore: seed"], seed);
  await git(["push", "origin", "HEAD:refs/heads/main"], seed);
  await git(["clone", remote, work], root);
  const repos: Repos = {
    root,
    remote,
    work,
    git,
    async commit(file, content, message, options = {}) {
      const cwd = options.cwd ?? work;
      mkdirSync(dirname(join(cwd, file)), { recursive: true });
      writeFileSync(join(cwd, file), content);
      await git(["add", file], cwd);
      const author = options.author === undefined ? [] : ["--author", options.author];
      await git(["commit", ...(options.signoff === false ? [] : ["-s"]), ...author, "-m", message], cwd);
      return (await git(["rev-parse", "HEAD"], cwd)).trim();
    },
    async head(cwd = work) {
      return (await git(["rev-parse", "HEAD"], cwd)).trim();
    },
    async remoteRef(branch) {
      const result = await run(["git", "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: remote, env: IDENTITY });
      return result.code === 0 ? result.stdout.trim() : null;
    },
    async otherClone() {
      const dir = join(root, "other");
      await git(["clone", remote, dir], root);
      return dir;
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
  return repos;
}

// ---------- The fake GitHub ----------

export interface FakePr {
  number: number;
  id: string;
  title: string;
  headRef: string;
  headSha: string;
  baseRef: string;
  isDraft: boolean;
  isCrossRepository: boolean;
  author: string;
  labels: string[];
  body: string;
}

export interface World {
  policy: string | null;
  template: string | null;
  user: string;
  defaultBranch: string;
  prs: FakePr[];
  issues: Map<number, { state: string; title: string; body: string }>;
  /** gh pr create makes a draft even without --draft (the environment default). */
  alwaysDraft: boolean;
  /** gh pr create ignores --draft. */
  neverDraft: boolean;
  /** gh pr create fails. With `afterCreate` the PR exists anyway (a lost reply). */
  createFails: "no" | "before" | "after";
  editFails: boolean;
  readyFails: boolean;
  /** Extra branches that exist on GitHub, with their shas (for a base other than main). */
  extraRefs: Map<string, string>;
  created: { args: string[]; body: string }[];
  edits: string[][];
  mutations: GhMutation[];
}

export function newWorld(overrides: Partial<World> = {}): World {
  return {
    policy: null,
    template: null,
    user: "dev-a",
    defaultBranch: "main",
    prs: [],
    issues: new Map(),
    alwaysDraft: false,
    neverDraft: false,
    createFails: "no",
    editFails: false,
    readyFails: false,
    extraRefs: new Map(),
    created: [],
    edits: [],
    mutations: [],
    ...overrides,
  };
}

function flag(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name);
  return index < 0 ? null : (args[index + 1] ?? null);
}

function prJson(pr: FakePr): Record<string, unknown> {
  return {
    number: pr.number,
    id: pr.id,
    url: `https://example.invalid/${REPO}/pull/${pr.number}`,
    title: pr.title,
    headRefName: pr.headRef,
    headRefOid: pr.headSha,
    baseRefName: pr.baseRef,
    isDraft: pr.isDraft,
    isCrossRepository: pr.isCrossRepository,
    author: { login: pr.author },
  };
}

function fail(stderr: string): Reply {
  return { __exit: 1, stderr };
}

export interface FakeWorld {
  readonly gh: FakeGh;
  readonly world: World;
}

/** A fake gh over a World. Branch shas come from the bare remote of `repos`. */
export function fakeWorld(repos: Repos, world: World): FakeWorld {
  const refSha = (branch: string): string | null => {
    const extra = world.extraRefs.get(branch);
    if (extra !== undefined) {
      return extra;
    }
    const result = Bun.spawnSync(["git", "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: repos.remote, env: { ...process.env, ...IDENTITY } });
    return result.exitCode === 0 ? result.stdout.toString().trim() : null;
  };
  const commands = (args: readonly string[]): Reply | undefined => {
    const name = `${args[0] ?? ""} ${args[1] ?? ""}`;
    if (name === "repo view") {
      return { nameWithOwner: REPO, defaultBranchRef: { name: world.defaultBranch } };
    }
    if (name === "pr list") {
      const head = flag(args, "--head");
      return world.prs.filter((p) => head === null || p.headRef === head).map(prJson);
    }
    if (name === "issue view") {
      const issue = world.issues.get(Number(args[2]));
      if (issue === undefined) {
        return fail("Could not resolve to an issue");
      }
      return { number: Number(args[2]), state: issue.state, title: issue.title, url: `https://example.invalid/${REPO}/issues/${args[2]}`, body: issue.body };
    }
    if (name === "pr create") {
      const bodyFile = flag(args, "--body-file") ?? "";
      world.created.push({ args: [...args], body: readFileSync(bodyFile, "utf8") });
      if (world.createFails === "before") {
        return fail("HTTP 502: Bad Gateway");
      }
      const head = flag(args, "--head") ?? "";
      const number = 100 + world.prs.length + 1;
      world.prs.push({
        number,
        id: `PR_node_${number}`,
        title: flag(args, "--title") ?? "",
        headRef: head,
        headSha: refSha(head) ?? "0".repeat(40),
        baseRef: flag(args, "--base") ?? "",
        isDraft: world.neverDraft ? false : args.includes("--draft") || world.alwaysDraft,
        isCrossRepository: false,
        author: world.user,
        labels: [],
        body: readFileSync(bodyFile, "utf8"),
      });
      if (world.createFails === "after") {
        return fail("timeout waiting for the reply");
      }
      return `https://example.invalid/${REPO}/pull/${number}\n`;
    }
    if (name === "pr edit") {
      world.edits.push([...args]);
      if (world.editFails) {
        return fail("label not found");
      }
      const pr = world.prs.find((p) => String(p.number) === args[2]);
      pr?.labels.push(...(flag(args, "--add-label") ?? "").split(","));
      return "";
    }
    return undefined;
  };
  const rest: Record<string, Reply> = {
    user: () => ({ login: world.user }),
    [`repos/${REPO}/contents/.config/pr-policy.toml`]: () => (world.policy === null ? fail("gh: Not Found (HTTP 404)") : world.policy),
    [`repos/${REPO}/contents/.github/PULL_REQUEST_TEMPLATE.md`]: () => (world.template === null ? fail("gh: Not Found (HTTP 404)") : world.template),
  };
  for (const branch of ["main", "release/1.x", "parent", "topic", "feat/topic"]) {
    rest[`repos/${REPO}/git/ref/heads/${branch}`] = () => {
      const sha = refSha(branch);
      return sha === null ? fail("gh: Not Found (HTTP 404)") : { object: { sha } };
    };
  }
  return { gh: fakeGh({}, rest, commands), world };
}

export function configFor(repos: Repos, fake: FakeWorld, extra: Partial<CreateConfig> = {}, gitCalls?: string[][]): CreateConfig {
  const guarded = defaultGit(repos.work);
  return {
    cwd: repos.work,
    runGh: fake.gh.run,
    runGit: async (args) => {
      gitCalls?.push([...args]);
      return guarded(args);
    },
    runCommand: (argv, cwd) => run(argv, { cwd }),
    mutate: async (op) => {
      fake.world.mutations.push(op);
      if (op.kind === "markPullRequestReadyForReview") {
        if (fake.world.readyFails) {
          return { code: 1, stdout: "", stderr: "mutation failed" };
        }
        const pr = fake.world.prs.find((p) => p.id === op.pullRequestId);
        if (pr !== undefined) {
          pr.isDraft = false;
        }
      }
      return { code: 0, stdout: "{}", stderr: "" };
    },
    ...extra,
  };
}

export function argsFor(...argv: string[]): CreateArgs {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  return parsed.args;
}

export interface CliRun {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

export async function runCli(argv: readonly string[], repos: Repos, fake: FakeWorld, extra: Partial<MainOptions> = {}): Promise<CliRun> {
  const out: string[] = [];
  const err: string[] = [];
  const config = configFor(repos, fake);
  const code = await main(argv, {
    cwd: repos.work,
    runGh: config.runGh,
    runGit: config.runGit,
    runCommand: config.runCommand,
    mutate: config.mutate,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    ...extra,
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

export function writeTemp(repos: Repos, name: string, text: string): string {
  const path = join(repos.root, name);
  writeFileSync(path, text);
  return path;
}

/** A body that satisfies the default sections. */
export const GOOD_BODY = [
  "## Why",
  "",
  "The change is needed so that the example works.",
  "",
  "## What",
  "",
  "The example works.",
  "",
  "## Proof",
  "",
  "`bun test` passes.",
  "",
  "## Done when",
  "",
  "None.",
  "",
].join("\n");

export type GhRunType = GhRun;
