// One watcher per repository and PR: an exclusive lock file in the OS temp
// directory, created with O_EXCL ("wx"). A second watcher is refused.
//
// A lock is stale, and a new watcher may take it, when any of these holds:
//   - its recorded process no longer exists (signal 0 gives ESRCH);
//   - the process exists, but its start time differs from the recorded one (the
//     pid was reused). Only where the platform shows the start time (Linux);
//   - the lock is older than the time bound of its owner plus a margin. A live
//     watcher stops itself at its time bound, so this never breaks a live one.
// The check sends signal 0, which tests for the process and never delivers a
// signal. Nothing is ever killed.
//
// A stale lock is taken in three steps. The new watcher renames it to a unique
// tombstone (only one renamer succeeds; the others get ENOENT and start again),
// checks that the tombstone holds the lock it judged, creates its own lock with
// O_EXCL, and deletes the tombstone by its exact path.

import { closeSync, linkSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { isObj, member } from "../github/read.ts";
import type { RepoSlug } from "../types.ts";

export const STALE_MARGIN_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export type LockResult =
  | { readonly ok: true; readonly release: () => void }
  | { readonly ok: false; readonly reason: string };

export interface LockRequest {
  readonly dir: string;
  readonly repo: RepoSlug;
  readonly number: number;
  readonly timeoutSeconds: number;
  readonly now: () => number;
  /** True when the process exists. Tests inject a fake. */
  readonly isAlive: (pid: number) => boolean;
  /** The start time of a process, or null when the platform does not show it. */
  readonly startOf: (pid: number) => string | null;
  readonly pid: number;
  /** File name prefix. Default: the watch lock of pr-merge. */
  readonly prefix?: string;
  /** Name of the lock holder in refusal messages. Default: the watcher of pr-merge. */
  readonly label?: string;
}

export const WATCH_LOCK_PREFIX = "pr-merge-watch";

export function lockPath(dir: string, repo: RepoSlug, number: number, prefix: string = WATCH_LOCK_PREFIX): string {
  return join(dir, `${prefix}-${repo.replace("/", "__")}-${number}.lock`);
}

/** Test for a process with signal 0. EPERM means the process exists. */
export function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return hasCode(error, "EPERM");
  }
}

/** The start time of a process in clock ticks since boot (Linux). Null elsewhere. */
export function processStartTime(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // The name of the command sits in parentheses and may hold spaces. Field 22 is the start time.
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return fields[19] ?? null;
  } catch {
    return null;
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

interface Held {
  readonly pid: number;
  readonly pidStart: string | null;
  readonly startedAt: number;
  readonly timeoutSeconds: number;
}

function parseHeld(text: string): Held | null {
  try {
    const data: unknown = JSON.parse(text);
    if (!isObj(data)) {
      return null;
    }
    const pid = member(data, "pid");
    const pidStart = member(data, "pidStart");
    const startedAt = member(data, "startedAt");
    const timeoutSeconds = member(data, "timeoutSeconds");
    return typeof pid === "number" && typeof startedAt === "number" && typeof timeoutSeconds === "number"
      ? { pid, pidStart: typeof pidStart === "string" ? pidStart : null, startedAt, timeoutSeconds }
      : null;
  } catch {
    return null;
  }
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function create(path: string, request: LockRequest): boolean {
  try {
    const fd = openSync(path, "wx", 0o600);
    try {
      writeSync(
        fd,
        JSON.stringify({ pid: request.pid, pidStart: request.startOf(request.pid), startedAt: request.now(), timeoutSeconds: request.timeoutSeconds }),
      );
    } finally {
      closeSync(fd);
    }
    return true;
  } catch (error) {
    if (hasCode(error, "EEXIST")) {
      return false;
    }
    throw error;
  }
}

function releaser(path: string, request: LockRequest): () => void {
  return () => {
    // Remove the lock only when this process owns it.
    const text = readText(path);
    if (text !== null && parseHeld(text)?.pid === request.pid) {
      try {
        unlinkSync(path);
      } catch {
        // Already gone.
      }
    }
  };
}

function staleReason(held: Held, request: LockRequest): string | null {
  if (!request.isAlive(held.pid)) {
    return `process ${held.pid} no longer exists`;
  }
  const current = request.startOf(held.pid);
  if (held.pidStart !== null && current !== null && current !== held.pidStart) {
    return `process id ${held.pid} was reused`;
  }
  return request.now() - held.startedAt > held.timeoutSeconds * 1000 + STALE_MARGIN_MS ? "the lock is older than its time bound" : null;
}

let tombstones = 0;

export function acquireWatchLock(request: LockRequest): LockResult {
  const path = lockPath(request.dir, request.repo, request.number, request.prefix);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (create(path, request)) {
      return { ok: true, release: releaser(path, request) };
    }
    const text = readText(path);
    if (text === null) {
      continue; // The lock vanished: start again.
    }
    const held = parseHeld(text);
    if (held === null) {
      const who = request.label ?? "watcher";
      return { ok: false, reason: `another ${who} holds ${path}, and the file is unreadable; remove that exact file only if no ${who} runs` };
    }
    if (staleReason(held, request) === null) {
      return {
        ok: false,
        reason:
          request.label === undefined
            ? `another watcher (process ${held.pid}) already watches PR ${request.number}`
            : `another ${request.label} (process ${held.pid}) is running`,
      };
    }
    tombstones += 1;
    const tomb = `${path}.stale-${request.pid}-${tombstones}-${crypto.randomUUID()}`;
    try {
      renameSync(path, tomb);
    } catch (error) {
      if (hasCode(error, "ENOENT")) {
        continue; // Another watcher took the stale lock first: start again.
      }
      throw error;
    }
    if (readText(tomb) !== text) {
      // The path held another lock when we renamed it. Put it back without overwriting.
      try {
        linkSync(tomb, path);
      } catch {
        // Someone created a lock meanwhile; that lock wins.
      }
      unlinkSync(tomb);
      continue;
    }
    const made = create(path, request);
    unlinkSync(tomb);
    if (made) {
      return { ok: true, release: releaser(path, request) };
    }
  }
  return { ok: false, reason: `could not take the lock of PR ${request.number}: other watchers keep changing it` };
}
