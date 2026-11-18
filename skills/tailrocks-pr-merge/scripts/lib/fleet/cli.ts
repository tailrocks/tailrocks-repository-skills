// Command line of pr-fleet.
//
//   fleet.ts <plan|apply> [--repo owner/name] [--apply] [--json] [--git-dir path]
//            [--policy path] [--wait]
//
// Exit codes: 0 done, 10 waiting (an action is pending), 20 blocked (an action
// was stopped), 3 refused (nothing was written), 4 plan shown (nothing was
// written), 2 usage or policy error. Any other code means the script crashed.

import { removeBodyFiles } from "../body-file.ts";
import { ESTIMATED_POINTS_PER_PR, ensureBudget } from "../github/rate-limit.ts";
import { defaultIo } from "../merge/cli.ts";
import { newShared, type MergeIo } from "../merge/types.ts";
import type { Policy } from "../policy/types.ts";
import { loadLocalPolicy, resolveRepo } from "../status/cli.ts";
import { assertBun } from "../version.ts";
import { applyPlan, exitFor } from "./apply.ts";
import { buildPlan, type FleetDeps } from "./plan.ts";
import { jsonOf, renderPlan, renderResults } from "./render.ts";
import { EXIT, PENDING_REFRESH, type ActionResult, type Plan, type RefreshPort } from "./types.ts";

export const USAGE = `usage: fleet.ts <plan|apply> [--repo owner/name] [--apply] [--json] [--git-dir path] [--policy path] [--wait]`;

export const HELP = `${USAGE}

Plans the next steps for all open pull requests of a repository under a CI
budget, and runs the plan only when asked. The fleet reads each PR with the
pr-status logic. It ranks the PRs, counts stockpiled PRs, plans the removal of
UNMERGEABLE queue entries in the first 5 positions, and plans base merges up to
the refresh budget. It reports in-progress runs on branches with no open PR. It
never cancels a run.

Modes:
  plan     Read everything and print the plan. Writes nothing.
  apply    Print the plan. With --apply, run it. The fleet writes only through
           pr-merge (dequeue, merge) and pr-refresh (sync). Before each action it
           reads the PR again. The head must be the head of the plan.

Options:
  --apply            apply only: run the plan. Without it, nothing is written.
  --repo owner/name  The repository. Default: the repository of the current directory.
  --json             Print one JSON object (schema 1) instead of text.
  --git-dir path     A local clone. It proves review carry-over for the verdicts.
  --policy path      A local policy file, for a read-only look. The plan is then
                     advisory, and apply refuses it (exit 3).
  --wait             When the GraphQL budget is low, sleep until the reset (up to
                     one hour). Without it, the script stops.
  -h, --help         Print this text and exit 0.

The policy comes from the default branch at its current commit. Hold and freeze:
policy fleet.hold skips PRs. Policy fleet.freeze, or the environment variable
PR_FLEET_FREEZE=1, stops every push, enqueue, and dequeue: apply is refused.

Exit codes:
  0   done: the plan was printed, or every planned action ran, or nothing was planned
  10  waiting: apply ran and stopped nothing, but an action is pending (${PENDING_REFRESH})
  20  blocked: apply ran, and an action was stopped (the head moved, GitHub or a gate refused)
  3   refused, nothing was written: freeze, a local policy, or a second apply is running
  4   plan shown, nothing was written: apply without --apply
  2   usage or policy error, or the GraphQL budget is too low
  1   the script crashed. Any other code means a crash as well.`;

export interface Args {
  readonly mode: "plan" | "apply";
  readonly repo: string | null;
  readonly apply: boolean;
  readonly json: boolean;
  readonly gitDir: string | null;
  readonly policyPath: string | null;
  readonly wait: boolean;
}

export type ArgsResult = { readonly ok: true; readonly args: Args } | { readonly ok: false; readonly message: string };

export function parseArgs(argv: readonly string[]): ArgsResult {
  let mode: Args["mode"] | null = null;
  let repo: string | null = null;
  let gitDir: string | null = null;
  let policyPath: string | null = null;
  let apply = false;
  let json = false;
  let wait = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--wait") {
      wait = true;
    } else if (arg === "--repo" || arg === "--git-dir" || arg === "--policy") {
      i += 1;
      const value = argv[i] ?? null;
      if (value === null || value.startsWith("--")) {
        return { ok: false, message: `${arg} needs a value` };
      }
      if (arg === "--repo") repo = value;
      else if (arg === "--git-dir") gitDir = value;
      else policyPath = value;
    } else if (arg.startsWith("-")) {
      return { ok: false, message: `unknown argument ${arg}` };
    } else if (mode === null && (arg === "plan" || arg === "apply")) {
      mode = arg;
    } else {
      return { ok: false, message: mode === null ? `unknown mode ${arg}; use plan or apply` : `unexpected argument ${arg}` };
    }
  }
  if (mode === null) {
    return { ok: false, message: "give a mode: plan or apply" };
  }
  if (apply && mode !== "apply") {
    return { ok: false, message: "--apply belongs to the apply mode" };
  }
  return { ok: true, args: { mode, repo, apply, json, gitDir, policyPath, wait } };
}

export interface MainOptions {
  readonly cwd?: string;
  readonly io?: MergeIo;
  /** The refresh library. Absent until pr-refresh is on main: refresh actions are then pending. */
  readonly refresh?: RefreshPort | null;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly out?: (line: string) => void;
  readonly err?: (line: string) => void;
}

function nextAfter(results: readonly ActionResult[]): string {
  const stopped = results.find((r) => r.kind === "stopped");
  if (stopped !== undefined) {
    return `#${stopped.action.number}: ${stopped.next}`;
  }
  if (results.some((r) => r.kind === "pending")) {
    return `${PENDING_REFRESH}. Report the pending actions to the user.`;
  }
  return "Run fleet.ts plan to read the new state. Watch one queued PR at a time with pr-merge watch.";
}

async function run(argv: readonly string[], options: MainOptions): Promise<number> {
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
  const io = options.io ?? defaultIo(cwd);
  const slug = await resolveRepo(args.repo, io.runGh);
  if (!slug.ok) {
    err(slug.error);
    return EXIT.usage;
  }
  let localPolicy: Policy | null = null;
  if (args.policyPath !== null) {
    const loaded = await loadLocalPolicy(args.policyPath);
    if (typeof loaded === "string") {
      err(loaded);
      return EXIT.usage;
    }
    localPolicy = loaded.policy;
  }
  const deps: FleetDeps = {
    cwd,
    io,
    refresh: options.refresh ?? null,
    env: options.env ?? process.env,
    gitDir: args.gitDir,
    localPolicy,
    wait: args.wait,
    shared: newShared(),
  };

  const finish = (exit: number, plan: Plan | null, results: readonly ActionResult[], next: string, message: string | null, text: readonly string[]): number => {
    if (args.json) {
      out(jsonOf({ mode: args.mode, exit, plan, results, next, message }));
    } else {
      text.forEach((line) => out(line));
    }
    return exit;
  };

  try {
    const built = await buildPlan(slug.value, deps);
    if (!built.ok) {
      err(built.message);
      return built.exit;
    }
    const { plan } = built;
    const shown = renderPlan(plan);
    if (args.mode === "plan") {
      return finish(EXIT.done, plan, [], plan.next, null, [shown]);
    }
    if (plan.frozen !== null) {
      return finish(EXIT.refused, plan, [], plan.next, "refused: freeze is on; nothing was written", [shown, "refused: freeze is on; nothing was written"]);
    }
    if (plan.advisory) {
      const message = "refused: the plan uses a local policy; apply never does; nothing was written";
      return finish(EXIT.refused, plan, [], plan.next, message, [shown, message]);
    }
    if (plan.actions.length === 0) {
      return finish(EXIT.done, plan, [], plan.next, "nothing to do", [shown, "nothing to do"]);
    }
    if (!args.apply) {
      const message = "nothing was written; add --apply to run the plan";
      return finish(EXIT.plan, plan, [], `Run fleet.ts apply --apply --repo ${plan.repo} when the user asked to apply the plan.`, message, [shown, message]);
    }
    const needed = plan.actions.length * 3 * ESTIMATED_POINTS_PER_PR;
    try {
      const budget = await ensureBudget(io.runGh, needed, { wait: args.wait });
      if (!budget.ok) {
        err(budget.message);
        return EXIT.usage;
      }
    } catch (error) {
      err(error instanceof Error ? error.message : "cannot read the GraphQL budget");
      return EXIT.usage;
    }
    const applied = await applyPlan(deps, plan);
    if (applied.kind === "locked") {
      const message = `refused: ${applied.reason}; nothing was written`;
      return finish(EXIT.refused, plan, [], plan.next, message, [shown, message]);
    }
    const exit = exitFor(applied.results);
    const next = nextAfter(applied.results);
    return finish(exit, plan, applied.results, next, null, [shown, "", renderResults(applied.results), `refreshes run: ${applied.refreshes}`, `next: ${next}`]);
  } finally {
    removeBodyFiles();
  }
}

/** Run the command line. An unexpected failure exits 1 with one line on stderr. */
export async function main(argv: readonly string[], options: MainOptions = {}): Promise<number> {
  try {
    return await run(argv, options);
  } catch (error) {
    const err = options.err ?? ((line: string) => console.error(line));
    err(`fleet.ts failed: ${error instanceof Error ? error.message : "unknown error"}`);
    return 1;
  }
}
