// Command line of pr-refresh.
//
//   refresh.ts sync <pr> [--fresh-ci] [--run-ci] [--keep-worktree]
//   refresh.ts continue <pr> --worktree <path> [--run-ci]
//   refresh.ts abort <pr> --worktree <path>
//   refresh.ts dco-fix <pr>
//   refresh.ts metadata <pr> show
//   refresh.ts metadata <pr> write [--title <text>] [--body-file <path>] --expect-head <sha> --expect-state <id>
//   common: [--repo owner/name] [--remote <name>] [--worktree-root <dir>] [--json]
//
// Exit codes: 0 done (and --help), 20 blocked or refused, 2 usage or policy error,
// 1 a crash (an uncaught exception).

import { tmpdir } from "node:os";
import { isAbsolute } from "node:path";
import { defaultGh } from "../github/graphql.ts";
import { git } from "../git.ts";
import { ghMutate } from "../gh.ts";
import { assertBun } from "../version.ts";
import { loadContext, resolveRepo, type RefreshDeps } from "./context.ts";
import { runAbort, runContinue } from "./continue.ts";
import { runDcoFix } from "./dco-fix.ts";
import { metadataShow, metadataWrite } from "./metadata.ts";
import { outcomeObject, renderOutcome, usage, type Outcome } from "./outcome.ts";
import { runSync } from "./sync.ts";

export const USAGE = `usage:
  refresh.ts sync <pr> [--fresh-ci] [--run-ci] [--keep-worktree]
  refresh.ts continue <pr> --worktree <path> [--run-ci]
  refresh.ts abort <pr> --worktree <path>
  refresh.ts dco-fix <pr>
  refresh.ts metadata <pr> show
  refresh.ts metadata <pr> write [--title <text>] [--body-file <path>] --expect-head <sha> --expect-state <id>
  common options: [--repo owner/name] [--remote <name>] [--worktree-root <dir>] [--json]`;

export type Command =
  | { readonly mode: "sync"; readonly freshCi: boolean; readonly runCi: boolean; readonly keepWorktree: boolean }
  | { readonly mode: "continue"; readonly worktree: string; readonly runCi: boolean }
  | { readonly mode: "abort"; readonly worktree: string }
  | { readonly mode: "dco-fix" }
  | { readonly mode: "metadata-show" }
  | {
      readonly mode: "metadata-write";
      readonly title: string | null;
      readonly bodyFile: string | null;
      readonly expectHead: string;
      readonly expectState: string;
    };

export interface Args {
  readonly command: Command;
  readonly number: number;
  readonly repo: string | null;
  readonly remote: string;
  readonly worktreeRoot: string | null;
  readonly json: boolean;
}

export type ArgsResult = { readonly ok: true; readonly args: Args } | { readonly ok: false; readonly message: string };

const VALUE_FLAGS: ReadonlySet<string> = new Set([
  "--repo",
  "--remote",
  "--worktree-root",
  "--title",
  "--body-file",
  "--expect-head",
  "--expect-state",
  "--worktree",
]);
const SWITCHES: ReadonlySet<string> = new Set(["--json", "--fresh-ci", "--run-ci", "--keep-worktree"]);

export function parseArgs(argv: readonly string[]): ArgsResult {
  const positionals: string[] = [];
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (SWITCHES.has(arg)) {
      switches.add(arg);
    } else if (VALUE_FLAGS.has(arg)) {
      i += 1;
      const value = argv[i];
      if (value === undefined || (value.startsWith("--") && arg !== "--title")) {
        return { ok: false, message: `${arg} needs a value` };
      }
      values.set(arg, value);
    } else if (arg.startsWith("--")) {
      return { ok: false, message: `unknown option ${arg}` };
    } else {
      positionals.push(arg);
    }
  }
  const [mode, prText, action, extra] = positionals;
  if (mode === undefined) {
    return { ok: false, message: "give a mode: sync, continue, abort, dco-fix, or metadata" };
  }
  if (prText === undefined || !/^#?\d+$/.test(prText)) {
    return { ok: false, message: "give the pull request number after the mode" };
  }
  const number = Number(prText.replace("#", ""));
  const used = (names: readonly string[]) => [...values.keys(), ...switches].filter((k) => !names.includes(k));
  const common = ["--repo", "--remote", "--worktree-root", "--json"];
  let command: Command;
  if (mode === "sync") {
    const stray = used([...common, "--fresh-ci", "--run-ci", "--keep-worktree"]);
    if (stray.length > 0 || action !== undefined) {
      return { ok: false, message: `sync does not take ${stray[0] ?? action ?? ""}` };
    }
    command = { mode: "sync", freshCi: switches.has("--fresh-ci"), runCi: switches.has("--run-ci"), keepWorktree: switches.has("--keep-worktree") };
  } else if (mode === "continue" || mode === "abort") {
    const stray = used(mode === "continue" ? [...common, "--worktree", "--run-ci"] : [...common, "--worktree"]);
    const worktree = values.get("--worktree");
    if (stray.length > 0 || action !== undefined) {
      return { ok: false, message: `${mode} does not take ${stray[0] ?? action ?? ""}` };
    }
    if (worktree === undefined || !isAbsolute(worktree)) {
      return { ok: false, message: `${mode} needs --worktree with the absolute path that sync printed` };
    }
    command = mode === "continue" ? { mode, worktree, runCi: switches.has("--run-ci") } : { mode, worktree };
  } else if (mode === "dco-fix") {
    const stray = used(common);
    if (stray.length > 0 || action !== undefined) {
      return { ok: false, message: `dco-fix does not take ${stray[0] ?? action ?? ""}` };
    }
    command = { mode: "dco-fix" };
  } else if (mode === "metadata") {
    if (extra !== undefined) {
      return { ok: false, message: `unexpected argument ${extra}` };
    }
    if (action === "show") {
      const stray = used(common);
      if (stray.length > 0) {
        return { ok: false, message: `metadata show does not take ${stray[0] ?? ""}` };
      }
      command = { mode: "metadata-show" };
    } else if (action === "write") {
      const stray = used([...common, "--title", "--body-file", "--expect-head", "--expect-state"]);
      const head = values.get("--expect-head");
      const state = values.get("--expect-state");
      if (stray.length > 0) {
        return { ok: false, message: `metadata write does not take ${stray[0] ?? ""}` };
      }
      if (head === undefined || !/^[0-9a-f]{40}$/.test(head)) {
        return { ok: false, message: "metadata write needs --expect-head with the 40-character head commit id from metadata show" };
      }
      if (state === undefined || !/^[0-9a-f]{16}$/.test(state)) {
        return { ok: false, message: "metadata write needs --expect-state with the 16-character state-id from metadata show" };
      }
      const title = values.get("--title") ?? null;
      const bodyFile = values.get("--body-file") ?? null;
      if (title === null && bodyFile === null) {
        return { ok: false, message: "metadata write needs --title, --body-file, or both" };
      }
      if (bodyFile !== null && !isAbsolute(bodyFile)) {
        return { ok: false, message: "--body-file needs an absolute path" };
      }
      command = { mode: "metadata-write", title, bodyFile, expectHead: head, expectState: state };
    } else {
      return { ok: false, message: "metadata needs the action show or write after the PR number" };
    }
  } else {
    return { ok: false, message: `unknown mode ${mode}; use sync, continue, abort, dco-fix, or metadata` };
  }
  const root = values.get("--worktree-root") ?? null;
  if (root !== null && !isAbsolute(root)) {
    return { ok: false, message: "--worktree-root needs an absolute path" };
  }
  return {
    ok: true,
    args: { command, number, repo: values.get("--repo") ?? null, remote: values.get("--remote") ?? "origin", worktreeRoot: root, json: switches.has("--json") },
  };
}

export interface MainOptions {
  readonly cwd?: string;
  /** Test seam: replaces the default dependencies. */
  readonly deps?: Partial<RefreshDeps>;
  readonly out?: (line: string) => void;
  readonly err?: (line: string) => void;
}

function modeName(command: Command): string {
  return command.mode === "metadata-show" ? "metadata show" : command.mode === "metadata-write" ? "metadata write" : command.mode;
}

async function execute(args: Args, deps: RefreshDeps, repoText: string | null): Promise<Outcome> {
  const slug = await resolveRepo(repoText, deps.runGh);
  if (!slug.ok) {
    return usage(slug.error);
  }
  const { command } = args;
  if (command.mode === "abort") {
    return runAbort(deps, slug.value, args.number, command.worktree);
  }
  const writesBranch = command.mode === "sync" || command.mode === "dco-fix" || command.mode === "continue";
  const loaded = await loadContext(deps, slug.value, args.number, writesBranch);
  if (!loaded.ok) {
    return loaded.outcome;
  }
  switch (command.mode) {
    case "sync":
      return runSync(deps, loaded.ctx, { freshCi: command.freshCi, runCi: command.runCi, keepWorktree: command.keepWorktree });
    case "continue":
      return runContinue(deps, loaded.ctx, command.worktree, command.runCi);
    case "dco-fix":
      return runDcoFix(deps, loaded.ctx);
    case "metadata-show":
      return metadataShow(deps, loaded.ctx);
    case "metadata-write":
      return metadataWrite(deps, loaded.ctx, command);
  }
}

export async function main(argv: readonly string[], options: MainOptions = {}): Promise<number> {
  const out = options.out ?? ((line: string) => console.log(line));
  const err = options.err ?? ((line: string) => console.error(line));
  if (argv.includes("--help") || argv.includes("-h")) {
    out(USAGE);
    return 0;
  }
  try {
    assertBun();
  } catch (error) {
    err(error instanceof Error ? error.message : "Bun is too old");
    return 2;
  }
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    err(`${parsed.message}\n${USAGE}`);
    return 2;
  }
  const { args } = parsed;
  const cwd = options.cwd ?? process.cwd();
  const deps: RefreshDeps = {
    cwd,
    remote: args.remote,
    worktreeRoot: args.worktreeRoot ?? tmpdir(),
    runGh: defaultGh(cwd),
    mutate: (op) => ghMutate(op, { cwd }),
    git,
    sleep: (ms) => Bun.sleep(ms),
    ...options.deps,
  };
  const outcome = await execute(args, deps, args.repo);
  const name = modeName(args.command);
  if (args.json) {
    out(JSON.stringify(outcomeObject(name, args.number, outcome), null, 2));
  } else {
    out(renderOutcome(name, outcome));
  }
  return outcome.exit;
}
