// `apply`: validate the decisions against a fresh read, then write one thread at a
// time (reply, then resolve). Before each write the script reads the head and the
// thread again. A change stops the run.

import { defaultGit, type GitRun } from "../github/git-facts.ts";
import { isObj, member, parseJson, path, ReadError } from "../github/read.ts";
import type { PolicyError } from "../policy/types.ts";
import type { RunResult } from "../proc.ts";
import type { GhMutation } from "../safety.ts";
import type { RepoSlug } from "../types.ts";
import { verifyFixCommits } from "./commits.ts";
import { commentsSince, planWrites, STALE_COMMENT, type PlannedWrite } from "./decisions.ts";
import { readHead, readThread } from "./read.ts";
import { readThreadState, unresolved, type ThreadsConfig, type ThreadState } from "./state.ts";
import type { Action, ClassifiedThread, DecisionFile } from "./types.ts";

export type MutateRun = (op: GhMutation) => Promise<RunResult>;

export interface ApplyConfig extends ThreadsConfig {
  readonly mutate: MutateRun;
}

export interface ThreadOutcome {
  readonly id: string;
  readonly action: Action;
  /** True when every write of this decision succeeded. */
  readonly ok: boolean;
  /** True when this run posted the reply. */
  readonly replied: boolean;
  /** True when this run resolved the thread. */
  readonly resolved: boolean;
  readonly note: string;
}

export type ApplyResult =
  | { readonly kind: "policy"; readonly errors: readonly PolicyError[] }
  | { readonly kind: "refused"; readonly reasons: readonly string[] }
  | {
      readonly kind: "written";
      readonly headSha: string;
      /** The decisions that this run tried, in order. The last one failed when `aborted` is set. */
      readonly outcomes: readonly ThreadOutcome[];
      /** The ids of the decisions that the run never tried. */
      readonly notAttempted: readonly string[];
      /** The number of successful mutations. */
      readonly mutations: number;
      /** A write failed or a check stopped the run. Null when every decision was applied. */
      readonly aborted: string | null;
      /** Null when the final read failed. */
      readonly remaining: readonly ClassifiedThread[] | null;
      readonly finalError: string | null;
    };

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}

/** Check a mutation reply. Returns an error text, or null when GitHub accepted it. */
function mutationError(result: RunResult, check: (data: unknown) => boolean): string | null {
  if (result.code !== 0) {
    return `gh failed: ${firstLine(result.stderr) || `exit ${result.code}`}`;
  }
  try {
    const reply = parseJson(result.stdout, "mutation reply");
    const errors = isObj(reply) ? member(reply, "errors") : undefined;
    if (Array.isArray(errors) && errors.length > 0) {
      return "GitHub reported an error";
    }
    return check(path(reply, "data")) ? null : "GitHub did not confirm the change";
  } catch (error) {
    return error instanceof ReadError ? error.message : "unreadable reply";
  }
}

/** Null when the PR is open, the head is the validated one, and the thread has no comment of anyone else since plan. Otherwise the reason to stop. */
type BeforeWrite = (w: PlannedWrite) => Promise<string | null>;

function guard(config: ApplyConfig, state: ThreadState): BeforeWrite {
  const { nodeId, headSha } = state.snapshot;
  return async (w) => {
    try {
      const head = await readHead(config.runGh, nodeId);
      if (!head.open || head.headSha !== headSha) {
        return `the PR changed (head ${head.headSha.slice(0, 7)}, expected ${headSha.slice(0, 7)}); nothing more was written`;
      }
      const { thread, problems } = await readThread(config.runGh, w.thread.detail.id);
      if (problems.length > 0) {
        return `unsafe to write: ${problems.join("; ")}`;
      }
      if (w.resolve && w.decision.lastCommentId !== null) {
        const newer = commentsSince(thread.comments, w.decision.lastCommentId, w.body);
        if (newer === null) {
          return `lastCommentId is no longer a comment of the thread; run plan again`;
        }
        if (newer.length > 0) {
          return `${STALE_COMMENT} (the first by ${newer[0]?.author ?? "someone"}); the thread was not resolved`;
        }
      }
      return null;
    } catch (error) {
      return `cannot read the PR before a write: ${error instanceof Error ? error.message : "error"}`;
    }
  };
}

interface WriteResult {
  readonly outcome: ThreadOutcome;
  readonly mutations: number;
  readonly error: string | null;
}

/** Run one mutation. A thrown error becomes an error text: no failure escapes as a crash. */
async function mutate(config: ApplyConfig, op: GhMutation, check: (data: unknown) => boolean): Promise<string | null> {
  try {
    return mutationError(await config.mutate(op), check);
  } catch (error) {
    return error instanceof Error ? error.message : "the mutation failed";
  }
}

async function writeThread(w: PlannedWrite, config: ApplyConfig, beforeWrite: BeforeWrite): Promise<WriteResult> {
  const id = w.thread.detail.id;
  const action = w.decision.action;
  let replied = false;
  let resolved = false;
  let mutations = 0;
  const stop = (error: string): WriteResult => ({
    outcome: { id, action, ok: false, replied, resolved, note: replied ? "replied, not resolved" : "not written" },
    mutations,
    error: `${id}: ${error}`,
  });
  if (w.post) {
    const changed = await beforeWrite(w);
    if (changed !== null) {
      return stop(changed);
    }
    const error = await mutate(config, { kind: "addPullRequestReviewThreadReply", threadId: id, body: w.body }, (data) => typeof path(data, "addPullRequestReviewThreadReply", "comment", "id") === "string");
    if (error !== null) {
      return stop(`reply failed: ${error}`);
    }
    replied = true;
    mutations += 1;
  }
  if (w.resolve) {
    const changed = await beforeWrite(w);
    if (changed !== null) {
      return stop(changed);
    }
    const error = await mutate(config, { kind: "resolveReviewThread", threadId: id }, (data) => path(data, "resolveReviewThread", "thread", "isResolved") === true);
    if (error !== null) {
      return stop(`resolve failed: ${error}`);
    }
    resolved = true;
    mutations += 1;
  }
  const note = [replied ? "replied" : "reply already there", resolved ? "resolved" : w.thread.detail.isResolved ? "already resolved" : "left open"].join(", ");
  return { outcome: { id, action, ok: true, replied, resolved, note }, mutations, error: null };
}

type Checked = { readonly ok: true; readonly writes: readonly PlannedWrite[] } | { readonly ok: false; readonly reasons: readonly string[] };

async function check(file: DecisionFile, repo: RepoSlug, state: ThreadState, config: ApplyConfig): Promise<Checked> {
  const { snapshot } = state;
  const reasons: string[] = [];
  if (snapshot.state !== "OPEN") {
    reasons.push(`the PR is ${snapshot.state}, not open`);
  }
  if (state.problems.length > 0) {
    reasons.push(...state.problems.map((p) => `unsafe to write: ${p}`));
  }
  if (file.expectHead !== null && file.expectHead !== snapshot.headSha) {
    reasons.push(`the head is ${snapshot.headSha.slice(0, 7)}, but the decisions expect ${file.expectHead.slice(0, 7)}`);
  }
  if (file.decisions.length === 0) {
    reasons.push("the decisions file holds no decision");
  }
  const plan = planWrites(file, state.threads, { policy: state.policy, repo });
  if (!plan.ok) {
    reasons.push(...plan.refusals);
  }
  const commits = file.decisions.flatMap((d) => (d.fixCommit === null ? [] : [d.fixCommit]));
  const git: GitRun | null = config.runGit ?? (config.gitDir === undefined ? null : defaultGit(config.gitDir));
  reasons.push(...(await verifyFixCommits(commits, snapshot, git)));
  return plan.ok && reasons.length === 0 ? { ok: true, writes: plan.writes } : { ok: false, reasons };
}

export async function applyDecisions(
  repo: RepoSlug,
  number: number,
  file: DecisionFile,
  config: ApplyConfig,
): Promise<ApplyResult> {
  const before = await readThreadState(repo, number, config);
  if (!before.ok) {
    return before.kind === "policy" ? { kind: "policy", errors: before.errors } : { kind: "refused", reasons: [before.error] };
  }
  const { state } = before;
  const checked = await check(file, repo, state, config);
  if (!checked.ok) {
    return { kind: "refused", reasons: checked.reasons };
  }
  const outcomes: ThreadOutcome[] = [];
  let aborted: string | null = null;
  let mutations = 0;
  const beforeWrite = guard(config, state);
  for (const write of checked.writes) {
    const result = await writeThread(write, config, beforeWrite);
    outcomes.push(result.outcome);
    mutations += result.mutations;
    if (result.error !== null) {
      aborted = result.error;
      break;
    }
  }
  const notAttempted = checked.writes.slice(outcomes.length).map((w) => w.thread.detail.id);
  const after = await readThreadState(repo, number, config);
  if (!after.ok) {
    return {
      kind: "written",
      headSha: state.snapshot.headSha,
      outcomes,
      notAttempted,
      mutations,
      aborted,
      remaining: null,
      finalError: after.kind === "policy" ? "the policy became invalid" : after.error,
    };
  }
  const headNow = after.state.snapshot.headSha;
  return {
    kind: "written",
    headSha: headNow,
    outcomes,
    notAttempted,
    mutations,
    aborted: aborted ?? (headNow === state.snapshot.headSha ? null : `the head changed during the run (now ${headNow.slice(0, 7)})`),
    remaining: unresolved(after.state),
    finalError: null,
  };
}
