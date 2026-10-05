import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { runTrustedCommand } from "./bounded-command";
import {
  parseChecks,
  verifyTarget,
  type CommandResult,
  type CommandRunner,
} from "./merge-preflight";

export const mergeRequestSchema = "tailrocks.merge-pr-request/v1" as const;
export const mergeReceiptSchema = "tailrocks.merge-pr/v1" as const;

type MergeMethod = "merge" | "rebase" | "squash";
type QueueMode = "auto" | "never";

export type MergeOutcome =
  | "merged"
  | "pending"
  | "queued"
  | "blocked"
  | "failed"
  | "uncertain"
  | "refused";

export type MergeCode =
  | "landed"
  | "poll_expired"
  | "enqueued"
  | "checks_pending"
  | "invalid_request"
  | "authority_missing"
  | "target_cas_unavailable"
  | "closed"
  | "head_changed"
  | "target_mismatch"
  | "checks_failed"
  | "review_blocked"
  | "policy_blocked"
  | "merge_failed"
  | "verify_failed"
  | "state_unknown";

export interface MergeRequest {
  readonly schema: typeof mergeRequestSchema;
  readonly root: string;
  readonly repository: string;
  readonly pr: number;
  readonly head: string;
  readonly base: string;
  readonly mergeBase: string;
  readonly expectedBaseRef: string;
  readonly method: MergeMethod;
  readonly expectedTitle: string;
  readonly expectedBody: string;
  readonly blastRadius: "normal" | "high";
  readonly highBlastRadiusConfirmed: boolean;
  readonly waivers: readonly {
    readonly gate: "delivery" | "documentation";
    readonly reason: string;
  }[];
  readonly strictExactBase: boolean;
  readonly queue: QueueMode;
  readonly pollBoundMs: number;
  readonly reviewSnapshotRef?: string;
  readonly checksSnapshotRef?: string;
}

export interface MergeReceipt {
  readonly schema: typeof mergeReceiptSchema;
  readonly outcome: MergeOutcome;
  readonly code: MergeCode;
  readonly repository?: string;
  readonly pr?: number;
  readonly head?: string;
  readonly base?: string;
  readonly mergeBase?: string;
  readonly baseRef?: string;
  readonly method?: MergeMethod;
  readonly titleDigest?: string;
  readonly prBodyDigest?: string;
  readonly waivers?: MergeRequest["waivers"];
  readonly reviewSnapshotRef?: string;
  readonly checksSnapshotRef?: string;
  readonly observedHead?: string;
  readonly observedBase?: string;
  readonly mergeCommit?: string;
  readonly postMergeState?: string;
  readonly pollAttempts?: number;
  readonly mergeAttempted: boolean;
  readonly commands: readonly (readonly string[])[];
  readonly detail: string;
}

export interface MergeRuntime {
  readonly runner?: CommandRunner;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

const pollIntervalMs = 10_000;
const maxPollBoundMs = 300_000;
const maxOutputBytes = 5_000_000;

export const defaultMergeRunner: CommandRunner = ({ command, cwd }) =>
  runTrustedCommand({ command, cwd });

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted))
    throw new Error(`${label} has unknown or missing keys`);
}

function safeText(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value) > maximum ||
    /[\0\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    throw new Error(`${label} is invalid`);
  return value;
}

function safeSha(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function safeBranchName(value: unknown, label: string): string {
  const ref = safeText(value, label, 240);
  if (
    ref.includes("..") ||
    ref.includes("@{") ||
    ref.startsWith("/") ||
    ref.endsWith("/") ||
    ref.endsWith(".") ||
    ref.endsWith(".lock")
  )
    throw new Error(`${label} is invalid`);
  return ref;
}

function safeShortText(value: unknown, label: string): string {
  if (typeof value !== "string" || Buffer.byteLength(value) > 64 || /[\0-\x1f\x7f]/.test(value))
    throw new Error(`${label} is invalid`);
  return value;
}

function parseRequest(value: unknown): MergeRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("request is not an object");
  const input = value as Record<string, unknown>;
  const expected = [
    "base",
    "blastRadius",
    "expectedBaseRef",
    "expectedBody",
    "expectedTitle",
    "head",
    "highBlastRadiusConfirmed",
    "mergeBase",
    "method",
    "pollBoundMs",
    "pr",
    "queue",
    "repository",
    "root",
    "schema",
    "strictExactBase",
    "waivers",
    ...(input.reviewSnapshotRef === undefined ? [] : ["reviewSnapshotRef"]),
    ...(input.checksSnapshotRef === undefined ? [] : ["checksSnapshotRef"]),
  ];
  exactKeys(input, expected, "request");
  if (input.schema !== mergeRequestSchema) throw new Error("request schema is invalid");
  if (typeof input.root !== "string" || input.root.length === 0 || Buffer.byteLength(input.root) > 4_096)
    throw new Error("root is invalid");
  if (typeof input.repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository))
    throw new Error("repository is invalid");
  if (!Number.isSafeInteger(input.pr) || (input.pr as number) < 1) throw new Error("PR is invalid");
  const method = input.method;
  if (method !== "merge" && method !== "rebase" && method !== "squash")
    throw new Error("merge method is invalid");
  if (input.blastRadius !== "normal" && input.blastRadius !== "high")
    throw new Error("blast radius is invalid");
  if (typeof input.highBlastRadiusConfirmed !== "boolean")
    throw new Error("high-blast confirmation is invalid");
  if (typeof input.strictExactBase !== "boolean") throw new Error("strict-exact-base flag is invalid");
  if (input.queue !== "auto" && input.queue !== "never") throw new Error("queue mode is invalid");
  if (
    !Number.isSafeInteger(input.pollBoundMs) ||
    (input.pollBoundMs as number) < 0 ||
    (input.pollBoundMs as number) > maxPollBoundMs
  )
    throw new Error("poll bound is invalid");
  if (!Array.isArray(input.waivers) || input.waivers.length > 2) throw new Error("waivers are invalid");
  const waivers = input.waivers.map((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`waiver ${index + 1} is invalid`);
    const waiver = value as Record<string, unknown>;
    exactKeys(waiver, ["gate", "reason"], `waiver ${index + 1}`);
    if (waiver.gate !== "delivery" && waiver.gate !== "documentation")
      throw new Error(`waiver ${index + 1} gate is invalid`);
    return { gate: waiver.gate, reason: safeText(waiver.reason, `waiver ${index + 1} reason`, 2_000) };
  });
  if (new Set(waivers.map((waiver) => waiver.gate)).size !== waivers.length)
    throw new Error("waivers contain duplicate gates");
  return {
    schema: mergeRequestSchema,
    root: input.root,
    repository: input.repository,
    pr: input.pr as number,
    head: safeSha(input.head, "head"),
    base: safeSha(input.base, "base"),
    mergeBase: safeSha(input.mergeBase, "merge base"),
    expectedBaseRef: safeBranchName(input.expectedBaseRef, "expected base ref"),
    method,
    expectedTitle: safeText(input.expectedTitle, "expected title", 512),
    expectedBody: safeText(input.expectedBody, "expected body", 1_000_000),
    blastRadius: input.blastRadius,
    highBlastRadiusConfirmed: input.highBlastRadiusConfirmed,
    waivers,
    strictExactBase: input.strictExactBase,
    queue: input.queue,
    pollBoundMs: input.pollBoundMs as number,
    ...(input.reviewSnapshotRef === undefined
      ? {}
      : { reviewSnapshotRef: safeText(input.reviewSnapshotRef, "review snapshot ref", 512) }),
    ...(input.checksSnapshotRef === undefined
      ? {}
      : { checksSnapshotRef: safeText(input.checksSnapshotRef, "checks snapshot ref", 512) }),
  };
}

function baseReceipt(
  outcome: MergeOutcome,
  code: MergeCode,
  commands: readonly (readonly string[])[],
  detail: string,
): MergeReceipt {
  return { schema: mergeReceiptSchema, outcome, code, mergeAttempted: false, commands, detail };
}

function targetFields(request: MergeRequest) {
  return {
    repository: request.repository,
    pr: request.pr,
    head: request.head,
    base: request.base,
    mergeBase: request.mergeBase,
    baseRef: request.expectedBaseRef,
    method: request.method,
    titleDigest: createHash("sha256").update(request.expectedTitle).digest("hex"),
    prBodyDigest: createHash("sha256").update(request.expectedBody).digest("hex"),
    waivers: request.waivers,
    ...(request.reviewSnapshotRef ? { reviewSnapshotRef: request.reviewSnapshotRef } : {}),
    ...(request.checksSnapshotRef ? { checksSnapshotRef: request.checksSnapshotRef } : {}),
  };
}

type ReceiptExtra = Partial<
  Pick<
    MergeReceipt,
    "mergeAttempted" | "observedHead" | "observedBase" | "mergeCommit" | "postMergeState" | "pollAttempts"
  >
>;

async function canonicalRoot(input: string): Promise<string> {
  const absolute = path.resolve(input);
  const stats = await lstat(absolute);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("root must be a real directory");
  if ((await realpath(absolute)) !== absolute) throw new Error("root path may not traverse a symlink");
  return absolute;
}

async function invoke(
  runner: CommandRunner,
  commands: (readonly string[])[],
  cwd: string,
  command: readonly string[],
): Promise<CommandResult> {
  commands.push(command);
  try {
    return await runner({ command, cwd });
  } catch (error) {
    return { code: 127, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  }
}

async function requireCommand(
  runner: CommandRunner,
  commands: (readonly string[])[],
  cwd: string,
  command: readonly string[],
): Promise<string> {
  const result = await invoke(runner, commands, cwd, command);
  if (result.code !== 0 || result.timedOut) throw new Error(`command failed: ${command.join(" ")}`);
  if (Buffer.byteLength(result.stdout) > 10_000_000) throw new Error("command output is saturated");
  return result.stdout;
}

function strictObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is invalid`);
  return value as Record<string, unknown>;
}

function requireExactKeys(record: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) throw new Error(`${label} has an unmatched shape`);
}

interface MergePrState {
  readonly head: string;
  readonly base: string;
  readonly headRef: string;
  readonly baseRef: string;
  readonly title: string;
  readonly body: string;
  readonly reviewDecision: string;
  readonly mergeable: string;
  readonly mergeStateStatus: string;
}

function parseMergePrView(raw: string, pr: number): MergePrState {
  const value = strictObject(JSON.parse(raw), "pull request response");
  requireExactKeys(
    value,
    [
      "baseRefName",
      "baseRefOid",
      "body",
      "headRefName",
      "headRefOid",
      "mergeStateStatus",
      "mergeable",
      "number",
      "reviewDecision",
      "state",
      "title",
    ],
    "pull request response",
  );
  if (value.number !== pr) throw new Error("TARGET_MISMATCH: pull request number changed");
  if (value.state !== "OPEN") throw new Error("CLOSED: pull request is not open");
  return {
    head: safeSha(value.headRefOid, "pull request head"),
    base: safeSha(value.baseRefOid, "pull request base"),
    headRef: safeBranchName(value.headRefName, "pull request head ref"),
    baseRef: safeBranchName(value.baseRefName, "pull request base ref"),
    title: safeText(value.title, "pull request title", 512),
    body: typeof value.body === "string" && Buffer.byteLength(value.body) <= 1_000_000 ? value.body : (() => { throw new Error("pull request body is invalid"); })(),
    reviewDecision: safeShortText(value.reviewDecision, "review decision"),
    mergeable: safeShortText(value.mergeable, "mergeable state"),
    mergeStateStatus: safeShortText(value.mergeStateStatus, "merge state status"),
  };
}

function parseMethods(raw: string): { merge: boolean; squash: boolean; rebase: boolean } {
  const value = strictObject(JSON.parse(raw), "repository settings response");
  requireExactKeys(value, ["merge", "rebase", "squash"], "repository settings response");
  if (
    typeof value.merge !== "boolean" ||
    typeof value.squash !== "boolean" ||
    typeof value.rebase !== "boolean"
  )
    throw new Error("repository settings response has an unmatched shape");
  return { merge: value.merge, squash: value.squash, rebase: value.rebase };
}

function parseProtection(raw: string): {
  requiredApprovals: number;
  strict: boolean;
  requiredChecks: string[];
} {
  const value = strictObject(JSON.parse(raw), "branch protection response");
  requireExactKeys(value, ["approvals", "checks", "strict"], "branch protection response");
  const approvals = value.approvals === null ? 0 : value.approvals;
  if (!Number.isSafeInteger(approvals) || (approvals as number) < 0 || (approvals as number) > 100)
    throw new Error("branch protection response has an unmatched shape");
  const strict = value.strict === null ? false : value.strict;
  if (typeof strict !== "boolean")
    throw new Error("branch protection response has an unmatched shape");
  if (
    !Array.isArray(value.checks) ||
    value.checks.length > 500 ||
    value.checks.some((check) => typeof check !== "string" || check.length === 0 || check.length > 256)
  )
    throw new Error("branch protection response has an unmatched shape");
  return {
    requiredApprovals: approvals as number,
    strict,
    requiredChecks: value.checks as string[],
  };
}

function isMissingProtection(result: { code: number; stderr: string }): boolean {
  return result.code !== 0 && /(HTTP 404|Not Found|Branch not protected)/.test(result.stderr);
}

interface RestPull {
  readonly merged: boolean;
  readonly sha: string | null;
  readonly state: "open" | "closed";
  readonly base: string;
  readonly head: string;
}

function parseRestPull(raw: string): RestPull {
  const value = strictObject(JSON.parse(raw), "pull request status response");
  requireExactKeys(value, ["base", "head", "merged", "sha", "state"], "pull request status response");
  if (typeof value.merged !== "boolean")
    throw new Error("pull request status response has an unmatched shape");
  if (value.sha !== null) safeSha(value.sha, "merge commit SHA");
  if (value.state !== "open" && value.state !== "closed")
    throw new Error("pull request status response has an unmatched shape");
  return {
    merged: value.merged,
    sha: value.sha as string | null,
    state: value.state,
    base: safeBranchName(value.base, "pull request base ref"),
    head: safeSha(value.head, "pull request head"),
  };
}

function parseCommit(raw: string): { sha: string; parents: string[] } {
  const value = strictObject(JSON.parse(raw), "commit response");
  requireExactKeys(value, ["parents", "sha"], "commit response");
  if (!Array.isArray(value.parents) || value.parents.length > 100)
    throw new Error("commit response has an unmatched shape");
  for (const parent of value.parents) safeSha(parent, "commit parent");
  return { sha: safeSha(value.sha, "commit SHA"), parents: value.parents as string[] };
}

function parseCompare(raw: string): { status: string; base: string | null; ahead: number } {
  const value = strictObject(JSON.parse(raw), "compare response");
  requireExactKeys(value, ["ahead", "base", "status"], "compare response");
  if (value.base !== null) safeSha(value.base, "compare merge-base");
  if (!Number.isSafeInteger(value.ahead) || (value.ahead as number) < 0)
    throw new Error("compare response has an unmatched shape");
  if (
    value.status !== "ahead" &&
    value.status !== "behind" &&
    value.status !== "diverged" &&
    value.status !== "identical"
  )
    throw new Error("compare response has an unmatched shape");
  return { status: value.status, base: value.base as string | null, ahead: value.ahead as number };
}

function parseCombinedStatus(raw: string): { state: string } {
  const value = strictObject(JSON.parse(raw), "combined status response");
  requireExactKeys(value, ["state"], "combined status response");
  return { state: safeShortText(value.state, "combined status") };
}

function cleanDetail(value: string, maximum: number): string {
  return value.replace(/[\0-\x1f\x7f]+/g, " ").trim().slice(0, maximum);
}

async function queryRestPull(
  runner: CommandRunner,
  commands: (readonly string[])[],
  root: string,
  repository: string,
  pr: number,
): Promise<RestPull> {
  const raw = await requireCommand(runner, commands, root, [
    "gh",
    "api",
    `repos/${repository}/pulls/${pr}`,
    "--jq",
    "{merged: .merged, sha: .merge_commit_sha, state: .state, base: .base.ref, head: .head.sha}",
  ]);
  if (Buffer.byteLength(raw) > maxOutputBytes) throw new Error("pull request status output is saturated");
  return parseRestPull(raw);
}

export async function mergePullRequest(
  value: unknown,
  runtime: MergeRuntime = {},
): Promise<MergeReceipt> {
  const commands: (readonly string[])[] = [];
  let request: MergeRequest;
  try {
    request = parseRequest(value);
  } catch (error) {
    return baseReceipt(
      "refused",
      "invalid_request",
      commands,
      error instanceof Error ? error.message : String(error),
    );
  }
  const fields = targetFields(request);
  const fail = (outcome: MergeOutcome, code: MergeCode, detail: string, extra: ReceiptExtra = {}) => ({
    ...baseReceipt(outcome, code, commands, detail),
    ...fields,
    ...extra,
  });
  if (request.blastRadius === "high" && !request.highBlastRadiusConfirmed)
    return fail("refused", "authority_missing", "fresh high-blast confirmation is required");
  if (request.strictExactBase)
    return fail(
      "blocked",
      "target_cas_unavailable",
      `strict exact-base mode requires an atomic guard that binds base branch ${request.expectedBaseRef} to base OID ${request.base}; the supported route guards the PR head only (gh pr merge --match-head-commit); no supported mechanism provides the requested base-OID compare-and-swap, so that action is blocked; prefer a merge queue or a server-enforced freshness check when base freshness matters`,
    );

  const runner = runtime.runner ?? defaultMergeRunner;
  const now = runtime.now ?? (() => performance.now());
  const sleep = runtime.sleep ?? ((milliseconds: number) => Bun.sleep(milliseconds));
  let root: string;
  try {
    root = await canonicalRoot(request.root);
  } catch (error) {
    return fail(
      "refused",
      "invalid_request",
      error instanceof Error ? error.message : String(error),
    );
  }

  let target: { repository: string; pr: number; head: string; base: string; mergeBase: string };
  try {
    target = await verifyTarget(root, request.pr, undefined, runner, commands, request.repository);
  } catch (error) {
    return classifyPreAttempt(error, fail);
  }
  if (target.head !== request.head)
    return fail(
      "refused",
      "head_changed",
      `expected head ${request.head} but observed ${target.head}; rebind the request and retry`,
    );

  let state: MergePrState;
  try {
    state = parseMergePrView(
      await requireCommand(runner, commands, root, [
        "gh",
        "pr",
        "view",
        String(request.pr),
        "--repo",
        target.repository,
        "--json",
        "number,state,headRefOid,baseRefOid,headRefName,baseRefName,title,body,reviewDecision,mergeable,mergeStateStatus",
      ]),
      request.pr,
    );
  } catch (error) {
    return classifyRefresh(error, fail);
  }
  if (state.head !== request.head)
    return fail(
      "refused",
      "head_changed",
      `expected head ${request.head} but observed ${state.head}; rebind the request and retry`,
    );
  if (state.baseRef !== request.expectedBaseRef)
    return fail(
      "refused",
      "target_mismatch",
      `expected base branch ${request.expectedBaseRef} but observed ${state.baseRef}`,
    );
  if (state.title !== request.expectedTitle || state.body !== request.expectedBody)
    return fail(
      "refused",
      "target_mismatch",
      "PR title or body drifted since the request was bound; rebind the request and retry",
    );
  if (state.reviewDecision === "CHANGES_REQUESTED")
    return fail("blocked", "review_blocked", "a reviewer requested changes");
  if (state.reviewDecision === "REVIEW_REQUIRED")
    return fail("blocked", "review_blocked", "a required approval is missing");
  if (state.reviewDecision !== "APPROVED" && state.reviewDecision !== "")
    return fail(
      "blocked",
      "review_blocked",
      `review decision is unrecognized: ${state.reviewDecision || "empty"}`,
    );
  if (state.mergeable === "CONFLICTING" || state.mergeStateStatus === "DIRTY")
    return fail("blocked", "policy_blocked", "PR has merge conflicts");
  if (state.mergeStateStatus === "DRAFT")
    return fail("blocked", "policy_blocked", "PR is a draft; mark it ready before landing");
  if (
    state.mergeable === "UNKNOWN" ||
    state.mergeStateStatus === "UNKNOWN" ||
    state.mergeStateStatus === "BLOCKED"
  )
    return fail(
      "blocked",
      "policy_blocked",
      `mergeability is ${state.mergeable}/${state.mergeStateStatus}; retry when GitHub reports a final state`,
    );

  let methods: { merge: boolean; squash: boolean; rebase: boolean };
  try {
    const raw = await requireCommand(runner, commands, root, [
      "gh",
      "api",
      `repos/${target.repository}`,
      "--jq",
      "{merge: .allow_merge_commit, squash: .allow_squash_merge, rebase: .allow_rebase_merge}",
    ]);
    if (Buffer.byteLength(raw) > maxOutputBytes) throw new Error("repository settings output is saturated");
    methods = parseMethods(raw);
  } catch {
    return fail(
      "uncertain",
      "state_unknown",
      "repository settings lookup failed; query the remote state before retry",
    );
  }
  if (!methods[request.method])
    return fail(
      "blocked",
      "policy_blocked",
      `method ${request.method} is not permitted by repository settings`,
    );

  const protectionCommand = [
    "gh",
    "api",
    `repos/${target.repository}/branches/${encodeURIComponent(state.baseRef)}/protection`,
    "--jq",
    "{approvals: .required_pull_request_reviews.required_approving_review_count, strict: .required_status_checks.strict, checks: [.required_status_checks.checks[]?.context]}",
  ];
  const protectionResult = await invoke(runner, commands, root, protectionCommand);
  if (Buffer.byteLength(protectionResult.stdout) > maxOutputBytes)
    return fail(
      "uncertain",
      "state_unknown",
      "branch protection output is saturated; query the remote state before retry",
    );
  let protection: { present: boolean; strict: boolean; requiredChecks: string[] };
  if (protectionResult.code === 0 && !protectionResult.timedOut) {
    try {
      const parsed = parseProtection(protectionResult.stdout);
      protection = { present: true, strict: parsed.strict, requiredChecks: parsed.requiredChecks };
    } catch {
      return fail(
        "uncertain",
        "state_unknown",
        "branch protection response is unmatched; query the remote state before retry",
      );
    }
  } else if (isMissingProtection(protectionResult)) {
    protection = { present: false, strict: false, requiredChecks: [] };
  } else {
    return fail(
      "uncertain",
      "state_unknown",
      "branch protection lookup failed; query the remote state before retry",
    );
  }
  if (protection.present && protection.strict && state.mergeStateStatus === "BEHIND")
    return fail(
      "blocked",
      "policy_blocked",
      "the base branch requires an up-to-date PR and the PR is behind its base",
    );

  const checksResult = await invoke(runner, commands, root, [
    "gh",
    "pr",
    "checks",
    String(request.pr),
    "--repo",
    target.repository,
    "--required",
    "--json",
    "bucket,link,name,state,workflow",
  ]);
  if (![0, 1, 8].includes(checksResult.code) || checksResult.timedOut)
    return fail(
      "uncertain",
      "state_unknown",
      "required check lookup failed; query the remote state before retry",
    );
  if (Buffer.byteLength(checksResult.stdout) > maxOutputBytes)
    return fail(
      "uncertain",
      "state_unknown",
      "required check output is saturated; query the remote state before retry",
    );
  let checks: ReturnType<typeof parseChecks>;
  try {
    checks = parseChecks(checksResult.stdout);
  } catch {
    return fail(
      "uncertain",
      "state_unknown",
      "required check response is unmatched; query the remote state before retry",
    );
  }
  if (checks.some((check) => check.bucket === "fail" || check.bucket === "cancel"))
    return fail("blocked", "checks_failed", "one or more required checks failed or were cancelled");
  const noRequiredChecks = !protection.present || protection.requiredChecks.length === 0;
  if (checks.length === 0 && !noRequiredChecks)
    return fail(
      "blocked",
      "checks_failed",
      "required check lookup returned no checks; green status is unproven",
    );
  let route: "direct" | "enqueue" = "direct";
  if (checks.some((check) => check.bucket === "pending")) {
    if (request.queue === "never")
      return fail(
        "pending",
        "checks_pending",
        "required checks remain pending and queue=never forbids the enqueue route; no merge was attempted",
        { observedHead: state.head, observedBase: state.base },
      );
    route = "enqueue";
  }

  const methodFlag = request.method === "merge" ? "--merge" : request.method === "squash" ? "--squash" : "--rebase";
  const attemptCommand = [
    "gh",
    "pr",
    "merge",
    String(request.pr),
    "--repo",
    request.repository,
    methodFlag,
    "--match-head-commit",
    request.head,
    ...(route === "enqueue" ? ["--auto"] : []),
  ];
  const attempt = await invoke(runner, commands, root, attemptCommand);
  if (attempt.code !== 0 || attempt.timedOut) {
    let rest: RestPull;
    try {
      rest = await queryRestPull(runner, commands, root, request.repository, request.pr);
    } catch {
      return fail(
        "uncertain",
        "state_unknown",
        "the merge command failed and the PR state is unproven; query the remote state before retry",
        { mergeAttempted: true },
      );
    }
    if (!rest.merged) {
      if (rest.state === "closed")
        return fail("failed", "merge_failed", "the PR closed without merge; the candidate is retained", {
          mergeAttempted: true,
          observedHead: rest.head,
        });
      return fail(
        "failed",
        "merge_failed",
        `the merge command failed: ${cleanDetail(attempt.stderr || attempt.stdout, 500) || "no error text"}; the candidate is retained`,
        { mergeAttempted: true, observedHead: rest.head },
      );
    }
  }

  let started: number;
  try {
    started = now();
    if (!Number.isFinite(started) || started < 0) throw new Error("monotonic clock is invalid");
  } catch (error) {
    return fail(
      "uncertain",
      "state_unknown",
      error instanceof Error ? error.message : String(error),
      { mergeAttempted: true },
    );
  }
  let pollAttempts = 0;
  let observedPostAttempt = false;
  let observedHead = state.head;
  while (true) {
    let rest: RestPull | undefined;
    try {
      rest = await queryRestPull(runner, commands, root, request.repository, request.pr);
    } catch {
      rest = undefined;
    }
    pollAttempts += 1;
    if (rest !== undefined) {
      observedPostAttempt = true;
      observedHead = rest.head;
      if (rest.base !== request.expectedBaseRef)
        return fail(
          "failed",
          "verify_failed",
          `the PR base is ${rest.base} but the request binds ${request.expectedBaseRef}; the candidate is retained`,
          { mergeAttempted: true, observedHead, pollAttempts },
        );
      if (rest.merged && rest.sha !== null)
        return verifyLanding(runner, commands, root, request, fail, rest.sha, observedHead, pollAttempts);
      if (rest.merged)
        return fail(
          "uncertain",
          "state_unknown",
          "GitHub reports merged without a merge commit SHA; query the remote state before retry",
          { mergeAttempted: true, observedHead, pollAttempts },
        );
      if (rest.state === "closed")
        return fail("failed", "merge_failed", "the PR closed without merge; the candidate is retained", {
          mergeAttempted: true,
          observedHead,
          pollAttempts,
        });
    }
    let elapsed: number;
    try {
      elapsed = now() - started;
    } catch (error) {
      return fail(
        "uncertain",
        "state_unknown",
        error instanceof Error ? error.message : String(error),
        { mergeAttempted: true, observedHead, pollAttempts },
      );
    }
    if (!Number.isFinite(elapsed) || elapsed < 0)
      return fail("uncertain", "state_unknown", "monotonic clock moved backwards", {
        mergeAttempted: true,
        observedHead,
        pollAttempts,
      });
    if (elapsed >= request.pollBoundMs) {
      if (!observedPostAttempt)
        return fail(
          "uncertain",
          "state_unknown",
          "no post-attempt PR observation succeeded; query the remote state before retry",
          { mergeAttempted: true, observedHead, pollAttempts },
        );
      if (route === "enqueue")
        return fail(
          "queued",
          "enqueued",
          `the merge request was accepted but the PR is still open at the ${request.pollBoundMs}ms bound; it remains queued`,
          { mergeAttempted: true, observedHead, pollAttempts },
        );
      return fail(
        "pending",
        "poll_expired",
        `the merge was accepted but the PR is still open at the ${request.pollBoundMs}ms bound`,
        { mergeAttempted: true, observedHead, pollAttempts },
      );
    }
    try {
      await sleep(Math.min(pollIntervalMs, Math.max(0, request.pollBoundMs - elapsed)));
    } catch (error) {
      return fail(
        "uncertain",
        "state_unknown",
        `poll wait failed: ${error instanceof Error ? error.message : String(error)}`,
        { mergeAttempted: true, observedHead, pollAttempts },
      );
    }
  }
}

type FailReceipt = (
  outcome: MergeOutcome,
  code: MergeCode,
  detail: string,
  extra?: ReceiptExtra,
) => MergeReceipt;

function classifyPreAttempt(error: unknown, fail: FailReceipt): MergeReceipt {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail.startsWith("NOT_GIT_REPO:")) return fail("refused", "invalid_request", detail);
  if (detail.startsWith("TARGET_MISMATCH:")) return fail("refused", "target_mismatch", detail);
  if (detail.startsWith("HEAD_CHANGED:")) return fail("refused", "head_changed", detail);
  if (detail.startsWith("CLOSED:")) return fail("refused", "closed", detail);
  return fail(
    "uncertain",
    "state_unknown",
    `${detail}; query the remote state before retry`,
  );
}

function classifyRefresh(error: unknown, fail: FailReceipt): MergeReceipt {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail.startsWith("TARGET_MISMATCH:")) return fail("refused", "target_mismatch", detail);
  if (detail.startsWith("CLOSED:")) return fail("refused", "closed", detail);
  return fail(
    "uncertain",
    "state_unknown",
    `PR state refresh failed: ${cleanDetail(detail, 300)}; query the remote state before retry`,
  );
}

async function verifyLanding(
  runner: CommandRunner,
  commands: (readonly string[])[],
  root: string,
  request: MergeRequest,
  fail: FailReceipt,
  mergeSha: string,
  observedHead: string,
  pollAttempts: number,
): Promise<MergeReceipt> {
  const attempted: ReceiptExtra = { mergeAttempted: true, observedHead, pollAttempts };
  let commit: { sha: string; parents: string[] };
  try {
    const raw = await requireCommand(runner, commands, root, [
      "gh",
      "api",
      `repos/${request.repository}/git/commits/${mergeSha}`,
      "--jq",
      "{sha: .sha, parents: [.parents[].sha]}",
    ]);
    if (Buffer.byteLength(raw) > maxOutputBytes) throw new Error("commit output is saturated");
    commit = parseCommit(raw);
  } catch {
    return fail(
      "uncertain",
      "state_unknown",
      "merge commit lookup failed; query the remote state before retry",
      attempted,
    );
  }
  if (commit.sha !== mergeSha)
    return fail(
      "failed",
      "verify_failed",
      "merge commit identity mismatch; the candidate is retained",
      attempted,
    );
  let compare: { status: string; base: string | null; ahead: number };
  try {
    const raw = await requireCommand(runner, commands, root, [
      "gh",
      "api",
      `repos/${request.repository}/compare/${mergeSha}...${encodeURIComponent(request.expectedBaseRef)}`,
      "--jq",
      "{status: .status, base: .merge_base_commit.sha, ahead: .ahead_by}",
    ]);
    if (Buffer.byteLength(raw) > maxOutputBytes) throw new Error("compare output is saturated");
    compare = parseCompare(raw);
  } catch {
    return fail(
      "uncertain",
      "state_unknown",
      "target history lookup failed; query the remote state before retry",
      attempted,
    );
  }
  if (compare.base !== mergeSha || (compare.status !== "ahead" && compare.status !== "identical"))
    return fail(
      "failed",
      "verify_failed",
      "the merge commit is not an ancestor of the current target tip; the candidate is retained",
      attempted,
    );
  if (request.method === "merge" && commit.parents.length < 2)
    return fail(
      "failed",
      "verify_failed",
      `the merge method requires a merge commit but the commit has ${commit.parents.length} parent(s); the candidate is retained`,
      attempted,
    );
  if (request.method !== "merge" && commit.parents.length !== 1)
    return fail(
      "failed",
      "verify_failed",
      `the ${request.method} method requires a single-parent commit but the commit has ${commit.parents.length} parent(s); the candidate is retained`,
      attempted,
    );
  if (request.method === "merge" && !commit.parents.includes(request.head))
    return fail(
      "failed",
      "verify_failed",
      "the merge commit does not contain the reviewed head; the candidate is retained",
      attempted,
    );
  if (request.method !== "merge") {
    let behavior: { ahead: number };
    try {
      const raw = await requireCommand(runner, commands, root, [
        "gh",
        "api",
        `repos/${request.repository}/compare/${request.mergeBase}...${mergeSha}`,
        "--jq",
        "{status: .status, base: .merge_base_commit.sha, ahead: .ahead_by}",
      ]);
      if (Buffer.byteLength(raw) > maxOutputBytes) throw new Error("compare output is saturated");
      behavior = parseCompare(raw);
    } catch {
      return fail(
        "uncertain",
        "state_unknown",
        "behavior comparison failed; query the remote state before retry",
        attempted,
      );
    }
    if (behavior.ahead < 1)
      return fail(
        "failed",
        "verify_failed",
        "the merge commit adds no commits beyond the recorded merge-base; the candidate is retained",
        attempted,
      );
  }
  let postMergeState = "unknown";
  try {
    const raw = await requireCommand(runner, commands, root, [
      "gh",
      "api",
      `repos/${request.repository}/commits/${mergeSha}/status`,
      "--jq",
      "{state: .state}",
    ]);
    if (Buffer.byteLength(raw) <= maxOutputBytes) postMergeState = parseCombinedStatus(raw).state;
  } catch {
    postMergeState = "unknown";
  }
  return fail(
    "merged",
    "landed",
    `PR #${request.pr} merged into ${request.repository} ${request.expectedBaseRef} as ${mergeSha}; post-merge combined status: ${postMergeState}`,
    { ...attempted, mergeCommit: mergeSha, postMergeState },
  );
}

async function readStdin(maximumBytes = 4_000_000, timeoutMilliseconds = 5_000): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("stdin timed out")), timeoutMilliseconds);
    process.stdin.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > maximumBytes) {
        clearTimeout(timer);
        process.stdin.destroy();
        reject(new Error("stdin is saturated"));
      } else chunks.push(chunk);
    });
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString());
    });
    process.stdin.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export const readMergeRequestStdin = readStdin;
