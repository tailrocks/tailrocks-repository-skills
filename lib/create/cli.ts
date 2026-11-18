// Command line of pr-create.
//
//   create.ts plan [options]
//   create.ts open --expect-head <sha> [options]
//
// plan writes nothing. It runs the policy checks, which may run the pre-push
// commands of the policy. open pushes the exact commit and creates one PR.
// See exit.ts for the exit codes.

import { ghMutate } from "../gh.ts";
import { defaultGit } from "../github/git-facts.ts";
import { defaultGh, type GhRun } from "../github/graphql.ts";
import { formatPolicyErrors } from "../policy/load.ts";
import { run } from "../proc.ts";
import { assertBun } from "../version.ts";
import { parseArgs, USAGE } from "./args.ts";
import { EXIT, EXIT_TABLE } from "./exit.ts";
import { openPr } from "./open.ts";
import { buildPlan } from "./plan.ts";
import { openObject, planObject, renderOpenText, renderPlanText, renderRefusalText } from "./render.ts";
import type { CommandRun, CreateConfig, MutateRun } from "./types.ts";
import type { GitRun } from "../github/git-facts.ts";

export { USAGE };

export const HELP = `${USAGE}

modes:
  plan   Read GitHub and git, run the policy checks, and print the plan. It makes
         no commit, no push, and no PR. It runs the pre-push steps of the policy.
  open   Run the plan again, push the exact commit, and create one PR (or reuse
         the open one). It sets draft or ready by the policy.

options:
  --repo owner/name      The repository. Default: the repository of the current directory.
  --base <branch>        The base branch. Default: the default branch, or the head
                         branch of the open PR that this branch is built on.
  --branch <name>        Push HEAD to this branch name. Default: the current branch.
  --issue <N>            Link issue N: Closes when the policy rule allows, else Part of.
  --part-of              Force Part of for the issue link.
  --title <text>         The PR title. Default: the subject of the one commit.
  --body-file <file>     The body text (plan checks it; open posts it).
  --expect-head <sha>    open only: the full head that plan printed.
  --run-ci               Add the run-once CI label when labels.pr_ci is "label".
  --label <name>         Add this label (repeatable).
  --allow-unsigned-pushed  Only on the user's order: accept unsigned commits that are already pushed.
  --remote <name>        The git remote. Default: origin.
  --json                 Print JSON, schema 1.
  -h, --help             Print this text and exit 0.

${EXIT_TABLE}`;

export interface MainOptions {
  readonly cwd?: string;
  readonly runGh?: GhRun;
  readonly runGit?: GitRun;
  readonly runCommand?: CommandRun;
  readonly mutate?: MutateRun;
  readonly out?: (line: string) => void;
  readonly err?: (line: string) => void;
}

const defaultCommand: CommandRun = (argv, cwd) => run(argv, { cwd });

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
  const config: CreateConfig = {
    cwd,
    runGh: options.runGh ?? defaultGh(cwd),
    runGit: options.runGit ?? defaultGit(cwd),
    runCommand: options.runCommand ?? defaultCommand,
    mutate: options.mutate ?? ((op) => ghMutate(op, { cwd })),
  };

  if (args.mode === "plan") {
    const result = await buildPlan(args, config);
    if (result.kind === "policy-error") {
      err(`invalid policy:\n${formatPolicyErrors(result.errors)}`);
      return EXIT.usage;
    }
    if (result.kind === "failed") {
      err(`REFUSED, nothing was written\n  ${result.error}`);
      return EXIT.refused;
    }
    out(args.json ? JSON.stringify(planObject(result.plan), null, 2) : renderPlanText(result.plan));
    return result.plan.exit;
  }

  const result = await openPr(args, config);
  if (result.kind === "policy-error") {
    err(`invalid policy:\n${formatPolicyErrors(result.errors)}`);
    return EXIT.usage;
  }
  if (result.kind === "refused") {
    if (args.json) {
      out(JSON.stringify({ schema: 1, mode: "open", refused: true, exit: EXIT.refused, reasons: result.reasons }, null, 2));
    } else {
      err(renderRefusalText(result.reasons));
    }
    return EXIT.refused;
  }
  const exit = result.report.problems.length > 0 ? EXIT.act : EXIT.done;
  out(args.json ? JSON.stringify(openObject(result.report, exit), null, 2) : renderOpenText(result.report));
  return exit;
}

/** Run the command line. An unexpected failure exits 1 with one line on stderr. */
export async function runMain(argv: readonly string[], options: MainOptions = {}): Promise<number> {
  try {
    return await main(argv, options);
  } catch (error) {
    const err = options.err ?? ((line: string) => console.error(line));
    err(`create.ts failed: ${error instanceof Error ? error.message : "unknown error"}`);
    return 1;
  }
}
