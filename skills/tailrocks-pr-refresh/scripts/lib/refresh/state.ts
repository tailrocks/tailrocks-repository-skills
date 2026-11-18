// Library-owned state of a kept worktree. The state lives in a private
// directory under the OS temp root (mode 0700, owned by the current user), one
// file per run with a random id (mode 0600). It is never stored inside the
// worktree, because the agent and the policy steps can write there.

import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { arr, member, num, obj, parseJson, ReadError, str } from "../github/read.ts";

const MAX_STATE_BYTES = 1_000_000;
const FILE_NAME = /^[0-9a-f]{32}\.json$/;

/** What a kept worktree remembers. Every path is a realpath. */
export interface KeptState {
  readonly id: string;
  readonly repo: string;
  readonly number: number;
  readonly remote: string;
  readonly headRef: string;
  readonly headSha: string;
  readonly baseRef: string;
  readonly baseSha: string;
  /** Paths that conflicted when the merge stopped, read from git. */
  readonly conflicts: readonly string[];
  readonly worktreePath: string;
  readonly directory: string;
  readonly root: string;
  readonly adminDir: string;
  readonly commonDir: string;
}

export function defaultStateRoot(): string {
  return join(tmpdir(), "pr-refresh-state");
}

function currentUid(): number | null {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

function ownedByMe(uid: number): boolean {
  const me = currentUid();
  return me === null || uid === me;
}

/** Create the state directory if it is missing. Throws when it is not private, a plain directory, and ours. */
export function ensureStateRoot(root: string): void {
  try {
    mkdirSync(root, { mode: 0o700 });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
      throw error;
    }
  }
  const stat = lstatSync(root);
  if (!stat.isDirectory() || !ownedByMe(stat.uid) || (stat.mode & 0o077) !== 0) {
    throw new Error(`the state directory ${root} is not a private directory of this user`);
  }
}

export function writeState(root: string, state: Omit<KeptState, "id">): { readonly id: string; readonly file: string } {
  ensureStateRoot(root);
  const id = randomBytes(16).toString("hex");
  const file = join(root, `${id}.json`);
  writeFileSync(file, JSON.stringify({ schema: 1, id, ...state }), { mode: 0o600, flag: "wx" });
  return { id, file };
}

function parseState(text: string): KeptState | null {
  try {
    const o = obj(parseJson(text, "state"), "state");
    if (member(o, "schema") !== 1) {
      return null;
    }
    return {
      id: str(member(o, "id"), "id"),
      repo: str(member(o, "repo"), "repo"),
      number: num(member(o, "number"), "number"),
      remote: str(member(o, "remote"), "remote"),
      headRef: str(member(o, "headRef"), "headRef"),
      headSha: str(member(o, "headSha"), "headSha"),
      baseRef: str(member(o, "baseRef"), "baseRef"),
      baseSha: str(member(o, "baseSha"), "baseSha"),
      conflicts: arr(member(o, "conflicts"), "conflicts").map((c) => str(c, "conflict")),
      worktreePath: str(member(o, "worktreePath"), "worktreePath"),
      directory: str(member(o, "directory"), "directory"),
      root: str(member(o, "root"), "root"),
      adminDir: str(member(o, "adminDir"), "adminDir"),
      commonDir: str(member(o, "commonDir"), "commonDir"),
    };
  } catch (error) {
    if (error instanceof ReadError) {
      return null;
    }
    throw error;
  }
}

export type FindResult =
  | { readonly ok: true; readonly state: KeptState; readonly file: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Find the state of the worktree at this exact path. A state file counts only
 * when it is a plain file, owned by the current user, with no group or other
 * access, and its name matches the id inside it.
 */
export function findState(root: string, worktreePath: string): FindResult {
  const none = (reason: string): FindResult => ({ ok: false, reason });
  try {
    const stat = lstatSync(root);
    if (!stat.isDirectory() || !ownedByMe(stat.uid) || (stat.mode & 0o077) !== 0) {
      return none("the state directory is not a private directory of this user");
    }
  } catch {
    return none("no kept worktree is recorded");
  }
  for (const name of readdirSync(root)) {
    if (!FILE_NAME.test(name)) {
      continue;
    }
    const file = join(root, name);
    const stat = lstatSync(file);
    if (!stat.isFile() || !ownedByMe(stat.uid) || (stat.mode & 0o077) !== 0 || stat.size > MAX_STATE_BYTES) {
      continue;
    }
    const state = parseState(readFileSync(file, "utf8"));
    if (state !== null && `${state.id}.json` === name && state.worktreePath === worktreePath) {
      return { ok: true, state, file };
    }
  }
  return none("no valid state record exists for this worktree path (a link, another user's file, or open permissions are ignored)");
}

export function removeState(file: string): void {
  rmSync(file, { force: true });
}
