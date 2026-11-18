// Small GitHub reads and reply parsers that only pr-merge needs.

import type { GhRun } from "../github/graphql.ts";
import { arr, isObj, member, obj, parseJson, path, ReadError, str } from "../github/read.ts";
import type { RunResult } from "../proc.ts";
import { parseSha, type RepoSlug, type Sha } from "../types.ts";

export interface PrState {
  readonly state: "OPEN" | "CLOSED" | "MERGED";
  readonly mergeCommit: Sha | null;
  readonly headSha: Sha | null;
}

/** `gh pr view`: the state and the merge commit. Null when the read fails. */
export async function readPrState(run: GhRun, repo: RepoSlug, number: number): Promise<PrState | null> {
  const reply = await run(["pr", "view", String(number), "--repo", repo, "--json", "state,mergeCommit,headRefOid"]);
  if (reply.code !== 0) {
    return null;
  }
  try {
    const data = obj(parseJson(reply.stdout, "pr view"), "pr view");
    const state = str(member(data, "state"), "state");
    if (state !== "OPEN" && state !== "CLOSED" && state !== "MERGED") {
      return null;
    }
    const commit = path(data, "mergeCommit", "oid");
    const head = member(data, "headRefOid");
    const mergeCommit = typeof commit === "string" ? parseSha(commit) : null;
    const headSha = typeof head === "string" ? parseSha(head) : null;
    return {
      state,
      mergeCommit: mergeCommit?.ok === true ? mergeCommit.value : null,
      headSha: headSha?.ok === true ? headSha.value : null,
    };
  } catch (error) {
    if (error instanceof ReadError) {
      return null;
    }
    throw error;
  }
}

/** " as <sha>" for a report line, or an empty text when the commit is not known. */
export function mergedSuffix(state: PrState | null): string {
  return state === null || state.mergeCommit === null ? "" : ` as ${state.mergeCommit}`;
}

export type MutationReply =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 300 ? `${line.slice(0, 297)}...` : line;
}

/**
 * Judge the reply of a GraphQL mutation. GitHub reports an error as JSON on
 * stdout, with exit code 1. The message is untrusted text from GitHub.
 */
export function parseMutationReply(reply: RunResult): MutationReply {
  let body: unknown;
  try {
    body = JSON.parse(reply.stdout);
  } catch {
    body = null;
  }
  if (isObj(body)) {
    const errors = member(body, "errors");
    if (Array.isArray(errors) && errors.length > 0) {
      const first = errors[0];
      const message = isObj(first) ? member(first, "message") : null;
      return { ok: false, message: oneLine(typeof message === "string" ? message : "GitHub reported an error") };
    }
  }
  if (reply.code !== 0) {
    return { ok: false, message: oneLine(reply.stderr.split("\n")[0] ?? `gh exited with code ${reply.code}`) };
  }
  return { ok: true };
}

export type QueueMethod =
  | { readonly known: true; readonly method: "squash" | "merge" | "rebase" }
  | { readonly known: false; readonly reason: string };

const METHODS: Readonly<Record<string, "squash" | "merge" | "rebase">> = { SQUASH: "squash", MERGE: "merge", REBASE: "rebase" };

/** Read the merge method of the queue from the rules API. Anything unclear is unknown. */
export async function readQueueMethod(run: GhRun, repo: RepoSlug, base: string): Promise<QueueMethod> {
  const encoded = base.split("/").map(encodeURIComponent).join("/");
  const reply = await run(["api", "-X", "GET", `repos/${repo}/rules/branches/${encoded}`]);
  if (reply.code !== 0) {
    return { known: false, reason: "the branch rules could not be read" };
  }
  try {
    const methods = new Set<string>();
    for (const rule of arr(parseJson(reply.stdout, "rules"), "rules")) {
      if (isObj(rule) && member(rule, "type") === "merge_queue") {
        const method = path(rule, "parameters", "merge_method");
        methods.add(typeof method === "string" ? method.toUpperCase() : "");
      }
    }
    if (methods.size === 0) {
      return { known: false, reason: "no merge queue rule names a merge method (a classic queue setting is not readable)" };
    }
    const [only] = [...methods];
    const mapped = methods.size === 1 && only !== undefined ? METHODS[only] : undefined;
    return mapped === undefined
      ? { known: false, reason: "the merge queue rules do not name one clear merge method" }
      : { known: true, method: mapped };
  } catch (error) {
    if (error instanceof ReadError) {
      return { known: false, reason: "the branch rules are unreadable" };
    }
    throw error;
  }
}

export type ChangedFiles =
  | { readonly known: true; readonly files: readonly string[] }
  | { readonly known: false; readonly reason: string };

const FILES_PER_PAGE = 100;
// GitHub lists at most 3000 files of one PR.
const FILES_MAX_PAGES = 30;

/**
 * The files of a PR from the REST files API. Each changed file gives its new
 * path and, for a rename, its old path too. A list that is not complete is
 * unknown: GitHub stops at 3000 files, and any failed page ends the read.
 */
export async function readChangedFiles(run: GhRun, repo: RepoSlug, number: number): Promise<ChangedFiles> {
  const paths: string[] = [];
  for (let page = 1; page <= FILES_MAX_PAGES; page += 1) {
    const reply = await run(["api", "-X", "GET", `repos/${repo}/pulls/${number}/files?per_page=${FILES_PER_PAGE}&page=${page}`]);
    if (reply.code !== 0) {
      return { known: false, reason: oneLine(reply.stderr.split("\n")[0] ?? "the file list could not be read") };
    }
    let items: readonly unknown[];
    try {
      items = arr(parseJson(reply.stdout, "pull request files"), "pull request files");
      for (const item of items) {
        const file = obj(item, "file");
        paths.push(str(member(file, "filename"), "filename"));
        const previous = member(file, "previous_filename");
        if (typeof previous === "string") {
          paths.push(previous);
        }
      }
    } catch (error) {
      if (error instanceof ReadError) {
        return { known: false, reason: "the file list is unreadable" };
      }
      throw error;
    }
    if (items.length < FILES_PER_PAGE) {
      return { known: true, files: paths };
    }
  }
  return { known: false, reason: `the PR has ${FILES_PER_PAGE * FILES_MAX_PAGES} files or more, and GitHub lists no more` };
}
