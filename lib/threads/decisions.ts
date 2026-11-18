// The decisions file and the rules that `apply` enforces on it. Pure: no I/O.
//
// {
//   "schema": 1,
//   "expectHead": "<40-hex sha>",          optional
//   "decisions": [
//     { "id": "<thread id>", "action": "fix" | "defer" | "reply-only" | "reply-resolve",
//       "reply": "<text>",                  optional for fix and defer on a bot thread
//       "fixCommit": "<40-hex sha>",        fix: required. reply-only: optional.
//       "confirmedNoOpenQuestion": true,    needed to resolve a thread that a person wrote in
//       "lastCommentId": "<id>" }           the last comment id that plan printed; needed to resolve
//   ]
// }

import { createHash } from "node:crypto";
import { arr, isObj, member, ReadError, str } from "../github/read.ts";
import type { Policy } from "../policy/types.ts";
import { parseSha, type Parsed, type RepoSlug, type Sha } from "../types.ts";
import type { Action, ClassifiedThread, CommentView, Decision, DecisionFile } from "./types.ts";

const ACTIONS: readonly Action[] = ["fix", "defer", "reply-only", "reply-resolve"];
const MAX_REPLY = 60_000;
/** The limit of a comment body in lib/safety-gh.ts. */
const MAX_COMMENT_BODY = 65_000;
const TOP_KEYS: ReadonlySet<string> = new Set(["schema", "expectHead", "decisions"]);
const DECISION_KEYS: ReadonlySet<string> = new Set(["id", "action", "reply", "fixCommit", "confirmedNoOpenQuestion", "lastCommentId"]);

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
  const rawConfirm = member(value, "confirmedNoOpenQuestion");
  if (rawConfirm !== undefined && typeof rawConfirm !== "boolean") {
    throw new ReadError(`${where}.confirmedNoOpenQuestion: expected true or false`);
  }
  const rawLast = member(value, "lastCommentId");
  const lastCommentId = rawLast === undefined || rawLast === null ? null : str(rawLast, `${where}.lastCommentId`);
  if (lastCommentId === "") {
    throw new ReadError(`${where}.lastCommentId: empty`);
  }
  return { id, action, reply, fixCommit, confirmedNoOpenQuestion: rawConfirm === true, lastCommentId };
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
  /** The reply that a reader sees. */
  readonly visible: string;
  /** The exact comment body: the reply and a hidden marker line. */
  readonly body: string;
  /** False when this reply is already in the thread (an earlier run posted it). */
  readonly post: boolean;
  /** True when apply resolves the thread. */
  readonly resolve: boolean;
}

export interface WriteContext {
  readonly policy: Policy;
  readonly repo: RepoSlug;
}

export function commitUrl(repo: RepoSlug, sha: Sha): string {
  return `https://github.com/${repo}/commit/${sha}`;
}

/** The hidden line that ends each reply. A re-run finds its own reply by it, whoever wrote after. */
export function replyMarker(threadId: string, visible: string): string {
  const digest = createHash("sha256").update(threadId).update("\0").update(visible).digest("hex").slice(0, 16);
  return `<!-- pr-threads:${digest} -->`;
}

/** True when the thread already holds this reply. Only the hidden marker counts: a person's "Thanks." never does. */
export function hasReply(thread: ClassifiedThread, visible: string): boolean {
  const marker = replyMarker(thread.detail.id, visible);
  return thread.detail.comments.some((c) => c.body.includes(marker));
}

/**
 * The comments that are newer than `lastCommentId`, except our own reply of this write.
 * Null when the id is not a comment of the thread.
 */
export function commentsSince(comments: readonly CommentView[], lastCommentId: string, ownBody: string): readonly CommentView[] | null {
  const index = comments.findIndex((c) => c.id === lastCommentId);
  return index < 0 ? null : comments.slice(index + 1).filter((c) => c.body.trim() !== ownBody.trim());
}

export const STALE_COMMENT = "new comment since plan; run plan again";

/** The visible reply text for a decision. Null when the text would be empty. */
export function composeReply(d: Decision, thread: ClassifiedThread, context: WriteContext): string | null {
  const link = d.fixCommit === null ? "" : `Fixed in ${commitUrl(context.repo, d.fixCommit)}`;
  const parts =
    d.action === "defer"
      ? [context.policy.threads.defer_reply, d.reply]
      : d.action === "fix"
        ? [d.reply === "" && !thread.involvesPerson ? "Fixed." : d.reply, link]
        : [d.reply, link];
  const text = parts.map((p) => p.trim()).filter((p) => p !== "").join("\n\n");
  return text === "" ? null : text;
}

export type WritePlan =
  | { readonly ok: true; readonly writes: readonly PlannedWrite[] }
  | { readonly ok: false; readonly refusals: readonly string[] };

const RESOLVING: ReadonlySet<Action> = new Set(["fix", "defer", "reply-resolve"]);

/**
 * Check every decision against the threads that GitHub holds now. One refusal
 * refuses the whole file: nothing is written. Every reply body is checked here,
 * before any write.
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
    if (d.fixCommit !== null && d.action !== "fix" && d.action !== "reply-only") {
      refuse(`a ${d.action} decision cannot name a fix commit`);
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
    if (d.action === "reply-resolve" && thread.class !== "human-other") {
      refuse(`reply-resolve is for a human-other thread only (this thread is ${thread.class})`);
      continue;
    }
    if (RESOLVING.has(d.action) && thread.involvesPerson && !d.confirmedNoOpenQuestion) {
      refuse(
        "a person wrote in this thread. Read the whole thread. Set confirmedNoOpenQuestion to true only when no person waits for an answer; otherwise use reply-only",
      );
      continue;
    }
    if (RESOLVING.has(d.action) && d.lastCommentId === null) {
      refuse("a resolving decision needs lastCommentId: the last comment id that plan printed for this thread");
      continue;
    }
    if ((d.action === "reply-only" || d.action === "reply-resolve" || thread.involvesPerson) && d.reply === "") {
      refuse("a reply text is required for this thread");
      continue;
    }
    const visible = composeReply(d, thread, context);
    if (visible === null) {
      refuse(d.action === "defer" ? "the reply would be empty: threads.defer_reply is empty, so give a reply text" : "the reply would be empty");
      continue;
    }
    const body = `${visible}\n\n${replyMarker(d.id, visible)}`;
    if (body.length > MAX_COMMENT_BODY) {
      refuse(`the reply is too long (${body.length} characters; the limit is ${MAX_COMMENT_BODY})`);
      continue;
    }
    const posted = hasReply(thread, visible);
    const resolve = RESOLVING.has(d.action);
    if (resolve && !thread.detail.isResolved && d.lastCommentId !== null) {
      const newer = commentsSince(thread.detail.comments, d.lastCommentId, body);
      if (newer === null) {
        refuse("lastCommentId is not a comment of this thread; run plan again");
        continue;
      }
      if (newer.length > 0) {
        refuse(`${STALE_COMMENT} (${newer.length} newer comment${newer.length === 1 ? "" : "s"}, the first by ${newer[0]?.author ?? "someone"})`);
        continue;
      }
    }
    if (thread.detail.isResolved && !posted) {
      refuse("the thread is already resolved");
      continue;
    }
    writes.push({ thread, decision: d, visible, body, post: !posted, resolve: resolve && !thread.detail.isResolved });
  }
  return refusals.length > 0 ? { ok: false, refusals } : { ok: true, writes };
}
