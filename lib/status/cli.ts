// Command line of pr-status. Read-only: it never writes to GitHub or git.
//
//   status.ts <pr-number | --all> [--repo owner/name] [--json] [--git-dir path]
//             [--policy path] [--wait]
//
// Exit codes: 0 READY, 10 WAITING, 20 BLOCKED (the worst state for --all),
// 2 usage or policy error.

import { readFile } from "node:fs/promises";
import { newGatherCache } from "../github/gather.ts";
import { defaultGh, graphql, int, text, type GhRun } from "../github/graphql.ts";
import { OPEN_PRS_QUERY } from "../github/queries.ts";
import { ESTIMATED_POINTS_PER_PR, ensureBudget } from "../github/rate-limit.ts";
import { arr, isObj, member, num, obj, path, ReadError } from "../github/read.ts";
import { formatPolicyErrors, loadPolicy } from "../policy/load.ts";
import type { Policy } from "../policy/types.ts";
import { parseRepoSlug, type Parsed, type RepoSlug } from "../types.ts";
import { assertBun } from "../version.ts";
import { renderOneLine, renderText, verdictObject } from "./render.ts";
import { statusFor, type PolicyLoad, type StatusConfig } from "./run.ts";
import type { Verdict, VerdictState } from "./types.ts";

export const EXIT: Readonly<Record<VerdictState, number>> = { READY: 0, WAITING: 10, BLOCKED: 20 };
const USAGE_EXIT = 2;

export const USAGE = `usage: status.ts <pr-number | --all> [--repo owner/name] [--json] [--git-dir path] [--policy path] [--wait]`;

export const HELP = `${USAGE}

Reads one pull request, or every open pull request with --all, and prints a
merge-readiness verdict: READY, WAITING, or BLOCKED. Each blocker has a code, an
owner, and the next action. The script is read-only.

Options:
  <pr-number>        The pull request to read. A leading # is allowed.
  --all              Read every open pull request. One line each.
  --repo owner/name  The repository. Default: the repository of the current directory.
  --json             Print JSON, schema 1. List findings keep every item in "items".
  --git-dir path     A local clone. It proves review carry-over. Without it, an
                     approval on an older head does not carry.
  --policy path      A local policy file, for policy checks and tests only. The
                     verdict says so, and the merge skill refuses it.
  --wait             With --all: when the GraphQL budget is low, sleep until the
                     reset (up to one hour). Without it, the script stops.
  -h, --help         Print this text and exit 0.

Exit codes:
  0   READY
  10  WAITING
  20  BLOCKED (with --all, the worst state)
  2   No verdict: usage error, invalid policy, repository not found, Bun too
      old, or the GraphQL budget is too low.
  1   No verdict: the script failed. Any other code means no verdict as well.`;

export interface Args {
  readonly target: { readonly kind: "one"; readonly number: number } | { readonly kind: "all" };
  readonly repo: string | null;
  readonly json: boolean;
  readonly gitDir: string | null;
  readonly policyPath: string | null;
  readonly wait: boolean;
}

export type ArgsResult = { readonly ok: true; readonly args: Args } | { readonly ok: false; readonly message: string };

export function parseArgs(argv: readonly string[]): ArgsResult {
  let target: Args["target"] | null = null;
  let repo: string | null = null;
  let gitDir: string | null = null;
  let policyPath: string | null = null;
  let json = false;
  let wait = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    const value = (): string | null => {
      i += 1;
      return argv[i] ?? null;
    };
    if (arg === "--all") {
      target = { kind: "all" };
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--wait") {
      wait = true;
    } else if (arg === "--repo" || arg === "--git-dir" || arg === "--policy") {
      const v = value();
      if (v === null || v.startsWith("--")) {
        return { ok: false, message: `${arg} needs a value` };
      }
      if (arg === "--repo") repo = v;
      else if (arg === "--git-dir") gitDir = v;
      else policyPath = v;
    } else if (/^#?\d+$/.test(arg)) {
      target = { kind: "one", number: Number(arg.replace("#", "")) };
    } else {
      return { ok: false, message: `unknown argument ${arg}` };
    }
  }
  if (target === null) {
    return { ok: false, message: "give a pull request number or --all" };
  }
  return { ok: true, args: { target, repo, json, gitDir, policyPath, wait } };
}

async function resolveRepo(explicit: string | null, run: GhRun): Promise<Parsed<RepoSlug>> {
  if (explicit !== null) {
    return parseRepoSlug(explicit);
  }
  const result = await run(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
  const parsed = parseRepoSlug(result.stdout.trim());
  return result.code === 0 && parsed.ok ? parsed : { ok: false, error: "cannot find the repository; pass --repo owner/name" };
}

/** The numbers of all open PRs, oldest first. */
export async function listOpenPrs(run: GhRun, repo: RepoSlug): Promise<readonly number[]> {
  const [owner = "", name = ""] = repo.split("/");
  const numbers: number[] = [];
  let after: string | null = null;
  for (let guard = 0; guard < 50; guard += 1) {
    const data = await graphql(run, OPEN_PRS_QUERY, {
      owner: text(owner),
      name: text(name),
      ...(after === null ? {} : { after: text(after) }),
    });
    const connection = obj(path(data, "repository", "pullRequests"), "pullRequests");
    for (const node of arr(member(connection, "nodes"), "pullRequests.nodes")) {
      numbers.push(num(member(obj(node, "pull request"), "number"), "number"));
    }
    const info = member(connection, "pageInfo");
    const cursor = isObj(info) ? member(info, "endCursor") : null;
    if (!isObj(info) || member(info, "hasNextPage") !== true || typeof cursor !== "string") {
      return numbers;
    }
    after = cursor;
  }
  throw new ReadError("more than 5000 open pull requests");
}

async function loadLocalPolicy(file: string): Promise<{ policy: Policy } | string> {
  let source: string;
  try {
    source = await readFile(file, "utf8");
  } catch {
    return `cannot read the policy file ${file}`;
  }
  const result = loadPolicy({ text: source, source: "local" });
  return result.ok ? { policy: result.policy } : `invalid policy file:\n${formatPolicyErrors(result.errors)}`;
}

export interface MainOptions {
  readonly cwd?: string;
  readonly runGh?: GhRun;
  readonly out?: (line: string) => void;
  readonly err?: (line: string) => void;
}

function worst(verdicts: readonly Verdict[]): number {
  return Math.max(...verdicts.map((v) => EXIT[v.state]), 0);
}

const CONCURRENCY = 4;

/** Read the PRs with a small worker pool. Output keeps the order of `numbers`. Null on a policy error. */
async function collect(
  repo: RepoSlug,
  numbers: readonly number[],
  config: StatusConfig,
  workers: number,
  emit: (line: string) => void,
  err: (line: string) => void,
): Promise<readonly Verdict[] | null> {
  const results: (Verdict | undefined)[] = numbers.map(() => undefined);
  let policyError: string | null = null;
  let next = 0;
  let printed = 0;
  const worker = async (): Promise<void> => {
    while (policyError === null) {
      const index = next;
      next += 1;
      const number = numbers[index];
      if (number === undefined) {
        return;
      }
      const result = await statusFor(repo, number, config);
      if (result.kind === "policy-error") {
        policyError = `invalid policy:\n${formatPolicyErrors(result.errors)}`;
        return;
      }
      results[index] = result.verdict;
      for (let v = results[printed]; v !== undefined; v = results[printed]) {
        emit(workers > 1 ? `${renderOneLine(v)} -> ${v.next}` : renderText(v));
        printed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, numbers.length) }, worker));
  if (policyError !== null) {
    err(policyError);
    return null;
  }
  return results.flatMap((v) => (v === undefined ? [] : [v]));
}

async function run(argv: readonly string[], options: MainOptions): Promise<number> {
  const out = options.out ?? ((line: string) => console.log(line));
  const err = options.err ?? ((line: string) => console.error(line));
  if (argv.includes("--help") || argv.includes("-h")) {
    out(HELP);
    return 0;
  }
  try {
    assertBun();
  } catch (error) {
    err(error instanceof Error ? error.message : "Bun is too old");
    return USAGE_EXIT;
  }
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    err(`${parsed.message}\n${USAGE}`);
    return USAGE_EXIT;
  }
  const { args } = parsed;
  const cwd = options.cwd ?? process.cwd();
  const runGh = options.runGh ?? defaultGh(cwd);
  const slug = await resolveRepo(args.repo, runGh);
  if (!slug.ok) {
    err(slug.error);
    return USAGE_EXIT;
  }
  let local: { policy: Policy } | null = null;
  if (args.policyPath !== null) {
    const loaded = await loadLocalPolicy(args.policyPath);
    if (typeof loaded === "string") {
      err(loaded);
      return USAGE_EXIT;
    }
    local = loaded;
  }
  const config: StatusConfig = {
    cwd,
    runGh,
    cache: newGatherCache(),
    policies: new Map<string, Promise<PolicyLoad>>(),
    fetchedBases: new Set<string>(),
    gitQueue: { tail: Promise.resolve() },
    ...(args.gitDir === null ? {} : { gitDir: args.gitDir }),
    ...(local === null ? {} : { localPolicy: local }),
  };

  let numbers: readonly number[];
  try {
    if (args.target.kind === "one") {
      numbers = [args.target.number];
    } else {
      numbers = await listOpenPrs(runGh, slug.value);
      const budget = await ensureBudget(runGh, numbers.length * ESTIMATED_POINTS_PER_PR, { wait: args.wait });
      if (!budget.ok) {
        err(budget.message);
        return USAGE_EXIT;
      }
    }
  } catch (error) {
    err(error instanceof Error ? error.message : "cannot list the pull requests");
    return USAGE_EXIT;
  }

  const verdicts = await collect(slug.value, numbers, config, args.target.kind === "all" ? CONCURRENCY : 1, (line) => {
    if (!args.json) {
      out(line);
    }
  }, err);
  if (verdicts === null) {
    return USAGE_EXIT;
  }
  if (args.json) {
    const [only] = verdicts;
    const payload =
      args.target.kind === "all" || only === undefined
        ? { schema: 1, repo: slug.value, verdicts: verdicts.map(verdictObject) }
        : verdictObject(only);
    out(JSON.stringify(payload, null, 2));
  }
  return worst(verdicts);
}

/** Run the command line. An unexpected failure exits 1 with one line on stderr. */
export async function main(argv: readonly string[], options: MainOptions = {}): Promise<number> {
  try {
    return await run(argv, options);
  } catch (error) {
    const err = options.err ?? ((line: string) => console.error(line));
    err(`status.ts failed: ${error instanceof Error ? error.message : "unknown error"}`);
    return 1;
  }
}
