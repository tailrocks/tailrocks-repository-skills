// The decisions file and the rules that `apply` enforces on it. Pure: no I/O.
//
// {
//   "schema": 1,
//   "expectHead": "<40-hex sha>",          optional
//   "decisions": [
//     { "id": "<thread id>", "action": "fix" | "defer" | "reply-only",
//       "reply": "<text>", "fixCommit": "<40-hex sha>" }   fixCommit: optional
//   ]
// }

import { arr, isObj, member, ReadError, str } from "../github/read.ts";
import type { Policy } from "../policy/types.ts";
import { parseSha, type Parsed, type RepoSlug, type Sha } from "../types.ts";
import type { Action, ClassifiedThread, Decision, DecisionFile } from "./types.ts";

const ACTIONS: readonly Action[] = ["fix", "defer", "reply-only"];
const MAX_REPLY = 60_000;
const TOP_KEYS: ReadonlySet<string> = new Set(["schema", "expectHead", "decisions"]);
const DECISION_KEYS: ReadonlySet<string> = new Set(["id", "action", "reply", "fixCommit"]);

function unknownKeys(value: Readonly<Record<string, unknown>>, allowed: ReadonlySet<string>, where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ReadError(`${where}: unknown key "${key}"`);
    }
  }
}

function decision(value: unknown, index: number): Decision {
  const where = `decisions[${index}]`;
  if (!isObj(value)) {
    throw new ReadError(`${where}: expected an object`);
  }
  unknownKeys(value, DECISION_KEYS, where);
  const id = str(member(value, "id"), `${where}.id`);
  if (id === "") {
    throw new ReadError(`${where}.id: empty`);
  }
  const action = ACTIONS.find((a) => a === member(value, "action"));
  if (action === undefined) {
    throw new ReadError(`${where}.action: expected one of ${ACTIONS.join(", ")}`);
  }
  const rawReply = member(value, "reply");
  const reply = rawReply === undefined ? "" : str(rawReply, `${where}.reply`).trim();
  if (reply.length > MAX_REPLY || reply.includes("\0")) {
    throw new ReadError(`${where}.reply: too long or holds a NUL byte`);
  }
  const rawCommit = member(value, "fixCommit");
  let fixCommit: Sha | null = null;
  if (rawCommit !== undefined && rawCommit !== null) {
    const parsed = parseSha(str(rawCommit, `${where}.fixCommit`));
    if (!parsed.ok) {
      throw new ReadError(`${where}.fixCommit: ${parsed.error}`);
    }
    fixCommit = parsed.value;
  }
  return { id, action, reply, fixCommit };
}

/** Parse the decisions text. Any unknown key or bad value is an error: a typo fails closed. */
export function parseDecisions(text: string): Parsed<DecisionFile> {
  try {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ReadError("the decisions file is not valid JSON");
    }
    if (!isObj(json)) {
      throw new ReadError("the decisions file must be a JSON object");
    }
    unknownKeys(json, TOP_KEYS, "decisions file");
    if (member(json, "schema") !== 1) {
      throw new ReadError("schema: must be 1");
    }
    const rawHead = member(json, "expectHead");
    let expectHead: Sha | null = null;
    if (rawHead !== undefined && rawHead !== null) {
      const parsed = parseSha(str(rawHead, "expectHead"));
      if (!parsed.ok) {
        throw new ReadError(`expectHead: ${parsed.error}`);
      }
      expectHead = parsed.value;
    }
    const decisions = arr(member(json, "decisions"), "decisions").map(decision);
    return { ok: true, value: { expectHead, decisions } };
  } catch (error) {
    return { ok: false, error: error instanceof ReadError ? error.message : "unreadable decisions file" };
  }
}

/** One thread that `apply` will touch. */
export interface PlannedWrite {
  readonly thread: ClassifiedThread;
  readonly decision: Decision;
  /** The exact reply text. */
  readonly body: string;
  /** False when this reply is already the last comment of the thread (an earlier run posted it). */
  readonly post: boolean;
  /** True for fix and defer on a thread that is not a person's open question. */
  readonly resolve: boolean;
}

export interface WriteContext {
  readonly policy: Policy;
  readonly repo: RepoSlug;
  /** True when the login is the PR author or the current gh user. */
  readonly isSelf: (login: string) => boolean;
}

export function commitUrl(repo: RepoSlug, sha: Sha): string {
  return `https://github.com/${repo}/commit/${sha}`;
}

/** The exact reply text for a decision. Null when a rule needs a reply that is missing. */
export function composeReply(d: Decision, thread: ClassifiedThread, context: WriteContext): string | null {
  const personThread = !thread.isBot;
  const link = d.fixCommit === null ? "" : `Fixed in ${commitUrl(context.repo, d.fixCommit)}`;
  if (d.action === "defer") {
    if (personThread && d.reply === "") {
      return null;
    }
    return [context.policy.threads.defer_reply, d.reply].filter((p) => p !== "").join("\n\n");
  }
  if (d.action === "fix") {
    if (personThread && d.reply === "") {
      return null;
    }
    return [d.reply === "" ? "Fixed." : d.reply, link].filter((p) => p !== "").join("\n\n");
  }
  return d.reply === "" ? null : [d.reply, link].filter((p) => p !== "").join("\n\n");
}

export type WritePlan =
  | { readonly ok: true; readonly writes: readonly PlannedWrite[] }
  | { readonly ok: false; readonly refusals: readonly string[] };

/**
 * Check every decision against the threads that GitHub holds now. One refusal
 * refuses the whole file: nothing is written.
 */
export function planWrites(file: DecisionFile, threads: readonly ClassifiedThread[], context: WriteContext): WritePlan {
  const byId = new Map(threads.map((t) => [t.detail.id, t] as const));
  const seen = new Set<string>();
  const refusals: string[] = [];
  const writes: PlannedWrite[] = [];
  for (const d of file.decisions) {
    const refuse = (reason: string): void => {
      refusals.push(`${d.id}: ${reason}`);
    };
    const thread = byId.get(d.id);
    if (thread === undefined) {
      refuse("no such review thread on this PR");
      continue;
    }
    if (seen.has(d.id)) {
      refuse("more than one decision for this thread");
      continue;
    }
    seen.add(d.id);
    if (d.action === "defer" && d.fixCommit !== null) {
      refuse("a defer decision cannot name a fix commit");
      continue;
    }
    if (d.action === "fix" && d.fixCommit === null) {
      refuse("a fix decision needs fixCommit");
      continue;
    }
    if (thread.class === "human-question" && d.action !== "reply-only") {
      refuse(`a person's open question is never resolved here (${thread.reason}); use reply-only`);
      continue;
    }
    if (thread.class === "fix" && d.action === "defer") {
      refuse("the policy requires a fix for this thread; it cannot be deferred");
      continue;
    }
    const body = composeReply(d, thread, context);
    if (body === null) {
      refuse(d.action === "reply-only" ? "a reply is required" : "a thread of a person needs a reply with the reason");
      continue;
    }
    const last = thread.detail.recent[thread.detail.recent.length - 1];
    const alreadyPosted = last !== undefined && context.isSelf(last.author) && last.body.trim() === body.trim();
    const resolve = d.action !== "reply-only" && thread.class !== "human-question";
    if (thread.detail.isResolved && !alreadyPosted) {
      refuse("the thread is already resolved");
      continue;
    }
    writes.push({ thread, decision: d, body, post: !alreadyPosted, resolve: resolve && !thread.detail.isResolved });
  }
  return refusals.length > 0 ? { ok: false, refusals } : { ok: true, writes };
}
