// signoff: add the missing Signed-off-by lines to the unpushed commits of the
// branch. It rebuilds each commit with `git commit-tree`: the same tree, the
// same author name, email, and date, and the same message plus one trailer. It
// checks every rebuilt commit as git stored it, then moves the local branch
// with a compare-and-swap `update-ref`. It never pushes. The trees do not
// change, so the working tree and the index stay as they are.
//
// The same algorithm as the DCO rewrite of pr-refresh, without a push. That
// module is not in this tree yet. Deduplicate when both are merged.

import { ReadError } from "../github/read.ts";
import type { PolicyError } from "../policy/types.ts";
import { hasSignoff } from "../status/text.ts";
import { parseSha, type Sha } from "../types.ts";
import { needsSignoff, type CommitInfo } from "./checks.ts";
import { StepError } from "./github.ts";
import { gitOut, gitSha, isAncestor } from "./local.ts";
import { buildPlan } from "./plan.ts";
import type { CreateArgs, CreateConfig } from "./types.ts";

// ---------- Commit objects ----------

export interface RangeCommit {
  readonly sha: Sha;
  readonly tree: Sha;
  readonly parents: readonly Sha[];
  readonly authorName: string;
  readonly authorEmail: string;
  /** Git raw date form, for example `1700000000 +0100`. */
  readonly authorDate: string;
  readonly message: string;
  /** A signature or merge tag. A rewrite would drop it. */
  readonly signed: boolean;
  /** A header that a rewrite would drop, such as `encoding`. */
  readonly unsupportedHeader: string | null;
}

const KEPT_HEADERS: ReadonlySet<string> = new Set(["tree", "parent", "author", "committer"]);
const AUTHOR_LINE = /^(.*) <([^<>]*)> (\d+ [+-]\d{4})$/;

function toSha(text: string): Sha | null {
  const parsed = parseSha(text);
  return parsed.ok ? parsed.value : null;
}

/** Parse the output of `git cat-file commit`. Null when the object is malformed. */
export function parseCommitObject(sha: Sha, raw: string): RangeCommit | null {
  const split = raw.indexOf("\n\n");
  const headerText = split < 0 ? raw : raw.slice(0, split);
  const message = split < 0 ? "" : raw.slice(split + 2);
  const headers: { readonly key: string; value: string }[] = [];
  for (const line of headerText.split("\n")) {
    if (line.startsWith(" ") && headers.length > 0) {
      const last = headers[headers.length - 1];
      if (last !== undefined) {
        last.value += `\n${line.slice(1)}`;
      }
      continue;
    }
    const space = line.indexOf(" ");
    headers.push({ key: space < 0 ? line : line.slice(0, space), value: space < 0 ? "" : line.slice(space + 1) });
  }
  const tree = toSha(headers.find((h) => h.key === "tree")?.value ?? "");
  const author = AUTHOR_LINE.exec(headers.find((h) => h.key === "author")?.value ?? "");
  const parents = headers.filter((h) => h.key === "parent").map((h) => toSha(h.value));
  if (tree === null || author === null || parents.some((p) => p === null)) {
    return null;
  }
  const unsupported = headers.find((h) => !KEPT_HEADERS.has(h.key) && !h.key.startsWith("gpgsig") && h.key !== "mergetag");
  return {
    sha,
    tree,
    parents: parents.flatMap((p) => (p === null ? [] : [p])),
    authorName: author[1] ?? "",
    authorEmail: author[2] ?? "",
    authorDate: author[3] ?? "",
    message,
    signed: headers.some((h) => h.key.startsWith("gpgsig") || h.key === "mergetag"),
    unsupportedHeader: unsupported?.key ?? null,
  };
}

// ---------- Messages ----------

const TRAILER_LINE = /^[A-Za-z][A-Za-z0-9-]*:\s+\S/;

/** Append one trailer the way `git commit -s` does: join an existing trailer block, else start one. */
export function appendSignoff(message: string, trailer: string): string {
  const body = message.replace(/\s+$/, "");
  if (body === "") {
    return `${trailer}\n`;
  }
  const paragraphs = body.split("\n\n");
  const last = paragraphs[paragraphs.length - 1] ?? "";
  const inTrailerBlock =
    paragraphs.length >= 2 &&
    last.split("\n").every((line, index) => (index === 0 ? TRAILER_LINE.test(line) : TRAILER_LINE.test(line) || /^\s+\S/.test(line)));
  return `${body}${inTrailerBlock ? "\n" : "\n\n"}${trailer}\n`;
}

/**
 * True when `after` is `before` (without trailing blank space) plus exactly one
 * added trailer line. Independent of `appendSignoff`, so a bug there is caught.
 */
export function onlyTrailerAdded(before: string, after: string, trailer: string): boolean {
  const kept = before.replace(/\s+$/, "");
  if (kept === "") {
    return after === `${trailer}\n`;
  }
  if (!after.startsWith(kept)) {
    return false;
  }
  const rest = after.slice(kept.length);
  return rest === `\n${trailer}\n` || rest === `\n\n${trailer}\n`;
}

// ---------- The run ----------

const STOPS: ReadonlySet<string> = new Set(["dirty_tree", "detached_head", "on_protected_branch", "no_commits"]);

export type SignoffResult =
  | { readonly kind: "policy-error"; readonly errors: readonly PolicyError[] }
  | { readonly kind: "refused"; readonly code: 3 | 4; readonly reasons: readonly string[] }
  | {
      readonly kind: "done";
      readonly branch: string;
      readonly oldHead: Sha;
      readonly newHead: Sha;
      readonly trailersAdded: number;
      readonly reparented: number;
    };

function refused(code: 3 | 4, ...reasons: readonly string[]): SignoffResult {
  return { kind: "refused", code, reasons };
}

async function readCommit(cfg: CreateConfig, sha: Sha): Promise<RangeCommit | null> {
  const raw = await gitOut(cfg.runGit, ["cat-file", "commit", sha]);
  return raw.includes("�") ? null : parseCommitObject(sha, raw);
}

function asInfo(commit: RangeCommit): CommitInfo {
  return { sha: commit.sha, authorName: commit.authorName, authorEmail: commit.authorEmail, subject: commit.message.split("\n")[0] ?? "", message: commit.message };
}

export async function signoffRange(args: CreateArgs, cfg: CreateConfig): Promise<SignoffResult> {
  try {
    return await signoff(args, cfg);
  } catch (error) {
    if (error instanceof StepError || error instanceof ReadError) {
      return refused(3, error.message);
    }
    throw error;
  }
}

async function signoff(args: CreateArgs, cfg: CreateConfig): Promise<SignoffResult> {
  const git = cfg.runGit;
  const oldHead = await gitSha(git, ["rev-parse", "HEAD"]);
  if (oldHead !== args.expectHead) {
    return refused(4, `the head changed since plan: plan saw ${args.expectHead ?? ""}, now it is ${oldHead}. Run plan again.`);
  }
  const result = await buildPlan(args, cfg);
  if (result.kind === "policy-error") {
    return result;
  }
  if (result.kind === "failed") {
    return refused(3, result.error);
  }
  const { plan } = result;
  // Only a finding that makes a rewrite unsafe stops it. A missing title or body is for a later plan.
  const others = plan.findings.filter((f) => f.kind === "refusal" || (f.kind === "blocker" && STOPS.has(f.code)));
  if (others.length > 0) {
    return refused(others.some((f) => f.kind === "refusal") ? 3 : 4, ...others.map((f) => `${f.code}: ${f.detail}`), "Fix these first. Run plan again.");
  }
  const branch = (await gitOut(git, ["branch", "--show-current"])).trim();
  if (branch === "") {
    return refused(3, "HEAD is not on a branch");
  }

  // The range, oldest first, with every commit read as git stored it.
  const listing = await gitOut(git, ["rev-list", "--parents", "--reverse", "--topo-order", oldHead, `^${plan.base.sha}`]);
  const range: RangeCommit[] = [];
  for (const line of listing.split("\n").filter((l) => l.trim() !== "")) {
    const sha = toSha(line.trim().split(/\s+/)[0] ?? "");
    const commit = sha === null ? null : await readCommit(cfg, sha);
    if (commit === null) {
      return refused(3, "a commit of the range is malformed or is not valid UTF-8, so a rewrite could not keep its bytes");
    }
    range.push(commit);
  }
  const onRemote = async (commit: RangeCommit): Promise<boolean> => plan.remoteHead !== null && (await isAncestor(git, commit.sha, plan.remoteHead));
  let firstIndex = -1;
  for (let i = 0; i < range.length; i += 1) {
    const commit = range[i];
    if (commit !== undefined && commit.parents.length === 1 && needsSignoff(asInfo(commit), plan.policy) && !(await onRemote(commit))) {
      firstIndex = i;
      break;
    }
  }
  if (firstIndex < 0) {
    return refused(3, "no unpushed commit needs a sign-off");
  }
  const rewrite = range.slice(firstIndex);
  const refusals: string[] = [];
  for (const commit of rewrite) {
    const label = commit.sha.slice(0, 7);
    if (await onRemote(commit)) {
      refusals.push(`${label} is already on the remote branch; a rewrite would need a force-push`);
    }
    if (commit.parents.length !== 1) {
      refusals.push(`${label} is a merge or a root commit`);
    }
    if (commit.signed) {
      refusals.push(`${label} carries a signature that a rewrite would drop`);
    }
    if (commit.unsupportedHeader !== null) {
      refusals.push(`${label} has a ${commit.unsupportedHeader} header that a rewrite would drop`);
    }
  }
  if (refusals.length > 0) {
    return refused(3, ...refusals);
  }

  const name = (await cfg.runGit(["config", "--get", "user.name"])).stdout.trim();
  const email = (await cfg.runGit(["config", "--get", "user.email"])).stdout.trim();
  if (name === "" || email === "") {
    return refused(3, "git user.name and user.email are not set, so there is no identity to sign with");
  }
  const trailer = `Signed-off-by: ${name} <${email}>`;

  // ---------- Rebuild ----------
  const mapping = new Map<Sha, Sha>();
  const needs = new Set<Sha>();
  let previous: Sha | null = null;
  for (const commit of rewrite) {
    const parent: Sha | null = previous ?? commit.parents[0] ?? null;
    if (parent === null) {
      return refused(3, `${commit.sha.slice(0, 7)} has no parent`);
    }
    const addTrailer = needsSignoff(asInfo(commit), plan.policy);
    if (addTrailer) {
      needs.add(commit.sha);
    }
    const message = addTrailer ? appendSignoff(commit.message, trailer) : commit.message;
    const made = await cfg.runGitEnv(["commit-tree", commit.tree, "-p", parent, "-m", message], {
      GIT_AUTHOR_NAME: commit.authorName,
      GIT_AUTHOR_EMAIL: commit.authorEmail,
      GIT_AUTHOR_DATE: commit.authorDate,
    });
    const created = made.code === 0 ? toSha(made.stdout.trim()) : null;
    if (created === null) {
      return refused(3, `git commit-tree failed: ${made.stderr.trim().split("\n")[0] ?? `exit ${made.code}`}`);
    }
    mapping.set(commit.sha, created);
    previous = created;
  }

  // ---------- Verify, as git stored the new commits ----------
  for (const original of rewrite) {
    const newSha = mapping.get(original.sha);
    const next = newSha === undefined ? null : await readCommit(cfg, newSha);
    const label = `${original.sha.slice(0, 7)} -> ${newSha?.slice(0, 7) ?? "?"}`;
    if (newSha === undefined || next === null) {
      return refused(3, `${label}: the rebuilt commit cannot be read`);
    }
    if (next.tree !== original.tree) {
      return refused(3, `${label}: the tree changed. Nothing was moved.`);
    }
    if (next.authorName !== original.authorName || next.authorEmail !== original.authorEmail || next.authorDate !== original.authorDate) {
      return refused(3, `${label}: the author name, email, or date changed. Nothing was moved.`);
    }
    if (next.signed || next.unsupportedHeader !== null) {
      return refused(3, `${label}: the rebuilt commit carries a signature or an unexpected header. Nothing was moved.`);
    }
    const expectedParent = mapping.get(original.parents[0] ?? original.sha) ?? original.parents[0];
    if (next.parents.length !== 1 || next.parents[0] !== expectedParent) {
      return refused(3, `${label}: the parent is not the rebuilt parent. Nothing was moved.`);
    }
    const good = needs.has(original.sha) ? onlyTrailerAdded(original.message, next.message, trailer) : next.message === original.message;
    if (!good || (needs.has(original.sha) && !hasSignoff(next.message))) {
      return refused(3, `${label}: the message differs by more than the added trailer. Nothing was moved.`);
    }
  }
  const newHead = mapping.get(oldHead);
  if (newHead === undefined) {
    return refused(3, "the old head is not in the rewritten range");
  }
  if ((await gitOut(git, ["rev-parse", `${newHead}^{tree}`])).trim() !== (await gitOut(git, ["rev-parse", `${oldHead}^{tree}`])).trim()) {
    return refused(3, "the tree of the new head differs from the old head. Nothing was moved.");
  }

  // ---------- Move the branch: compare-and-swap, no checkout ----------
  const moved = await cfg.runGit(["update-ref", `refs/heads/${branch}`, newHead, oldHead]);
  if (moved.code !== 0) {
    return refused(4, `git update-ref failed, the branch did not move: ${moved.stderr.trim().split("\n")[0] ?? `exit ${moved.code}`}. Run plan again.`);
  }
  if ((await gitSha(git, ["rev-parse", "HEAD"])) !== newHead) {
    throw new StepError("the branch moved, but HEAD does not show the new head");
  }
  return { kind: "done", branch, oldHead, newHead, trailersAdded: needs.size, reparented: rewrite.length - needs.size };
}
