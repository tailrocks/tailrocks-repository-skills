// The DCO-only force-push exception (design section 7).
//
// This module is the only code that may mint a DCO capability and the only
// caller of `pushDcoRewrite`. Every guarantee below runs in code:
//
//   1. refuse: protected or default branch, queued PR (unless the policy
//      allows a dequeue), fork PR, PR of another user, signed commit in range;
//   2. rewrite from the first commit without a trailer; earlier commits keep
//      their ids;
//   3. build each new commit with `git commit-tree`: same tree, same author
//      name, email, and date, same message plus one trailer;
//   4. verify the rebuilt commits as git stored them, before any push;
//   5. push with a lease on the old head, through the capability;
//   6. the caller logs and comments (lib/refresh/dco-fix.ts).

import { mintDcoCapability } from "./dco-capability.ts";
import { pushDcoRewrite } from "./git.ts";
import type { Policy } from "./policy/types.ts";
import type { RunResult } from "./proc.ts";
import { type Refusal, writeRefusal } from "./refresh/gate.ts";
import { GitFailure, must, parseShaOrThrow, REFRESH_GIT_ENV, type Repo } from "./refresh/gitx.ts";
import { hasSignoff, sameLogin } from "./status/text.ts";
import type { PrSnapshot } from "./status/types.ts";
import type { Sha } from "./types.ts";

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
  /** A `gpgsig` (GPG or SSH) or `mergetag` header. A rewrite would drop it. */
  readonly signed: boolean;
  /** Name of a header that a rewrite would drop, such as `encoding`. Null when there is none. */
  readonly unsupportedHeader: string | null;
}

const KEPT_HEADERS: ReadonlySet<string> = new Set(["tree", "parent", "author", "committer"]);
const AUTHOR_LINE = /^(.*) <([^<>]*)> (\d+ [+-]\d{4})$/;

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
  const tree = headers.find((h) => h.key === "tree")?.value ?? "";
  const author = AUTHOR_LINE.exec(headers.find((h) => h.key === "author")?.value ?? "");
  const parents = headers.filter((h) => h.key === "parent").map((h) => h.value);
  if (!/^[0-9a-f]{40}$/.test(tree) || author === null || parents.some((p) => !/^[0-9a-f]{40}$/.test(p))) {
    return null;
  }
  const signed = headers.some((h) => h.key.startsWith("gpgsig") || h.key === "mergetag");
  const unsupported = headers.find((h) => !KEPT_HEADERS.has(h.key) && !h.key.startsWith("gpgsig") && h.key !== "mergetag");
  return {
    sha,
    tree: parseShaOrThrow(tree),
    parents: parents.map(parseShaOrThrow),
    authorName: author[1] ?? "",
    authorEmail: author[2] ?? "",
    authorDate: author[3] ?? "",
    message,
    signed,
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

// ---------- Sign-off identity ----------

const SIGNOFF_EMAIL = /^signed-off-by:[^<\n]*<([^<>\n]*)>\s*$/gim;

/**
 * Commits whose sign-off lines name none of the author's email. Design section 7
 * and pr-status both count any `Signed-off-by:` line as signed, so the rewrite
 * leaves these commits alone. They are reported, because a DCO check that
 * matches the sign-off to the author can still fail for them.
 */
export function signoffMismatches(range: readonly RangeCommit[]): readonly Sha[] {
  return range
    .filter((commit) => {
      if (commit.parents.length > 1 || !hasSignoff(commit.message)) {
        return false;
      }
      const emails = [...commit.message.matchAll(SIGNOFF_EMAIL)].map((m) => (m[1] ?? "").toLowerCase());
      return !emails.includes(commit.authorEmail.toLowerCase());
    })
    .map((commit) => commit.sha);
}

// ---------- Preconditions ----------

/** The reasons to refuse before any git work. Pure. */
export function dcoRefusal(snapshot: PrSnapshot, policy: Policy, ghUser: string): Refusal | null {
  const gate = writeRefusal(snapshot, policy, ghUser, { allowQueued: policy.dco.dequeue_for_fix });
  if (gate !== null) {
    return gate;
  }
  if (policy.dco.fix !== "rewrite-trailers") {
    return {
      code: "policy_report_only",
      headline: 'policy dco.fix is "report": this mode may not rewrite commits',
      next: "ask a maintainer to add the sign-off, or change dco.fix on the base branch",
    };
  }
  if (snapshot.commitsTruncated) {
    return { code: "unknown_state", headline: "the commit list of the PR is cut off", next: "run pr-status, then try again" };
  }
  return null;
}

// ---------- Plan and verification ----------

export interface RewritePlan {
  readonly firstUnsigned: Sha;
  /** The commits to rebuild, parents before children. */
  readonly rewrite: readonly RangeCommit[];
  readonly needsTrailer: ReadonlySet<Sha>;
}

/** Choose the rewrite set: the first commit that needs a trailer, and every commit built on it. */
export function planRewrite(range: readonly RangeCommit[], needsTrailer: (commit: RangeCommit) => boolean): RewritePlan | null {
  const first = range.find(needsTrailer);
  if (first === undefined) {
    return null;
  }
  const inSet = new Set<Sha>([first.sha]);
  for (const commit of range) {
    if (inSet.has(commit.sha)) {
      continue;
    }
    if (commit.parents.some((parent) => inSet.has(parent))) {
      inSet.add(commit.sha);
    }
  }
  const rewrite = range.filter((commit) => inSet.has(commit.sha));
  return { firstUnsigned: first.sha, rewrite, needsTrailer: new Set(rewrite.filter(needsTrailer).map((c) => c.sha)) };
}

/**
 * Compare the rebuilt commits (as read back from git) with the originals.
 * Returns the first mismatch, or null when every guarantee holds.
 */
export function verifyRewrite(
  plan: RewritePlan,
  rebuilt: ReadonlyMap<Sha, RangeCommit>,
  mapping: ReadonlyMap<Sha, Sha>,
  trailer: string,
  oldHead: Sha,
): string | null {
  if (rebuilt.size !== plan.rewrite.length) {
    return `expected ${plan.rewrite.length} rebuilt commits, found ${rebuilt.size}`;
  }
  for (const original of plan.rewrite) {
    const newSha = mapping.get(original.sha);
    const next = newSha === undefined ? undefined : rebuilt.get(newSha);
    if (newSha === undefined || next === undefined) {
      return `commit ${original.sha.slice(0, 7)} has no rebuilt commit`;
    }
    const label = `${original.sha.slice(0, 7)} -> ${newSha.slice(0, 7)}`;
    if (next.tree !== original.tree) {
      return `${label}: the tree changed`;
    }
    if (next.authorName !== original.authorName || next.authorEmail !== original.authorEmail || next.authorDate !== original.authorDate) {
      return `${label}: the author name, email, or date changed`;
    }
    if (next.signed || next.unsupportedHeader !== null) {
      return `${label}: the rebuilt commit carries a signature or an unexpected header`;
    }
    const expectedParents = original.parents.map((parent) => mapping.get(parent) ?? parent);
    if (next.parents.length !== expectedParents.length || next.parents.some((parent, index) => parent !== expectedParents[index])) {
      return `${label}: the parents are not the rebuilt parents`;
    }
    if (plan.needsTrailer.has(original.sha)) {
      if (!onlyTrailerAdded(original.message, next.message, trailer)) {
        return `${label}: the message differs by more than the added trailer`;
      }
    } else if (next.message !== original.message) {
      return `${label}: the message changed on a commit that needs no trailer`;
    }
  }
  const newHead = mapping.get(oldHead);
  const head = newHead === undefined ? undefined : rebuilt.get(newHead);
  const oldHeadCommit = plan.rewrite.find((c) => c.sha === oldHead);
  if (head === undefined || oldHeadCommit === undefined || head.tree !== oldHeadCommit.tree) {
    return "the new head is missing or its tree differs from the old head";
  }
  return null;
}

// ---------- The fix ----------

export interface DcoFixRequest {
  readonly snapshot: PrSnapshot;
  readonly policy: Policy;
  readonly ghUser: string;
  readonly remote: string;
  /** A worktree at `snapshot.headSha`. */
  readonly repo: Repo;
  /** Runs after verification and before the push. A value aborts the run with that code and reason. */
  readonly prepare: () => Promise<{ readonly code: string; readonly message: string } | null>;
  /** Test seam: runs after the last remote check, right before the push. */
  readonly beforeLease?: () => Promise<void>;
}

export type DcoFixResult =
  | { readonly kind: "refused"; readonly refusal: Refusal; readonly details: readonly string[] }
  | { readonly kind: "unchanged"; readonly headline: string; readonly mismatched?: readonly string[] }
  | { readonly kind: "aborted"; readonly code: string; readonly headline: string; readonly next: string; readonly details: readonly string[] }
  | {
      readonly kind: "rewritten";
      readonly oldHead: Sha;
      readonly newHead: Sha;
      readonly trailersAdded: number;
      readonly reparented: number;
      readonly warnings: readonly string[];
      /** Commits that already had a sign-off of another identity than the author. They keep it. */
      readonly mismatched: readonly string[];
    };

function aborted(code: string, headline: string, next: string, details: readonly string[] = []): DcoFixResult {
  return { kind: "aborted", code, headline, next, details };
}

function refused(refusal: Refusal, details: readonly string[] = []): DcoFixResult {
  return { kind: "refused", refusal, details };
}

// Messages are compared as text. That is exact only when the bytes are valid
// UTF-8, because then decoding and encoding again gives the same bytes. So the
// objects are read as bytes, and any object that is not valid UTF-8 is refused
// before a rewrite. The byte order mark stays in the text (`ignoreBOM`).
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export type ObjectRead = { readonly ok: true; readonly commit: RangeCommit } | { readonly ok: false; readonly reason: string };

/** Read one commit object as bytes and parse it. */
export async function readCommit(repo: Repo, sha: Sha): Promise<ObjectRead> {
  const result = await repo.bytes(["cat-file", "commit", sha]);
  if (result.code !== 0) {
    throw new GitFailure(`git cat-file failed: ${result.stderr.trim().split("\n")[0] ?? `exit ${result.code}`}`);
  }
  let text: string;
  try {
    text = STRICT_UTF8.decode(result.stdout);
  } catch {
    return { ok: false, reason: `commit ${sha.slice(0, 7)} is not valid UTF-8, so a rewrite could not keep its bytes` };
  }
  const commit = parseCommitObject(sha, text);
  return commit === null ? { ok: false, reason: `commit ${sha.slice(0, 7)} is malformed` } : { ok: true, commit };
}

type RangeRead =
  | { readonly ok: true; readonly commits: readonly RangeCommit[] }
  | { readonly ok: false; readonly code: string; readonly reason: string };

async function readRange(repo: Repo, head: Sha, base: Sha): Promise<RangeRead> {
  const listing = await must(repo, ["rev-list", "--reverse", "--topo-order", head, `^${base}`]);
  const commits: RangeCommit[] = [];
  for (const line of listing.split("\n").filter((l) => l !== "")) {
    const read = await readCommit(repo, parseShaOrThrow(line.trim()));
    if (!read.ok) {
      return { ok: false, code: "non_utf8_commit", reason: read.reason };
    }
    commits.push(read.commit);
  }
  return { ok: true, commits };
}

async function readIdentity(repo: Repo): Promise<string | null> {
  const name = await repo.run(["config", "--get", "user.name"]);
  const email = await repo.run(["config", "--get", "user.email"]);
  const n = name.stdout.trim();
  const e = email.stdout.trim();
  return name.code === 0 && email.code === 0 && n !== "" && e !== "" ? `Signed-off-by: ${n} <${e}>` : null;
}

function botLoginOf(snapshot: PrSnapshot, sha: Sha): string | null {
  return snapshot.commits.find((c) => c.oid === sha)?.authorLogin ?? null;
}

async function buildCommit(repo: Repo, original: RangeCommit, parents: readonly Sha[], message: string): Promise<Sha> {
  const args = ["commit-tree", ...parents.flatMap((p) => ["-p", p]), "-F", "-", original.tree];
  const out = await must(repo, args, {
    stdin: message,
    env: {
      GIT_AUTHOR_NAME: original.authorName,
      GIT_AUTHOR_EMAIL: original.authorEmail,
      GIT_AUTHOR_DATE: original.authorDate,
    },
  });
  return parseShaOrThrow(out.trim());
}

/** Do the whole DCO fix, up to and including the push. Never throws on a git failure. */
export async function executeDcoFix(request: DcoFixRequest): Promise<DcoFixResult> {
  const { snapshot, policy, repo } = request;
  const refusal = dcoRefusal(snapshot, policy, request.ghUser);
  if (refusal !== null) {
    return refused(refusal);
  }
  if (!policy.dco.required) {
    return { kind: "unchanged", headline: "the policy does not require a DCO sign-off (dco.required is false)" };
  }
  try {
    return await rewriteAndPush(request);
  } catch (error) {
    const reason = error instanceof GitFailure || error instanceof Error ? error.message : "git failed";
    return aborted("git_failed", `git failed during the DCO fix: ${reason}; nothing was pushed`, "run the mode again");
  }
}

async function rewriteAndPush(request: DcoFixRequest): Promise<DcoFixResult> {
  const { snapshot, policy, repo } = request;
  const oldHead = snapshot.headSha;
  const read = await readRange(repo, oldHead, snapshot.baseSha);
  if (!read.ok) {
    return refused({ code: read.code, headline: read.reason, next: "ask the author to add the sign-off in a new commit" });
  }
  const range = read.commits;
  const mismatched = signoffMismatches(range).map((c) => c.slice(0, 12));
  const exemptBot = (commit: RangeCommit): boolean => {
    const login = botLoginOf(snapshot, commit.sha);
    return policy.dco.bot_commits === "exempt" && login !== null && policy.dco.bot_authors.some((bot) => sameLogin(bot, login));
  };
  const needsTrailer = (commit: RangeCommit): boolean =>
    commit.parents.length <= 1 && !hasSignoff(commit.message) && !exemptBot(commit);
  const plan = planRewrite(range, needsTrailer);
  if (plan === null) {
    return { kind: "unchanged", headline: "every commit has a sign-off or is exempt; nothing to rewrite", mismatched };
  }
  const signedCommits = plan.rewrite.filter((c) => c.signed);
  if (signedCommits.length > 0) {
    return refused(
      {
        code: "signed_commit",
        headline: "a commit in the rewrite range has a GPG or SSH signature; a rewrite would drop it",
        next: "ask the author to add the sign-off in a new commit, or to re-sign",
      },
      signedCommits.map((c) => `signed: ${c.sha.slice(0, 12)}`),
    );
  }
  const odd = plan.rewrite.find((c) => c.unsupportedHeader !== null);
  if (odd !== undefined) {
    return refused(
      {
        code: "unsupported_commit",
        headline: `commit ${odd.sha.slice(0, 7)} has a "${odd.unsupportedHeader ?? ""}" header that a rewrite would drop`,
        next: "ask the author to add the sign-off in a new commit",
      },
    );
  }
  const trailer = await readIdentity(repo);
  if (trailer === null) {
    return refused({ code: "no_identity", headline: "git user.name or user.email is not set", next: "set both, then run the mode again" });
  }

  // Rebuild.
  const mapping = new Map<Sha, Sha>();
  for (const original of plan.rewrite) {
    const parents = original.parents.map((parent) => mapping.get(parent) ?? parent);
    const message = plan.needsTrailer.has(original.sha) ? appendSignoff(original.message, trailer) : original.message;
    mapping.set(original.sha, await buildCommit(repo, original, parents, message));
  }

  // Verify the commits as git stored them.
  const rebuilt = new Map<Sha, RangeCommit>();
  for (const newSha of mapping.values()) {
    const read = await readCommit(repo, newSha);
    if (!read.ok) {
      return aborted("verification_failed", `the rewrite failed verification: ${read.reason}; nothing was pushed`, "report this to the maintainers of the skill");
    }
    rebuilt.set(newSha, read.commit);
  }
  const problem = verifyRewrite(plan, rebuilt, mapping, trailer, oldHead);
  if (problem !== null) {
    return aborted("verification_failed", `the rewrite failed verification: ${problem}; nothing was pushed`, "report this to the maintainers of the skill");
  }
  const newHead = mapping.get(oldHead);
  if (newHead === undefined || newHead === oldHead) {
    return aborted("verification_failed", "the rewrite did not produce a new head; nothing was pushed", "report this to the maintainers of the skill");
  }

  // The caller re-reads the PR here and may dequeue it.
  const stop = await request.prepare();
  if (stop !== null) {
    return aborted(stop.code, `${stop.message}; nothing was pushed`, "run the mode again");
  }

  // The remote head must still be the old head.
  const fetched = await repo.run(["fetch", "--no-tags", "--quiet", request.remote, snapshot.headRef]);
  if (fetched.code !== 0) {
    return aborted("remote_moved", `cannot read the remote branch: ${fetched.stderr.trim().split("\n")[0] ?? ""}; nothing was pushed`, "run the mode again");
  }
  const remoteHead = (await must(repo, ["rev-parse", `${request.remote}/${snapshot.headRef}^{commit}`])).trim();
  if (remoteHead !== oldHead) {
    return aborted(
      "remote_moved",
      `the remote branch moved from ${oldHead.slice(0, 7)} to ${remoteHead.slice(0, 7)}; nothing was pushed`,
      "run the mode again",
    );
  }
  await request.beforeLease?.();

  const capability = mintDcoCapability({ branch: snapshot.headRef, oldHead, newHead });
  const pushed: RunResult = await pushDcoRewrite(capability, { remote: request.remote }, { cwd: repo.cwd, env: REFRESH_GIT_ENV });
  if (pushed.code !== 0) {
    return aborted(
      "push_rejected",
      `the push was rejected (the remote moved after the check): ${pushed.stderr.trim().split("\n")[0] ?? ""}; nothing was changed on the remote`,
      "run the mode again",
    );
  }
  const warnings =
    policy.dco.bot_commits === "rewrite" && plan.rewrite.some((c) => botLoginOf(snapshot, c.sha) !== null && policy.dco.bot_authors.some((b) => sameLogin(b, botLoginOf(snapshot, c.sha) ?? "")))
      ? ["bot commits were rewritten; a DCO check that matches the sign-off to the commit author can still fail for them"]
      : [];
  return {
    kind: "rewritten",
    oldHead,
    newHead,
    trailersAdded: plan.needsTrailer.size,
    reparented: plan.rewrite.length - plan.needsTrailer.size,
    warnings,
    mismatched,
  };
}
