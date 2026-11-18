// Command line of pr-threads.
//
//   threads.ts <pr-number> plan  [--repo owner/name] [--json] [--git-dir path]
//   threads.ts <pr-number> apply --decisions <file.json> [--repo owner/name] [--json] [--git-dir path]
//
// plan writes nothing. apply posts replies and resolves threads through the
// library's constant GraphQL mutations only.
//
// Exit codes: 0 no open thread, 10 only people can act next, 20 the agent must
// act or a write was refused or stopped, 2 usage or policy error.

import { readFile } from "node:fs/promises";
import { ghMutate } from "../gh.ts";
import { defaultGh, type GhRun } from "../github/graphql.ts";
import { formatPolicyErrors } from "../policy/load.ts";
import { parseRepoSlug, type Parsed, type RepoSlug } from "../types.ts";
import { assertBun } from "../version.ts";
import { applyDecisions, type ApplyConfig, type MutateRun } from "./apply.ts";
import { parseDecisions } from "./decisions.ts";
import {
  applyObject,
  EXIT_BLOCKED,
  exitForOpen,
  planObject,
  renderApplyText,
  renderPlanText,
} from "./render.ts";
import { readThreadState, unresolved, type ThreadsConfig } from "./state.ts";

const USAGE_EXIT = 2;

export const USAGE = `usage: threads.ts <pr-number> plan|apply [--decisions file.json] [--repo owner/name] [--json] [--git-dir path]`;

export interface Args {
  readonly number: number;
  readonly mode: "plan" | "apply";
  readonly repo: string | null;
  readonly decisions: string | null;
  readonly gitDir: string | null;
  readonly json: boolean;
}

export type ArgsResult = { readonly ok: true; readonly args: Args } | { readonly ok: false; readonly message: string };

export function parseArgs(argv: readonly string[]): ArgsResult {
  let number: number | null = null;
  let mode: Args["mode"] | null = null;
  let repo: string | null = null;
  let decisions: string | null = null;
  let gitDir: string | null = null;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--json") {
      json = true;
    } else if (arg === "--repo" || arg === "--decisions" || arg === "--git-dir") {
      i += 1;
      const value = argv[i];
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, message: `${arg} needs a value` };
      }
      if (arg === "--repo") repo = value;
      else if (arg === "--decisions") decisions = value;
      else gitDir = value;
    } else if (arg === "plan" || arg === "apply") {
      mode = arg;
    } else if (/^#?\d+$/.test(arg)) {
      number = Number(arg.replace("#", ""));
    } else {
      return { ok: false, message: `unknown argument ${arg}` };
    }
  }
  if (number === null) {
    return { ok: false, message: "give a pull request number" };
  }
  if (mode === null) {
    return { ok: false, message: "give a mode: plan or apply" };
  }
  if (mode === "apply" && decisions === null) {
    return { ok: false, message: "apply needs --decisions <file.json>" };
  }
  if (mode === "plan" && decisions !== null) {
    return { ok: false, message: "plan takes no --decisions" };
  }
  return { ok: true, args: { number, mode, repo, decisions, gitDir, json } };
}

async function resolveRepo(explicit: string | null, run: GhRun): Promise<Parsed<RepoSlug>> {
  if (explicit !== null) {
    return parseRepoSlug(explicit);
  }
  const result = await run(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
  const parsed = parseRepoSlug(result.stdout.trim());
  return result.code === 0 && parsed.ok ? parsed : { ok: false, error: "cannot find the repository; pass --repo owner/name" };
}

export interface MainOptions {
  readonly cwd?: string;
  readonly runGh?: GhRun;
  readonly mutate?: MutateRun;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly out?: (line: string) => void;
  readonly err?: (line: string) => void;
}

export async function main(argv: readonly string[], options: MainOptions = {}): Promise<number> {
  const out = options.out ?? ((line: string) => console.log(line));
  const err = options.err ?? ((line: string) => console.error(line));
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
  const config: ThreadsConfig = {
    cwd,
    runGh,
    ...(args.gitDir === null ? {} : { gitDir: args.gitDir }),
    ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
  };

  if (args.mode === "plan") {
    const result = await readThreadState(slug.value, args.number, config);
    if (!result.ok) {
      err(result.kind === "policy" ? `invalid policy:\n${formatPolicyErrors(result.errors)}` : result.error);
      return result.kind === "policy" ? USAGE_EXIT : EXIT_BLOCKED;
    }
    const open = unresolved(result.state);
    const view = { snapshot: result.state.snapshot, agent: result.state.agent, open, problems: result.state.problems };
    const exit = result.state.problems.length > 0 ? EXIT_BLOCKED : exitForOpen(open);
    out(args.json ? JSON.stringify(planObject(view, exit), null, 2) : renderPlanText(view));
    return exit;
  }

  let text: string;
  try {
    text = await readFile(args.decisions ?? "", "utf8");
  } catch {
    err(`cannot read the decisions file ${args.decisions ?? ""}`);
    return USAGE_EXIT;
  }
  const file = parseDecisions(text);
  if (!file.ok) {
    err(`invalid decisions file: ${file.error}`);
    return USAGE_EXIT;
  }
  const applyConfig: ApplyConfig = { ...config, mutate: options.mutate ?? ((op) => ghMutate(op, { cwd })) };
  const result = await applyDecisions(slug.value, args.number, file.value, applyConfig);
  if (result.kind === "policy") {
    err(`invalid policy:\n${formatPolicyErrors(result.errors)}`);
    return USAGE_EXIT;
  }
  const label = `${slug.value}#${args.number}`;
  const exit =
    result.kind === "refused" || result.aborted !== null || result.remaining === null || result.finalError !== null
      ? EXIT_BLOCKED
      : exitForOpen(result.remaining);
  out(args.json ? JSON.stringify(applyObject(result, label, exit), null, 2) : renderApplyText(result, label));
  return exit;
}
