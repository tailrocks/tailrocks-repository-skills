// Command line of pr-merge.
//
//   merge.ts <ready|merge|dequeue|watch> <pr> [--repo owner/name] --confirm <pr>
//            [--json] [--git-dir path] [--accept-risk] [--reason r]
//            [--interval seconds] [--timeout seconds]
//
// Exit codes: 0 merged or done, 10 waiting, 20 blocked, 3 refused (do not retry),
// 4 plan shown (run again with --confirm), 2 usage or policy error. Any other
// code means the script crashed.

import { tmpdir } from "node:os";
import { removeBodyFiles } from "../body-file.ts";
import { defaultGh, type GhRun } from "../github/graphql.ts";
import { ghMutate } from "../gh.ts";
import { parseRepoSlug, type Parsed, type RepoSlug } from "../types.ts";
import { assertBun } from "../version.ts";
import { verdictObject } from "../status/render.ts";
import { DEQUEUE_REASONS, dequeueStep, type DequeueReason } from "./dequeue.ts";
import { mergeStep } from "./merge.ts";
import { readyStep } from "./ready.ts";
import { EXIT, newShared, type MergeIo, type Step, type StepContext, type StepResult } from "./types.ts";
import { processExists, processStartTime } from "./lock.ts";
import { onStopSignal } from "./signals.ts";
import { DEFAULT_TIMEOUT_SECONDS, MIN_INTERVAL_SECONDS, watchStep } from "./watch.ts";

export const USAGE = `usage: merge.ts <ready|merge|dequeue|watch> <pr-number> --confirm <pr-number> [--repo owner/name] [--json] [--git-dir path] [--accept-risk] [--reason changes-needed|blocked|unmergeable|manual] [--interval seconds] [--timeout seconds]`;

export const HELP = `${USAGE}

Steps for one pull request. Each step reads the PR with pr-status first, and
reads it again right before it writes. A head change in between stops the write.

Steps:
  ready     Mark a draft ready for review, when the policy allows it.
  merge     Land a READY PR: enter the merge queue with the head pinned, or
            squash, merge, or rebase directly with --match-head-commit.
  dequeue   Remove the PR from the merge queue and post the reason.
  watch     Poll a queued PR until it merges or leaves the queue. A review that
            asks for changes while the PR is queued causes a dequeue.

Options:
  --confirm <pr>     Required for every step. It must equal the PR number. Without
                     it the step prints its plan and writes nothing (exit 4). A
                     number that differs from the PR number is refused (exit 3).
  --repo owner/name  The repository. Default: the repository of the current directory.
  --json             Print one JSON object (schema 1) instead of text.
  --git-dir path     A local clone. It proves review carry-over for the verdict.
  --accept-risk      merge only: the user accepts a change in high-risk paths.
  --reason r         dequeue only. Default: taken from the verdict.
  --interval s       watch only: seconds between polls. Default: merge.watch_interval_seconds
                     of the policy (180). Minimum ${MIN_INTERVAL_SECONDS}.
  --timeout s        watch only: seconds before the watch stops. Default ${DEFAULT_TIMEOUT_SECONDS}.
  -h, --help         Print this text and exit 0.

Exit codes:
  0   merged, or the step is done (ready, dequeued, nothing to do)
  10  waiting: queued, the time bound of watch passed, or watch was stopped by a
      signal (SIGTERM, SIGINT, SIGHUP) and removed its lock; the PR was not judged
  20  blocked: the PR or GitHub stops the step
  3   refused: the call is not allowed; do not retry; nothing was written
  4   plan: the plan is shown and nothing was written; run again with --confirm
  2   usage or policy error
  1   the script crashed. Any other code means a crash as well.`;

export interface Args {
  readonly step: Step;
  readonly number: number;
  readonly repo: string | null;
  readonly confirm: number | null;
  readonly json: boolean;
  readonly gitDir: string | null;
  readonly acceptRisk: boolean;
  readonly reason: DequeueReason | null;
  readonly intervalSeconds: number | null;
  readonly timeoutSeconds: number;
}

export type ArgsResult = { readonly ok: true; readonly args: Args } | { readonly ok: false; readonly message: string };

const STEPS: readonly Step[] = ["ready", "merge", "dequeue", "watch"];
const MAX_TIMEOUT_SECONDS = 86_400;

function isStep(text: string): text is Step {
  return STEPS.some((step) => step === text);
}

function isReason(text: string): text is DequeueReason {
  return DEQUEUE_REASONS.some((reason) => reason === text);
}

function wholeNumber(text: string): number | null {
  return /^#?\d{1,9}$/.test(text) ? Number(text.replace("#", "")) : null;
}

export function parseArgs(argv: readonly string[]): ArgsResult {
  let step: Step | null = null;
  let number: number | null = null;
  let repo: string | null = null;
  let confirm: number | null = null;
  let gitDir: string | null = null;
  let reason: DequeueReason | null = null;
  let json = false;
  let acceptRisk = false;
  let intervalSeconds: number | null = null;
  let timeoutSeconds = DEFAULT_TIMEOUT_SECONDS;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    const value = (): string | null => {
      i += 1;
      return argv[i] ?? null;
    };
    if (arg === "--json") {
      json = true;
    } else if (arg === "--accept-risk") {
      acceptRisk = true;
    } else if (["--repo", "--git-dir", "--confirm", "--reason", "--interval", "--timeout"].includes(arg)) {
      const v = value();
      if (v === null || v.startsWith("--")) {
        return { ok: false, message: `${arg} needs a value` };
      }
      if (arg === "--repo") {
        repo = v;
      } else if (arg === "--git-dir") {
        gitDir = v;
      } else if (arg === "--confirm") {
        confirm = wholeNumber(v);
        if (confirm === null) {
          return { ok: false, message: "--confirm needs the pull request number" };
        }
      } else if (arg === "--reason") {
        if (!isReason(v)) {
          return { ok: false, message: `--reason must be one of ${DEQUEUE_REASONS.join(", ")}` };
        }
        reason = v;
      } else {
        const seconds = wholeNumber(v);
        if (arg === "--interval") {
          if (seconds === null || seconds < MIN_INTERVAL_SECONDS || seconds > 3600) {
            return { ok: false, message: `--interval needs whole seconds from ${MIN_INTERVAL_SECONDS} to 3600` };
          }
          intervalSeconds = seconds;
        } else {
          if (seconds === null || seconds < 1 || seconds > MAX_TIMEOUT_SECONDS) {
            return { ok: false, message: `--timeout needs whole seconds from 1 to ${MAX_TIMEOUT_SECONDS}` };
          }
          timeoutSeconds = seconds;
        }
      }
    } else if (arg.startsWith("-")) {
      return { ok: false, message: `unknown argument ${arg}` };
    } else if (step === null) {
      if (!isStep(arg)) {
        return { ok: false, message: `unknown step ${arg}; use ready, merge, dequeue, or watch` };
      }
      step = arg;
    } else if (number === null) {
      number = wholeNumber(arg);
      if (number === null || number < 1) {
        return { ok: false, message: "the pull request must be a positive number" };
      }
    } else {
      return { ok: false, message: `unexpected argument ${arg}` };
    }
  }
  if (step === null || number === null) {
    return { ok: false, message: "give a step and a pull request number" };
  }
  return { ok: true, args: { step, number, repo, confirm, json, gitDir, acceptRisk, reason, intervalSeconds, timeoutSeconds } };
}

export function defaultIo(cwd: string): MergeIo {
  return {
    runGh: defaultGh(cwd),
    mutate: (op) => ghMutate(op, { cwd }),
    sleep: (ms) => Bun.sleep(ms),
    now: () => Date.now(),
    lockDir: tmpdir(),
    pid: process.pid,
    isAlive: processExists,
    startOf: processStartTime,
    onStopSignal,
    exit: (code) => process.exit(code),
  };
}

async function resolveRepo(explicit: string | null, run: GhRun): Promise<Parsed<RepoSlug>> {
  if (explicit !== null) {
    return parseRepoSlug(explicit);
  }
  const reply = await run(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
  const parsed = parseRepoSlug(reply.stdout.trim());
  return reply.code === 0 && parsed.ok ? parsed : { ok: false, error: "cannot find the repository; pass --repo owner/name" };
}

export interface MainOptions {
  readonly cwd?: string;
  readonly io?: MergeIo;
  readonly out?: (line: string) => void;
  readonly err?: (line: string) => void;
}

function jsonResult(args: Args, repo: RepoSlug, outcome: StepResult, events: readonly string[]): string {
  return JSON.stringify(
    {
      schema: 1,
      step: args.step,
      repo,
      number: args.number,
      exit: outcome.exit,
      outcome: outcome.outcome,
      headSha: outcome.headSha,
      mergeCommit: outcome.mergeCommit,
      next: outcome.next,
      events,
      verdict: outcome.verdict === null ? null : verdictObject(outcome.verdict),
    },
    null,
    2,
  );
}

function finalLine(outcome: StepResult): string {
  return `result: ${outcome.outcome} (exit ${outcome.exit}) -> ${outcome.next}`;
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
    return EXIT.usage;
  }
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    err(`${parsed.message}\n${USAGE}`);
    return EXIT.usage;
  }
  const { args } = parsed;
  if (args.confirm !== null && args.confirm !== args.number) {
    err(`refused: --confirm ${args.confirm} does not equal the pull request number ${args.number}; nothing was read or written`);
    return EXIT.refused;
  }
  const cwd = options.cwd ?? process.cwd();
  const io = options.io ?? defaultIo(cwd);
  const slug = await resolveRepo(args.repo, io.runGh);
  if (!slug.ok) {
    err(slug.error);
    return EXIT.usage;
  }
  const events: string[] = [];
  const say = (line: string): void => {
    if (args.json) {
      events.push(line);
    } else {
      out(line);
    }
  };
  const ctx: StepContext = {
    repo: slug.value,
    number: args.number,
    cwd,
    gitDir: args.gitDir,
    io,
    shared: newShared(),
    say,
    // A stop signal skips `finally`, so this closes the run itself: the last output, then the temporary files, then the exit.
    stop: (stopped) => {
      out(args.json ? jsonResult(args, slug.value, stopped, events) : finalLine(stopped));
      removeBodyFiles();
      io.exit(stopped.exit);
    },
    confirmed: args.confirm === args.number,
  };
  let outcome: StepResult;
  try {
    switch (args.step) {
      case "ready":
        outcome = await readyStep(ctx);
        break;
      case "merge":
        outcome = await mergeStep(ctx, { acceptRisk: args.acceptRisk });
        break;
      case "dequeue":
        outcome = await dequeueStep(ctx, args.reason);
        break;
      case "watch":
        outcome = await watchStep(ctx, { intervalSeconds: args.intervalSeconds, timeoutSeconds: args.timeoutSeconds });
        break;
    }
  } finally {
    removeBodyFiles();
  }
  if (args.json) {
    out(jsonResult(args, slug.value, outcome, events));
  } else {
    out(finalLine(outcome));
  }
  return outcome.exit;
}

/** Run the command line. An unexpected failure exits 1 with one line on stderr. */
export async function main(argv: readonly string[], options: MainOptions = {}): Promise<number> {
  try {
    return await run(argv, options);
  } catch (error) {
    const err = options.err ?? ((line: string) => console.error(line));
    err(`merge.ts failed: ${error instanceof Error ? error.message : "unknown error"}`);
    return 1;
  }
}
