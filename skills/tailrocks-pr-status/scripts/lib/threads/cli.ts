// Command line of pr-threads.
//
//   threads.ts <pr-number> plan  [--repo owner/name] [--json] [--git-dir path]
//   threads.ts <pr-number> apply --decisions <file.json> [--repo owner/name] [--json] [--git-dir path]
//
// plan writes nothing. apply posts replies and resolves threads through the
// library's constant GraphQL mutations only. See exit.ts for the exit codes.

import { readFile } from "node:fs/promises";
import { ghMutate } from "../gh.ts";
import { defaultGh, type GhRun } from "../github/graphql.ts";
import { formatPolicyErrors } from "../policy/load.ts";
import { parseRepoSlug, type Parsed, type RepoSlug } from "../types.ts";
import { assertBun } from "../version.ts";
import { applyDecisions, type ApplyConfig, type MutateRun } from "./apply.ts";
import { parseDecisions } from "./decisions.ts";
import { EXIT, EXIT_TABLE } from "./exit.ts";
import { applyObject, exitForApply, exitForOpen, planObject, renderApplyText, renderPlanText } from "./render.ts";
import { readThreadState, unresolved, type ThreadsConfig } from "./state.ts";

export const USAGE = `usage: threads.ts <pr-number> plan|apply [--decisions file.json] [--repo owner/name] [--json] [--git-dir path]`;

export const HELP = `${USAGE}

modes:
  plan    List the unresolved review threads with a class. Writes nothing.
  apply   Check the decisions file, then reply to and resolve threads. This is the only write.

options:
  --decisions <file>  The decisions file (apply only).
  --repo owner/name   The repository. Default: the repository of the current directory.
  --git-dir <path>    A local clone. It proves that a fix commit is an ancestor of the head.
  --json              Print JSON, schema 1.
  -h, --help          Print this text and exit 0.

${EXIT_TABLE}`;

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
  if (argv.includes("--help") || argv.includes("-h")) {
    out(HELP);
    return EXIT.done;
  }
  try {
    assertBun();
  } catch (error) {
    err(error instanceof Error ? error.message : "Bun is too old");
    return EXIT.usage;
  }
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    err(`${parsed.message}\n${USAGE}`);
    return EXIT.usage;
  }
  const { args } = parsed;
  const cwd = options.cwd ?? process.cwd();
  const runGh = options.runGh ?? defaultGh(cwd);
  const slug = await resolveRepo(args.repo, runGh);
  if (!slug.ok) {
    err(slug.error);
    return EXIT.usage;
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
      return result.kind === "policy" ? EXIT.usage : EXIT.refused;
    }
    const open = unresolved(result.state);
    const view = { snapshot: result.state.snapshot, agent: result.state.agent, open, problems: result.state.problems };
    const exit = result.state.problems.length > 0 ? EXIT.refused : exitForOpen(open);
    out(args.json ? JSON.stringify(planObject(view, exit), null, 2) : renderPlanText(view));
    return exit;
  }

  let text: string;
  try {
    text = await readFile(args.decisions ?? "", "utf8");
  } catch {
    err(`cannot read the decisions file ${args.decisions ?? ""}`);
    return EXIT.usage;
  }
  const file = parseDecisions(text);
  if (!file.ok) {
    err(`invalid decisions file: ${file.error}`);
    return EXIT.usage;
  }
  const applyConfig: ApplyConfig = { ...config, mutate: options.mutate ?? ((op) => ghMutate(op, { cwd })) };
  const result = await applyDecisions(slug.value, args.number, file.value, applyConfig);
  if (result.kind === "policy") {
    err(`invalid policy:\n${formatPolicyErrors(result.errors)}`);
    return EXIT.usage;
  }
  const label = `${slug.value}#${args.number}`;
  const exit = exitForApply(result);
  out(args.json ? JSON.stringify(applyObject(result, label, exit), null, 2) : renderApplyText(result, label));
  return exit;
}
