// One watcher per repository and PR: an exclusive lock file in the OS temp
// directory, created with O_EXCL ("wx"). A second watcher is refused.
//
// A stale lock may be replaced only when both hold: the lock is older than the
// time bound of its owner plus a margin, and its recorded process no longer
// exists. The check sends signal 0, which tests for the process and never
// delivers a signal. Nothing is ever killed.

import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { isObj, member } from "../github/read.ts";
import type { RepoSlug } from "../types.ts";

export const STALE_MARGIN_MS = 10 * 60 * 1000;

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
  readonly pid: number;
}

export function lockPath(dir: string, repo: RepoSlug, number: number): string {
  return join(dir, `pr-merge-watch-${repo.replace("/", "__")}-${number}.lock`);
}

/** Test for a process with signal 0. EPERM means the process exists. */
export function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

interface Held {
  readonly pid: number;
  readonly startedAt: number;
  readonly timeoutSeconds: number;
}

function readHeld(path: string): Held | null {
  try {
    const data: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isObj(data)) {
      return null;
    }
    const pid = member(data, "pid");
    const startedAt = member(data, "startedAt");
    const timeoutSeconds = member(data, "timeoutSeconds");
    return typeof pid === "number" && typeof startedAt === "number" && typeof timeoutSeconds === "number"
      ? { pid, startedAt, timeoutSeconds }
      : null;
  } catch {
    return null;
  }
}

function create(path: string, request: LockRequest): boolean {
  try {
    const fd = openSync(path, "wx", 0o600);
    try {
      writeSync(fd, JSON.stringify({ pid: request.pid, startedAt: request.now(), timeoutSeconds: request.timeoutSeconds }));
    } finally {
      closeSync(fd);
    }
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

function releaser(path: string, request: LockRequest): () => void {
  return () => {
    // Remove the lock only when this process owns it.
    if (readHeld(path)?.pid === request.pid) {
      try {
        unlinkSync(path);
      } catch {
        // Already gone.
      }
    }
  };
}

export function acquireWatchLock(request: LockRequest): LockResult {
  const path = lockPath(request.dir, request.repo, request.number);
  if (create(path, request)) {
    return { ok: true, release: releaser(path, request) };
  }
  const held = readHeld(path);
  if (held === null) {
    return { ok: false, reason: `another watcher holds ${path}, and the file is unreadable; remove that exact file only if no watcher runs` };
  }
  const age = request.now() - held.startedAt;
  const stale = age > held.timeoutSeconds * 1000 + STALE_MARGIN_MS && !request.isAlive(held.pid);
  if (!stale) {
    return { ok: false, reason: `another watcher (process ${held.pid}) already watches PR ${request.number}` };
  }
  unlinkSync(path);
  return create(path, request)
    ? { ok: true, release: releaser(path, request) }
    : { ok: false, reason: `another watcher took the lock of PR ${request.number} first` };
}
