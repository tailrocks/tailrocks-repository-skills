import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { runBoundedCommand, runTrustedCommand } from "./bounded-command";
import { resolveExecutable } from "./resolve-executable";

export const createPrInputSchema = "tailrocks.create-pr-input/v1" as const;
export const createPrReceiptSchema = "tailrocks.create-pr/v1" as const;
export const gateProofSchema = "tailrocks.gate-proof/v1" as const;

interface GateInput {
  readonly id: string;
  readonly command: readonly string[];
  readonly proof_command: readonly string[];
}

interface CandidateIdentity {
  readonly base_repository: string;
  readonly head_repository: string;
  readonly head_ref: string;
  readonly base_ref: string;
  readonly group: string;
  readonly head_oid: string;
}

interface CreatePrInput {
  readonly schema: typeof createPrInputSchema;
  readonly repo_root: string;
  readonly repository: string;
  readonly actor: string;
  readonly head_owner: string;
  readonly remote_name: string;
  readonly remote_url: string;
  readonly base_branch: string;
  readonly base_sha: string;
  readonly head_branch: string;
  readonly head_sha: string;
  readonly candidate: CandidateIdentity;
  readonly allow_reuse: boolean;
  readonly expected_remote_head?: string;
  readonly title: string;
  readonly body_file: string;
  readonly body_sha256: string;
  readonly draft: boolean;
  readonly required_trailers: readonly string[];
  readonly gates: readonly GateInput[];
}

export interface CreatePrCommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut?: boolean;
  readonly saturated?: boolean;
}

export interface CreatePrCommandRequest {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly stdin?: string | Uint8Array;
}

export type CreatePrRunner = (request: CreatePrCommandRequest) => Promise<CreatePrCommandResult>;

export interface CreatePrRuntime {
  readonly localRunner?: CreatePrRunner;
  readonly gateRunner?: CreatePrRunner;
  readonly remoteRunner?: CreatePrRunner;
  readonly gitExecutable?: string;
  readonly ghExecutable?: string;
}

interface GateReceipt {
  readonly id: string;
  readonly command: readonly string[];
  readonly proof_command: readonly string[];
  readonly outcome: "passed" | "failed" | "vacuous";
  readonly units: number;
  readonly output_sha256: string;
}

interface ExternalReceipt {
  readonly kind:
    | "actor"
    | "base_ref"
    | "existing_pr"
    | "prior_closed"
    | "push"
    | "remote_ref"
    | "create"
    | "render";
  readonly command: readonly string[];
  readonly outcome: "success" | "failed" | "uncertain";
  readonly proof: string;
}

export interface PrMatch {
  readonly number: number;
  readonly url: string;
  readonly base: string;
  readonly head: string;
}

export interface PriorClosedPr {
  readonly number: number;
  readonly url: string;
}

export interface CreatePrReceipt {
  readonly schema: typeof createPrReceiptSchema;
  readonly outcome: "success" | "reused" | "decision_required" | "refused" | "recovery_required";
  readonly code:
    | "opened"
    | "reused"
    | "decision_required"
    | "invalid_input"
    | "state_drift"
    | "gate_failed"
    | "gate_vacuous"
    | "push_failed"
    | "remote_ref_failed"
    | "create_failed"
    | "render_failed";
  readonly repository: string;
  readonly branch: string;
  readonly head: string;
  readonly url: string;
  readonly pr_number?: number;
  readonly observed_base?: string;
  readonly matches?: readonly PrMatch[];
  readonly prior_closed?: readonly PriorClosedPr[];
  readonly executed_units: number;
  readonly gates: readonly GateReceipt[];
  readonly external_actions: readonly ExternalReceipt[];
  readonly detail: string;
}

interface OpenPullRequest {
  readonly number: number;
  readonly url: string;
  readonly state: string;
  readonly base_ref: string;
  readonly base_sha: string;
  readonly head_ref: string;
  readonly head_sha: string;
  readonly head_repo: string;
  readonly author: string;
}

const shaPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const digestPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const repositoryPattern =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/;
const maximumInputBytes = 1_000_000;
const maximumBodyBytes = 1_000_000;
const maximumGates = 32;

function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index]))
    throw new Error(`${label} has unknown or missing fields`);
}

function safeText(value: unknown, label: string, maximum: number): string {
  const hasControl =
    typeof value === "string" &&
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    });
  if (typeof value !== "string" || !value || Buffer.byteLength(value) > maximum || hasControl)
    throw new Error(`${label} is invalid`);
  return value;
}

function safeRef(value: unknown, label: string): string {
  const ref = safeText(value, label, 240);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) ||
    ref.includes("..") ||
    ref.includes("@{") ||
    ref.endsWith("/") ||
    ref.endsWith(".") ||
    ref.endsWith(".lock") ||
    ref.split("/").some((part) => !part || part === ".")
  )
    throw new Error(`${label} is invalid`);
  return ref;
}

function canonicalRepository(value: unknown): string {
  const repository = safeText(value, "repository", 140);
  const [, name = ""] = repository.split("/");
  if (!repositoryPattern.test(repository) || name.includes("..") || name.endsWith("."))
    throw new Error("repository is invalid");
  return repository;
}

function canonicalRemote(value: unknown): string {
  const raw = safeText(value, "remote_url", 300);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("remote_url is invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("remote_url is invalid");
  const repository = url.pathname.replace(/^\//, "").replace(/\.git$/, "");
  canonicalRepository(repository);
  return `https://github.com/${repository}.git`;
}

function parseCommand(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64)
    throw new Error(`${label} must be a bounded argv array`);
  const command = value.map((part, index) => safeText(part, `${label}[${index}]`, 8_192));
  if (!path.isAbsolute(command[0]!)) throw new Error(`${label} executable must be absolute`);
  if (command.reduce((total, part) => total + Buffer.byteLength(part), 0) > 64_000)
    throw new Error(`${label} is too large`);
  return command;
}

function parseCandidate(value: unknown): CandidateIdentity {
  const candidate = object(value, "candidate");
  exactKeys(
    candidate,
    ["base_repository", "head_repository", "head_ref", "base_ref", "group", "head_oid"],
    "candidate",
  );
  const headOid = candidate.head_oid;
  if (typeof headOid !== "string" || !shaPattern.test(headOid)) throw new Error("candidate head_oid is invalid");
  return {
    base_repository: canonicalRepository(candidate.base_repository),
    head_repository: canonicalRepository(candidate.head_repository),
    head_ref: safeRef(candidate.head_ref, "candidate head_ref"),
    base_ref: safeRef(candidate.base_ref, "candidate base_ref"),
    group: safeText(candidate.group, "candidate group", 128),
    head_oid: headOid,
  };
}

function parseInput(raw: unknown): CreatePrInput {
  const value = object(raw, "input");
  exactKeys(
    value,
    [
      "schema",
      "repo_root",
      "repository",
      "actor",
      "head_owner",
      "remote_name",
      "remote_url",
      "base_branch",
      "base_sha",
      "head_branch",
      "head_sha",
      "candidate",
      "allow_reuse",
      "title",
      "body_file",
      "body_sha256",
      "draft",
      "required_trailers",
      "gates",
      ...(value.expected_remote_head === undefined ? [] : ["expected_remote_head"]),
    ],
    "input",
  );
  if (value.schema !== createPrInputSchema) throw new Error("input schema is invalid");
  if (typeof value.repo_root !== "string" || !path.isAbsolute(value.repo_root))
    throw new Error("repo_root must be absolute");
  const repository = canonicalRepository(value.repository);
  const actor = safeText(value.actor, "actor", 39);
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(actor)) throw new Error("actor is invalid");
  const headOwner = safeText(value.head_owner, "head_owner", 39);
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(headOwner)) throw new Error("head_owner is invalid");
  const remoteName = safeText(value.remote_name, "remote_name", 64);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remoteName)) throw new Error("remote_name is invalid");
  const remoteUrl = canonicalRemote(value.remote_url);
  const repositoryName = repository.split("/")[1]!;
  if (remoteUrl !== `https://github.com/${headOwner}/${repositoryName}.git`)
    throw new Error("remote_url differs from head owner and repository");
  const baseBranch = safeRef(value.base_branch, "base_branch");
  const headBranch = safeRef(value.head_branch, "head_branch");
  if (baseBranch === headBranch) throw new Error("head branch must differ from base branch");
  if (typeof value.base_sha !== "string" || !shaPattern.test(value.base_sha))
    throw new Error("base_sha is invalid");
  if (typeof value.head_sha !== "string" || !shaPattern.test(value.head_sha))
    throw new Error("head_sha is invalid");
  const candidate = parseCandidate(value.candidate);
  if (typeof value.allow_reuse !== "boolean") throw new Error("allow_reuse must be boolean");
  const expectedRemoteHead =
    value.expected_remote_head === undefined ? undefined : value.expected_remote_head;
  if (expectedRemoteHead !== undefined && (typeof expectedRemoteHead !== "string" || !shaPattern.test(expectedRemoteHead)))
    throw new Error("expected_remote_head is invalid");
  if (
    candidate.base_repository !== repository ||
    candidate.head_repository !== `${headOwner}/${repositoryName}` ||
    candidate.head_ref !== headBranch ||
    candidate.base_ref !== baseBranch ||
    candidate.head_oid !== value.head_sha
  )
    throw new Error("candidate tuple differs from the declared branch identity");
  const title = safeText(value.title, "title", 256);
  if (typeof value.body_file !== "string" || !path.isAbsolute(value.body_file))
    throw new Error("body_file must be absolute");
  if (typeof value.body_sha256 !== "string" || !digestPattern.test(value.body_sha256))
    throw new Error("body_sha256 is invalid");
  if (typeof value.draft !== "boolean") throw new Error("draft must be boolean");
  if (!Array.isArray(value.required_trailers) || value.required_trailers.length > 16)
    throw new Error("required_trailers must be a bounded array");
  const requiredTrailers = value.required_trailers.map((entry, index) => {
    const trailer = safeText(entry, `required_trailers[${index}]`, 64);
    if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(trailer)) throw new Error("required trailer is invalid");
    return trailer;
  });
  if (new Set(requiredTrailers).size !== requiredTrailers.length)
    throw new Error("required trailers must be unique");
  if (!Array.isArray(value.gates) || value.gates.length === 0 || value.gates.length > maximumGates)
    throw new Error("at least one bounded gate is required");
  const gateIds = new Set<string>();
  const gates = value.gates.map((entry, index) => {
    const gate = object(entry, `gates[${index}]`);
    exactKeys(gate, ["id", "command", "proof_command"], `gates[${index}]`);
    if (typeof gate.id !== "string" || !idPattern.test(gate.id) || gateIds.has(gate.id))
      throw new Error("gate id is invalid or duplicated");
    gateIds.add(gate.id);
    return {
      id: gate.id,
      command: parseCommand(gate.command, `gates[${index}].command`),
      proof_command: parseCommand(gate.proof_command, `gates[${index}].proof_command`),
    };
  });
  return {
    schema: createPrInputSchema,
    repo_root: value.repo_root,
    repository,
    actor,
    head_owner: headOwner,
    remote_name: remoteName,
    remote_url: remoteUrl,
    base_branch: baseBranch,
    base_sha: value.base_sha,
    head_branch: headBranch,
    head_sha: value.head_sha,
    candidate,
    allow_reuse: value.allow_reuse,
    ...(expectedRemoteHead === undefined ? {} : { expected_remote_head: expectedRemoteHead }),
    title,
    body_file: value.body_file,
    body_sha256: value.body_sha256,
    draft: value.draft,
    required_trailers: requiredTrailers,
    gates,
  } as CreatePrInput;
}

async function safeRegularFile(file: string, maximumBytes: number, label: string): Promise<Buffer> {
  const resolved = path.resolve(file);
  const before = await lstat(resolved);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size > maximumBytes ||
    (await realpath(resolved)) !== resolved
  )
    throw new Error(`${label} is not a bounded canonical regular file`);
  const body = await readFile(resolved);
  const after = await lstat(resolved);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  )
    throw new Error(`${label} changed while read`);
  return body;
}

async function safeExecutable(file: string): Promise<void> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || (await realpath(file)) !== file)
    throw new Error(`unsafe command executable: ${file}`);
}

const defaultLocalRunner: CreatePrRunner = async ({ command, cwd }) => {
  await safeExecutable(command[0]!);
  return runBoundedCommand({
    command,
    cwd,
    timeoutMilliseconds: 120_000,
    maximumOutputBytes: 4_000_000,
    env: {
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    },
    inheritEnvironment: false,
  });
};

const defaultRemoteRunner: CreatePrRunner = ({ command, cwd, stdin }) => {
  const executable = command[0];
  if (!executable || !path.isAbsolute(executable))
    throw new Error("remote lifecycle executable must be absolute");
  const name = path.basename(executable);
  if (name !== "git" && name !== "gh")
    throw new Error("remote lifecycle executable is not trusted");
  return runTrustedCommand({
    command: [name, ...command.slice(1)],
    cwd,
    stdin,
    timeoutMilliseconds: 120_000,
    maximumOutputBytes: 4_000_000,
  });
};

function sandboxPath(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function isolatedGateRunner(workspace: string): CreatePrRunner {
  const environment = {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: path.join(workspace, ".gate-home"),
    TMPDIR: path.join(workspace, ".gate-tmp"),
    CI: "1",
  };
  if (process.platform === "darwin") {
    const sandbox = "/usr/bin/sandbox-exec";
    const profile = [
      "(version 1)",
      '(import "system.sb")',
      "(allow process*)",
      "(allow file-read*)",
      "(deny network*)",
      `(allow file-write* (subpath "${sandboxPath(workspace)}"))`,
    ].join(" ");
    return ({ command }) =>
      runBoundedCommand({
        command: [sandbox, "-p", profile, "--", ...command],
        cwd: workspace,
        timeoutMilliseconds: 120_000,
        maximumOutputBytes: 4_000_000,
        env: environment,
        inheritEnvironment: false,
      });
  }
  if (process.platform === "linux") {
    const bubblewrap = "/usr/bin/bwrap";
    return async ({ command }) => {
      await safeExecutable(bubblewrap);
      return runBoundedCommand({
        command: [
          bubblewrap,
          "--unshare-net",
          "--die-with-parent",
          "--new-session",
          "--ro-bind",
          "/",
          "/",
          "--bind",
          workspace,
          workspace,
          "--chdir",
          workspace,
          ...command,
        ],
        cwd: workspace,
        timeoutMilliseconds: 120_000,
        maximumOutputBytes: 4_000_000,
        env: environment,
        inheritEnvironment: false,
      });
    };
  }
  throw new Error("a supported network-denied gate sandbox is unavailable");
}

async function prepareWorkspace(
  input: CreatePrInput,
  gitExecutable: string,
  runner: CreatePrRunner,
  purpose: "gate" | "push",
  checkoutHead: boolean,
): Promise<string> {
  let parent: string | undefined;
  let retained = false;
  try {
    const created = await mkdtemp(path.join(tmpdir(), `tailrocks-create-pr-${purpose}-`));
    parent = created;
    parent = await realpath(created);
    await chmod(parent, 0o700);
    const template = path.join(parent, "empty-template");
    await mkdir(template, { mode: 0o700 });
    const workspace = path.join(parent, "subject");
    const clone = await runner({
      command: [
        gitExecutable,
        "clone",
        "--quiet",
        "--local",
        "--no-hardlinks",
        "--no-checkout",
        "--template",
        template,
        input.repo_root,
        workspace,
      ],
      cwd: parent,
    });
    if (!commandSucceeded(clone))
      throw new Error(`failed to create isolated ${purpose} workspace`);
    if (checkoutHead) {
      const checkout = await runner({
        command: [
          gitExecutable,
          "-c",
          "filter.lfs.smudge=",
          "-c",
          "filter.lfs.process=",
          "-c",
          "filter.lfs.required=false",
          "checkout",
          "--quiet",
          "--detach",
          input.head_sha,
        ],
        cwd: workspace,
      });
      if (!commandSucceeded(checkout)) throw new Error("failed to materialize exact gate revision");
    }
    if (purpose === "gate")
      await Promise.all([
        mkdir(path.join(workspace, ".gate-home"), { mode: 0o700 }),
        mkdir(path.join(workspace, ".gate-tmp"), { mode: 0o700 }),
      ]);
    retained = true;
    return workspace;
  } finally {
    if (!retained && parent) await rm(parent, { recursive: true, force: true });
  }
}

async function prepareGateWorkspace(
  input: CreatePrInput,
  gitExecutable: string,
  runner: CreatePrRunner,
): Promise<string> {
  return prepareWorkspace(input, gitExecutable, runner, "gate", true);
}

async function preparePushWorkspace(
  input: CreatePrInput,
  gitExecutable: string,
  runner: CreatePrRunner,
): Promise<string> {
  return prepareWorkspace(input, gitExecutable, runner, "push", false);
}

function baseReceipt(code: CreatePrReceipt["code"], detail: string): CreatePrReceipt {
  return {
    schema: createPrReceiptSchema,
    outcome: "refused",
    code,
    repository: "",
    branch: "",
    head: "",
    url: "",
    executed_units: 0,
    gates: [],
    external_actions: [],
    detail,
  };
}

function commandSucceeded(result: CreatePrCommandResult): boolean {
  return result.code === 0 && !result.timedOut && !result.saturated;
}

async function repositorySnapshot(
  input: CreatePrInput,
  gitExecutable: string,
  runner: CreatePrRunner,
): Promise<void> {
  const run = async (args: readonly string[]): Promise<string> => {
    const result = await runner({ command: [gitExecutable, ...args], cwd: input.repo_root });
    if (!commandSucceeded(result)) throw new Error("repository identity command failed");
    return result.stdout;
  };
  if ((await run(["rev-parse", "--show-toplevel"])).trim() !== input.repo_root)
    throw new Error("repo_root is not the exact Git top level");
  if ((await run(["symbolic-ref", "--short", "HEAD"])).trim() !== input.head_branch)
    throw new Error("current branch drifted");
  if ((await run(["rev-parse", "HEAD"])).trim() !== input.head_sha) throw new Error("HEAD drifted");
  if ((await run(["status", "--porcelain=v1", "--untracked-files=all"])).length !== 0)
    throw new Error("working tree is dirty");
  await run(["merge-base", "--is-ancestor", input.base_sha, input.head_sha]);
  const count = Number((await run(["rev-list", "--count", `${input.base_sha}..${input.head_sha}`])).trim());
  if (!Number.isSafeInteger(count) || count < 1) throw new Error("pull request commit range is empty");
  const commitBodies = (await run(["log", "--format=%B%x00", `${input.base_sha}..${input.head_sha}`]))
    .split("\0")
    .map((body) => body.trim())
    .filter(Boolean);
  if (commitBodies.length !== count) throw new Error("commit range proof is inconsistent");
  for (const trailer of input.required_trailers) {
    const pattern = new RegExp(`^${trailer}:\\s+\\S`, "mi");
    if (commitBodies.some((body) => !pattern.test(body)))
      throw new Error(`commit is missing required trailer: ${trailer}`);
  }
  if ((await run(["remote", "get-url", input.remote_name])).trim() !== input.remote_url)
    throw new Error("push remote identity drifted");
}

function parseProof(stdout: string): number {
  const lines = stdout.trim().split("\n");
  if (lines.length !== 1) return 0;
  try {
    const value = object(JSON.parse(lines[0]!) as unknown, "gate proof");
    exactKeys(value, ["schema", "units"], "gate proof");
    return value.schema === gateProofSchema &&
      Number.isSafeInteger(value.units) &&
      (value.units as number) > 0
      ? (value.units as number)
      : 0;
  } catch {
    return 0;
  }
}

function external(
  kind: ExternalReceipt["kind"],
  command: readonly string[],
  outcome: ExternalReceipt["outcome"],
  proof: string,
): ExternalReceipt {
  return { kind, command, outcome, proof };
}

async function runRemoteWithReceipt(
  runner: CreatePrRunner,
  request: CreatePrCommandRequest,
  kind: ExternalReceipt["kind"],
  receipts: ExternalReceipt[],
): Promise<CreatePrCommandResult> {
  try {
    return await runner(request);
  } catch (error) {
    receipts.push(external(kind, request.command, "uncertain", ""));
    throw error;
  }
}

function parsePullRequestEntry(entry: unknown, repository: string): OpenPullRequest {
  const record = object(entry, "pull request entry");
  const number = record.number;
  if (!Number.isSafeInteger(number) || (number as number) < 1)
    throw new Error("pull request entry number is invalid");
  const url = record.html_url;
  if (typeof url !== "string" || !exactPrUrl(url, repository) || !url.endsWith(`/${number}`))
    throw new Error("pull request entry URL is invalid");
  if (record.state !== "open") throw new Error("pull request entry state is invalid");
  const base = object(record.base, "pull request entry base");
  const head = object(record.head, "pull request entry head");
  const headRepo = object(head.repo, "pull request entry head repo");
  const user = object(record.user, "pull request entry author");
  const author = user.login;
  if (typeof author !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(author))
    throw new Error("pull request entry author is invalid");
  if (typeof base.sha !== "string" || !shaPattern.test(base.sha))
    throw new Error("pull request entry base SHA is invalid");
  if (typeof head.sha !== "string" || !shaPattern.test(head.sha))
    throw new Error("pull request entry head SHA is invalid");
  return {
    number: number as number,
    url,
    state: "open",
    base_ref: safeRef(base.ref, "pull request entry base ref"),
    base_sha: base.sha,
    head_ref: safeRef(head.ref, "pull request entry head ref"),
    head_sha: head.sha,
    head_repo: canonicalRepository(headRepo.full_name),
    author,
  };
}

function parsePullRequestPages(stdout: string, repository: string): OpenPullRequest[] {
  let existing: unknown = null;
  try {
    existing = JSON.parse(stdout) as unknown;
  } catch {
    throw new Error("existing open pull request lookup failed");
  }
  if (!Array.isArray(existing)) throw new Error("existing open pull request lookup failed");
  const pullRequests = (existing as unknown[]).flatMap((page) => (Array.isArray(page) ? page : [page]));
  if (pullRequests.length > 100) throw new Error("open pull request list is saturated");
  return pullRequests.map((entry) => parsePullRequestEntry(entry, repository));
}

async function queryOpenPullRequests(
  input: CreatePrInput,
  ghExecutable: string,
  root: string,
  runner: CreatePrRunner,
  receipts: ExternalReceipt[],
): Promise<OpenPullRequest[]> {
  const existingCommand = [
    ghExecutable,
    "api",
    `repos/${input.repository}/pulls`,
    "--method",
    "GET",
    "-f",
    "state=open",
    "-f",
    `head=${input.head_owner}:${input.head_branch}`,
    "-f",
    "per_page=100",
    "--paginate",
    "--slurp",
  ];
  const existingResult = await runRemoteWithReceipt(
    runner,
    { command: existingCommand, cwd: root },
    "existing_pr",
    receipts,
  );
  let matches: OpenPullRequest[] = [];
  try {
    if (!commandSucceeded(existingResult)) throw new Error("existing open pull request lookup failed");
    matches = parsePullRequestPages(existingResult.stdout, input.repository);
  } catch (error) {
    receipts.push(external("existing_pr", existingCommand, "failed", digest(existingResult.stdout)));
    throw error;
  }
  receipts.push(external("existing_pr", existingCommand, "success", `count=${matches.length}`));
  return matches;
}

async function queryClosedPullRequests(
  input: CreatePrInput,
  ghExecutable: string,
  root: string,
  runner: CreatePrRunner,
  receipts: ExternalReceipt[],
): Promise<{ closed: PriorClosedPr[]; screened: boolean; total: number }> {
  const closedCommand = [
    ghExecutable,
    "api",
    `repos/${input.repository}/pulls`,
    "--method",
    "GET",
    "-f",
    "state=closed",
    "-f",
    `head=${input.head_owner}:${input.head_branch}`,
    "-f",
    "per_page=100",
    "--paginate",
    "--slurp",
  ];
  const closedResult = await runRemoteWithReceipt(
    runner,
    { command: closedCommand, cwd: root },
    "prior_closed",
    receipts,
  );
  try {
    if (!commandSucceeded(closedResult)) throw new Error("closed pull request lookup failed");
    const pages = JSON.parse(closedResult.stdout) as unknown;
    if (!Array.isArray(pages)) throw new Error("closed pull request lookup failed");
    const entries = (pages as unknown[]).flatMap((page) => (Array.isArray(page) ? page : [page]));
    const unmerged: PriorClosedPr[] = [];
    for (const entry of entries) {
      const record = object(entry, "closed pull request entry");
      if (record.state !== "closed") throw new Error("closed pull request entry is invalid");
      if (record.merged_at !== undefined && record.merged_at !== null) continue;
      const number = record.number;
      const url = record.html_url;
      if (!Number.isSafeInteger(number) || (number as number) < 1)
        throw new Error("closed pull request entry is invalid");
      if (typeof url !== "string" || !exactPrUrl(url, input.repository))
        throw new Error("closed pull request entry is invalid");
      if (unmerged.length < 20) unmerged.push({ number: number as number, url });
    }
    receipts.push(external("prior_closed", closedCommand, "success", `count=${unmerged.length}`));
    return { closed: unmerged, screened: true, total: unmerged.length };
  } catch {
    receipts.push(external("prior_closed", closedCommand, "uncertain", digest(closedResult.stdout)));
    return { closed: [], screened: false, total: 0 };
  }
}

function parseLsRemoteHead(result: CreatePrCommandResult, headBranch: string): string | null {
  if (!commandSucceeded(result)) return null;
  const trimmed = result.stdout.trim();
  if (trimmed === "") return "";
  const lines = trimmed.split("\n");
  if (lines.length !== 1) return null;
  const match = lines[0]!.match(/^([a-f0-9]{40}|[a-f0-9]{64})\trefs\/heads\/(.+)$/);
  if (!match || match[2] !== headBranch || !shaPattern.test(match[1]!)) return null;
  return match[1]!;
}

async function proveActorAndBase(
  input: CreatePrInput,
  ghExecutable: string,
  root: string,
  runner: CreatePrRunner,
  receipts: ExternalReceipt[],
): Promise<void> {
  const actorCommand = [ghExecutable, "api", "user", "--jq", ".login"];
  const actorResult = await runRemoteWithReceipt(
    runner,
    { command: actorCommand, cwd: root },
    "actor",
    receipts,
  );
  if (!commandSucceeded(actorResult) || actorResult.stdout.trim() !== input.actor) {
    receipts.push(external("actor", actorCommand, "failed", digest(actorResult.stdout)));
    throw new Error("authenticated GitHub actor differs from declared actor");
  }
  receipts.push(external("actor", actorCommand, "success", input.actor));
  const baseCommand = [
    ghExecutable,
    "api",
    `repos/${input.repository}/git/ref/heads/${encodeURIComponent(input.base_branch)}`,
    "--jq",
    "{ref:.ref,sha:.object.sha,type:.object.type}",
  ];
  const baseResult = await runRemoteWithReceipt(
    runner,
    { command: baseCommand, cwd: root },
    "base_ref",
    receipts,
  );
  let base: Record<string, unknown> | null = null;
  try {
    base = object(JSON.parse(baseResult.stdout) as unknown, "base ref receipt");
    exactKeys(base, ["ref", "sha", "type"], "base ref receipt");
  } catch {
    base = null;
  }
  if (
    !commandSucceeded(baseResult) ||
    !base ||
    base.ref !== `refs/heads/${input.base_branch}` ||
    base.sha !== input.base_sha ||
    base.type !== "commit"
  ) {
    receipts.push(external("base_ref", baseCommand, "failed", digest(baseResult.stdout)));
    throw new Error("target repository base ref differs from declared base SHA");
  }
  receipts.push(external("base_ref", baseCommand, "success", input.base_sha));
}

export async function createPullRequest(
  raw: unknown,
  runtime: CreatePrRuntime = {},
): Promise<CreatePrReceipt> {
  let input: CreatePrInput;
  try {
    input = parseInput(raw);
  } catch (error) {
    return baseReceipt("invalid_input", error instanceof Error ? error.message : "invalid input");
  }
  const gates: GateReceipt[] = [];
  const externalActions: ExternalReceipt[] = [];
  let executedUnits = 0;
  let pushed = false;
  let pushAttempted = false;
  let created = false;
  let url = "";
  let priorClosed: PriorClosedPr[] = [];
  let historyNote = "";
  let gateParent = "";
  let pushParent = "";
  let receipt: CreatePrReceipt | undefined;
  const remember = (value: CreatePrReceipt): CreatePrReceipt => {
    receipt = value;
    return value;
  };
  try {
    const root = path.resolve(input.repo_root);
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || (await realpath(root)) !== root)
      throw new Error("repo_root is unsafe");
    const bodyPath = path.resolve(input.body_file);
    if (bodyPath === root || bodyPath.startsWith(`${root}${path.sep}`))
      throw new Error("body_file must stay outside the repository tree");
    const bodyBytes = await safeRegularFile(bodyPath, maximumBodyBytes, "body_file");
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes);
    if (digest(bodyBytes) !== input.body_sha256) throw new Error("body_file hash drifted");
    if (!body.trim() || /<!--|<placeholder>|{{[^}\n]+}}|\b(?:TODO|TBD)\b/i.test(body))
      throw new Error("body_file contains an empty or unfilled template");
    const gitExecutable = runtime.gitExecutable ?? (await resolveExecutable("git", root));
    await safeExecutable(gitExecutable);
    const ghExecutable = runtime.ghExecutable ?? (await resolveExecutable("gh", root));
    await safeExecutable(ghExecutable);
    const localRunner = runtime.localRunner ?? defaultLocalRunner;
    const remoteRunner = runtime.remoteRunner ?? defaultRemoteRunner;
    let gateWorkspace = "";
    const runGates = async (): Promise<CreatePrReceipt | null> => {
      if (!gateWorkspace) {
        gateWorkspace = await prepareGateWorkspace(input, gitExecutable, localRunner);
        gateParent = path.dirname(gateWorkspace);
      }
      const gateRunner = runtime.gateRunner ?? isolatedGateRunner(gateWorkspace);
      for (const gate of input.gates) {
        await safeExecutable(gate.command[0]!);
        await safeExecutable(gate.proof_command[0]!);
        const result = await gateRunner({ command: gate.command, cwd: gateWorkspace });
        if (!commandSucceeded(result)) {
          gates.push({
            id: gate.id,
            command: gate.command,
            proof_command: gate.proof_command,
            outcome: "failed",
            units: 0,
            output_sha256: digest(result.stdout),
          });
          return {
            ...baseReceipt("gate_failed", `gate failed: ${gate.id}`),
            repository: input.repository,
            branch: input.head_branch,
            head: input.head_sha,
            prior_closed: priorClosed,
            gates,
          };
        }
        const proof = await gateRunner({ command: gate.proof_command, cwd: gateWorkspace });
        const units = commandSucceeded(proof) ? parseProof(proof.stdout) : 0;
        gates.push({
          id: gate.id,
          command: gate.command,
          proof_command: gate.proof_command,
          outcome: units > 0 ? "passed" : "vacuous",
          units,
          output_sha256: digest(result.stdout),
        });
        if (units === 0)
          return {
            ...baseReceipt("gate_vacuous", `gate proof is zero or malformed: ${gate.id}`),
            repository: input.repository,
            branch: input.head_branch,
            head: input.head_sha,
            prior_closed: priorClosed,
            gates,
          };
        executedUnits += units;
      }
      return null;
    };
    const canFastForward = async (oldHead: string): Promise<boolean> => {
      const result = await localRunner({
        command: [gitExecutable, "merge-base", "--is-ancestor", oldHead, input.head_sha],
        cwd: input.repo_root,
      });
      return commandSucceeded(result);
    };
    const decisionReceipt = (
      detail: string,
      matches: readonly OpenPullRequest[],
    ): CreatePrReceipt => ({
      schema: createPrReceiptSchema,
      outcome: "decision_required",
      code: "decision_required",
      repository: input.repository,
      branch: input.head_branch,
      head: input.head_sha,
      url: "",
      executed_units: executedUnits,
      gates,
      external_actions: externalActions,
      matches: matches.map((match) => ({
        number: match.number,
        url: match.url,
        base: match.base_ref,
        head: match.head_sha,
      })),
      prior_closed: priorClosed,
      detail: `${detail}${historyNote}`,
    });
    const renderExisting = async (match: OpenPullRequest): Promise<CreatePrReceipt> => {
      const render = [
        ghExecutable,
        "pr",
        "view",
        match.url,
        "--repo",
        input.repository,
        "--json",
        "body,headRefName,headRefOid,baseRefName,baseRefOid,url,title,isDraft,author,state",
      ];
      const renderResult = await runRemoteWithReceipt(
        remoteRunner,
        { command: render, cwd: root },
        "render",
        externalActions,
      );
      let rendered: Record<string, unknown> | null = null;
      try {
        rendered = object(JSON.parse(renderResult.stdout) as unknown, "render receipt");
        exactKeys(
          rendered,
          [
            "body",
            "headRefName",
            "headRefOid",
            "baseRefName",
            "baseRefOid",
            "url",
            "title",
            "isDraft",
            "author",
            "state",
          ],
          "render receipt",
        );
      } catch {
        rendered = null;
      }
      const author =
        rendered?.author && typeof rendered.author === "object" && !Array.isArray(rendered.author)
          ? (rendered.author as Record<string, unknown>).login
          : undefined;
      const observedBase = rendered?.baseRefOid;
      if (
        !commandSucceeded(renderResult) ||
        !rendered ||
        rendered.headRefName !== input.head_branch ||
        rendered.headRefOid !== input.head_sha ||
        rendered.baseRefName !== input.base_branch ||
        typeof observedBase !== "string" ||
        !shaPattern.test(observedBase) ||
        rendered.url !== match.url ||
        rendered.state !== "OPEN" ||
        author !== input.actor
      ) {
        externalActions.push(external("render", render, "uncertain", digest(renderResult.stdout)));
        return {
          ...baseReceipt("render_failed", "reused PR render or identity is unproven"),
          outcome: "recovery_required",
          repository: input.repository,
          branch: input.head_branch,
          head: input.head_sha,
          url: match.url,
          pr_number: match.number,
          prior_closed: priorClosed,
          executed_units: executedUnits,
          gates,
          external_actions: externalActions,
        };
      }
      externalActions.push(external("render", render, "success", input.head_sha));
      return {
        schema: createPrReceiptSchema,
        outcome: "reused",
        code: "reused",
        repository: input.repository,
        branch: input.head_branch,
        head: input.head_sha,
        url: match.url,
        pr_number: match.number,
        observed_base: observedBase,
        prior_closed: priorClosed,
        executed_units: executedUnits,
        gates,
        external_actions: externalActions,
        detail: `reused PR #${match.number} at the expected head${historyNote}`,
      };
    };
    const suitabilityReasons = async (match: OpenPullRequest): Promise<string[]> => {
      const reasons: string[] = [];
      const headRepo = `${input.head_owner}/${input.repository.split("/")[1]!}`;
      if (match.base_ref !== input.base_branch)
        reasons.push(`base is ${match.base_ref} but the request binds ${input.base_branch}`);
      if (match.head_repo !== headRepo)
        reasons.push(`head repo is ${match.head_repo} but the request binds ${headRepo}`);
      if (match.head_ref !== input.head_branch)
        reasons.push(`head ref is ${match.head_ref} but the request binds ${input.head_branch}`);
      if (match.author !== input.actor)
        reasons.push(`author is ${match.author} but the request binds ${input.actor}`);
      if (match.head_sha !== input.head_sha) {
        if (!input.allow_reuse)
          reasons.push(
            `head is ${match.head_sha} but the request binds ${input.head_sha}, and reuse is forbidden`,
          );
        else if (input.expected_remote_head === undefined)
          reasons.push(
            `head is ${match.head_sha} but the request binds ${input.head_sha}, and no expected remote head was declared`,
          );
        else if (match.head_sha !== input.expected_remote_head)
          reasons.push(
            `head is ${match.head_sha} but the request expects ${input.head_sha} from ${input.expected_remote_head}`,
          );
        else if (!(await canFastForward(match.head_sha)))
          reasons.push(
            `head ${match.head_sha} is not an ancestor of ${input.head_sha}; no fast-forward exists`,
          );
      } else if (!input.allow_reuse) {
        reasons.push(`PR #${match.number} already covers the candidate but reuse is forbidden`);
      }
      return reasons;
    };
    await repositorySnapshot(input, gitExecutable, localRunner);
    await proveActorAndBase(input, ghExecutable, root, remoteRunner, externalActions);
    const openMatches = await queryOpenPullRequests(input, ghExecutable, root, remoteRunner, externalActions);
    const prior = await queryClosedPullRequests(input, ghExecutable, root, remoteRunner, externalActions);
    priorClosed = prior.closed;
    historyNote = prior.screened ? "" : "; closed-PR history is unscreened";
    let reuseMatch: OpenPullRequest | null = null;
    if (openMatches.length >= 2)
      return remember(
        decisionReceipt(
          `${openMatches.length} open PRs match ${input.head_owner}:${input.head_branch}; refusing to pick one`,
          openMatches,
        ),
      );
    if (openMatches.length === 1) {
      const match = openMatches[0]!;
      const reasons = await suitabilityReasons(match);
      if (reasons.length > 0) return remember(decisionReceipt(reasons.join("; "), openMatches));
      if (match.head_sha === input.head_sha) return remember(await renderExisting(match));
      reuseMatch = match;
    }
    const gateFailure = await runGates();
    if (gateFailure) return remember(gateFailure);
    await repositorySnapshot(input, gitExecutable, localRunner);

    // Remote Git must use a repository created by this entrypoint. The source
    // checkout and gate workspace are untrusted; using either here would let
    // local config, URL rewrites, or hooks run with the trusted auth env.
    const pushWorkspace = await preparePushWorkspace(input, gitExecutable, localRunner);
    pushParent = path.dirname(pushWorkspace);
    const gitTransportOptions = [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "credential.helper=",
      "-c",
      "credential.helper=!gh auth git-credential",
    ] as const;
    const remoteRef = [
      gitExecutable,
      ...gitTransportOptions,
      "ls-remote",
      "--heads",
      input.remote_url,
      `refs/heads/${input.head_branch}`,
    ];
    const remoteRefBeforePush = await runRemoteWithReceipt(
      remoteRunner,
      { command: remoteRef, cwd: pushWorkspace },
      "remote_ref",
      externalActions,
    );
    const remoteHead = parseLsRemoteHead(remoteRefBeforePush, input.head_branch);
    let leaseOld: string | null = null;
    if (remoteHead === null) {
      externalActions.push(
        external(
          "remote_ref",
          remoteRef,
          commandSucceeded(remoteRefBeforePush) ? "failed" : "uncertain",
          digest(remoteRefBeforePush.stdout),
        ),
      );
      return remember({
        ...baseReceipt("remote_ref_failed", `remote branch state is unproven${historyNote}`),
        repository: input.repository,
        branch: input.head_branch,
        head: input.head_sha,
        prior_closed: priorClosed,
        executed_units: executedUnits,
        gates,
        external_actions: externalActions,
      });
    } else if (remoteHead === "") {
      externalActions.push(external("remote_ref", remoteRef, "success", "absent"));
      leaseOld = "";
    } else if (remoteHead === input.head_sha) {
      externalActions.push(external("remote_ref", remoteRef, "success", "at-head"));
    } else if (
      input.allow_reuse &&
      input.expected_remote_head !== undefined &&
      remoteHead === input.expected_remote_head &&
      (await canFastForward(remoteHead))
    ) {
      externalActions.push(external("remote_ref", remoteRef, "success", remoteHead));
      leaseOld = remoteHead;
    } else {
      externalActions.push(external("remote_ref", remoteRef, "failed", remoteHead));
      return remember({
        ...baseReceipt(
          "remote_ref_failed",
          `remote branch is at ${remoteHead} but the request binds ${input.head_sha}; stopping without force-push${historyNote}`,
        ),
        repository: input.repository,
        branch: input.head_branch,
        head: input.head_sha,
        prior_closed: priorClosed,
        executed_units: executedUnits,
        gates,
        external_actions: externalActions,
      });
    }

    const expectedRef = `${input.head_sha}\trefs/heads/${input.head_branch}`;
    if (leaseOld !== null) {
      const push = [
        gitExecutable,
        ...gitTransportOptions,
        "push",
        "--no-verify",
        `--force-with-lease=refs/heads/${input.head_branch}:${leaseOld}`,
        input.remote_url,
        `${input.head_sha}:refs/heads/${input.head_branch}`,
      ];
      pushAttempted = true;
      const pushResult = await runRemoteWithReceipt(
        remoteRunner,
        { command: push, cwd: pushWorkspace },
        "push",
        externalActions,
      );
      externalActions.push(
        external(
          "push",
          push,
          commandSucceeded(pushResult) ? "success" : "uncertain",
          digest(pushResult.stdout),
        ),
      );
      const remoteRefResult = await runRemoteWithReceipt(
        remoteRunner,
        { command: remoteRef, cwd: pushWorkspace },
        "remote_ref",
        externalActions,
      );
      const pushSucceeded = commandSucceeded(pushResult);
      if (!pushSucceeded) {
        const remoteRefMatches =
          commandSucceeded(remoteRefResult) && remoteRefResult.stdout.trim() === expectedRef;
        const absent = commandSucceeded(remoteRefResult) && remoteRefResult.stdout.trim() === "";
        externalActions.push(
          external(
            "remote_ref",
            remoteRef,
            remoteRefMatches || absent ? "success" : "uncertain",
            remoteRefMatches ? input.head_sha : absent ? "absent" : digest(remoteRefResult.stdout),
          ),
        );
        return remember({
          ...baseReceipt(
            "push_failed",
            remoteRefMatches
              ? `push failed but the expected remote branch was observed; refusing to continue${historyNote}`
              : absent
                ? `push failed and exact remote discovery proved the branch absent${historyNote}`
                : `push failed and pushed branch identity is unproven${historyNote}`,
          ),
          outcome: "recovery_required",
          repository: input.repository,
          branch: input.head_branch,
          head: input.head_sha,
          prior_closed: priorClosed,
          executed_units: executedUnits,
          gates,
          external_actions: externalActions,
        });
      }
      if (!commandSucceeded(remoteRefResult) || remoteRefResult.stdout.trim() !== expectedRef) {
        const absent = commandSucceeded(remoteRefResult) && remoteRefResult.stdout.trim() === "";
        externalActions.push(
          external(
            "remote_ref",
            remoteRef,
            absent ? "success" : "uncertain",
            absent ? "absent" : digest(remoteRefResult.stdout),
          ),
        );
        return remember({
          ...baseReceipt(
            commandSucceeded(pushResult) ? "remote_ref_failed" : "push_failed",
            absent && !commandSucceeded(pushResult)
              ? `push failed and exact remote discovery proved the branch absent${historyNote}`
              : `pushed branch identity is foreign or unproven${historyNote}`,
          ),
          outcome: absent && !commandSucceeded(pushResult) ? "refused" : "recovery_required",
          repository: input.repository,
          branch: input.head_branch,
          head: input.head_sha,
          prior_closed: priorClosed,
          executed_units: executedUnits,
          gates,
          external_actions: externalActions,
        });
      }
      pushed = true;
      externalActions.push(external("remote_ref", remoteRef, "success", input.head_sha));
    }
    if (reuseMatch) return remember(await renderExisting(reuseMatch));
    await proveActorAndBase(input, ghExecutable, root, remoteRunner, externalActions);
    const reopened = await queryOpenPullRequests(
      input,
      ghExecutable,
      root,
      remoteRunner,
      externalActions,
    );
    if (reopened.length !== 0)
      return remember(
        decisionReceipt(
          `a matching open PR appeared after the push; the branch holds ${input.head_sha} and the operator decides`,
          reopened,
        ),
      );
    const finalRemoteRefResult = await runRemoteWithReceipt(
      remoteRunner,
      { command: remoteRef, cwd: pushWorkspace },
      "remote_ref",
      externalActions,
    );
    if (!commandSucceeded(finalRemoteRefResult) || finalRemoteRefResult.stdout.trim() !== expectedRef) {
      externalActions.push(
        external("remote_ref", remoteRef, "uncertain", digest(finalRemoteRefResult.stdout)),
      );
      return remember({
        ...baseReceipt(
          "remote_ref_failed",
          `remote head changed immediately before PR creation${historyNote}`,
        ),
        outcome: "recovery_required",
        repository: input.repository,
        branch: input.head_branch,
        head: input.head_sha,
        prior_closed: priorClosed,
        executed_units: executedUnits,
        gates,
        external_actions: externalActions,
      });
    }
    externalActions.push(external("remote_ref", remoteRef, "success", input.head_sha));
    const create = [
      ghExecutable,
      "pr",
      "create",
      "--repo",
      input.repository,
      "--base",
      input.base_branch,
      "--head",
      `${input.head_owner}:${input.head_branch}`,
      "--title",
      input.title,
      "--body-file",
      "-",
      ...(input.draft ? ["--draft"] : []),
    ];
    const createResult = await runRemoteWithReceipt(
      remoteRunner,
      { command: create, cwd: root, stdin: bodyBytes },
      "create",
      externalActions,
    );
    url = createResult.stdout.trim();
    if (!commandSucceeded(createResult) || !exactPrUrl(url, input.repository)) {
      externalActions.push(external("create", create, createResult.timedOut ? "uncertain" : "failed", ""));
      return remember({
        ...baseReceipt(
          "create_failed",
          `PR creation failed or returned an untrusted URL${historyNote}`,
        ),
        outcome: "recovery_required",
        repository: input.repository,
        branch: input.head_branch,
        head: input.head_sha,
        prior_closed: priorClosed,
        executed_units: executedUnits,
        gates,
        external_actions: externalActions,
      });
    }
    created = true;
    externalActions.push(external("create", create, "success", url));
    const render = [
      ghExecutable,
      "pr",
      "view",
      url,
      "--repo",
      input.repository,
      "--json",
      "body,headRefName,headRefOid,baseRefName,baseRefOid,url,title,isDraft,author,state",
    ];
    const renderResult = await runRemoteWithReceipt(
      remoteRunner,
      { command: render, cwd: root },
      "render",
      externalActions,
    );
    let rendered: Record<string, unknown> | null = null;
    try {
      rendered = object(JSON.parse(renderResult.stdout) as unknown, "render receipt");
      exactKeys(
        rendered,
        [
          "body",
          "headRefName",
          "headRefOid",
          "baseRefName",
          "baseRefOid",
          "url",
          "title",
          "isDraft",
          "author",
          "state",
        ],
        "render receipt",
      );
    } catch {
      rendered = null;
    }
    if (
      !commandSucceeded(renderResult) ||
      !rendered ||
      rendered.body !== body ||
      rendered.headRefName !== input.head_branch ||
      rendered.headRefOid !== input.head_sha ||
      rendered.baseRefName !== input.base_branch ||
      rendered.baseRefOid !== input.base_sha ||
      rendered.url !== url ||
      rendered.title !== input.title ||
      rendered.isDraft !== input.draft ||
      rendered.state !== "OPEN" ||
      !rendered.author ||
      typeof rendered.author !== "object" ||
      Array.isArray(rendered.author) ||
      (rendered.author as Record<string, unknown>).login !== input.actor
    ) {
      externalActions.push(external("render", render, "uncertain", digest(renderResult.stdout)));
      return remember({
        ...baseReceipt(
          "render_failed",
          `created PR render or identity is unproven${historyNote}`,
        ),
        outcome: "recovery_required",
        repository: input.repository,
        branch: input.head_branch,
        head: input.head_sha,
        url,
        prior_closed: priorClosed,
        executed_units: executedUnits,
        gates,
        external_actions: externalActions,
      });
    }
    externalActions.push(external("render", render, "success", digest(body)));
    return remember({
      schema: createPrReceiptSchema,
      outcome: "success",
      code: "opened",
      repository: input.repository,
      branch: input.head_branch,
      head: input.head_sha,
      url,
      prior_closed: priorClosed,
      executed_units: executedUnits,
      gates,
      external_actions: externalActions,
      detail: `non-vacuous gates, exact push, PR creation, and render proved${historyNote}`,
    });
  } catch (error) {
    return remember({
      ...baseReceipt("state_drift", error instanceof Error ? error.message : "pre-open state drifted"),
      outcome: pushed || pushAttempted || created ? "recovery_required" : "refused",
      repository: input.repository,
      branch: input.head_branch,
      head: input.head_sha,
      url,
      prior_closed: priorClosed,
      executed_units: executedUnits,
      gates,
      external_actions: externalActions,
    });
  } finally {
    const cleanupErrors: unknown[] = [];
    for (const parent of [pushParent, gateParent]) {
      if (!parent) continue;
      try {
        await rm(parent, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length !== 0 && receipt) {
      const mutationOccurred = pushed || pushAttempted || created;
      const wasSuccessful = receipt.outcome === "success";
      Object.assign(receipt, {
        outcome: mutationOccurred ? "recovery_required" : receipt.outcome,
        code: mutationOccurred && wasSuccessful ? "state_drift" : receipt.code,
        detail: `${receipt.detail}; temporary workspace cleanup failed`,
      });
    }
  }
}

function exactPrUrl(value: string, repository: string): boolean {
  const escaped = repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^https://github\\.com/${escaped}/pull/[1-9]\\d*$`).test(value);
}

async function verifyEntrypoint(entrypoint: string, skillFile: string): Promise<void> {
  if (!path.isAbsolute(entrypoint) || !path.isAbsolute(skillFile))
    throw new Error("entrypoint and skill file must be absolute");
  const resolved = path.resolve(entrypoint);
  const plugin = path.dirname(path.dirname(resolved));
  const expectedSkill = path.join(plugin, "skills", "tailrocks-create-pr", "SKILL.md");
  if (path.resolve(skillFile) !== expectedSkill)
    throw new Error("loader skill does not own create-pr entrypoint");
  for (const [candidate, kind] of [
    [resolved, "file"],
    [expectedSkill, "file"],
    [path.join(path.dirname(resolved), "resolve-executable.ts"), "file"],
    [path.dirname(resolved), "directory"],
    [plugin, "directory"],
  ] as const) {
    const info = await lstat(candidate);
    if (
      info.isSymbolicLink() ||
      (kind === "file" ? !info.isFile() : !info.isDirectory()) ||
      (await realpath(candidate)) !== candidate
    )
      throw new Error("installed create-pr package is unsafe");
  }
}

async function readBoundedStdin(): Promise<string> {
  const reader = Bun.stdin.stream().getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const timer = setTimeout(() => reader.cancel("stdin deadline exceeded"), 5_000);
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > maximumInputBytes) throw new Error("stdin is too large");
      chunks.push(result.value);
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  if (bytes === 0) throw new Error("stdin is empty");
  return Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    bytes,
  ).toString("utf8");
}

if (import.meta.main) {
  let receipt: CreatePrReceipt;
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== "--skill-file")
      throw new Error("usage: create-pr --skill-file <loader-provided-absolute-SKILL.md>");
    await verifyEntrypoint(process.argv[1]!, args[1]!);
    receipt = await createPullRequest(JSON.parse(await readBoundedStdin()));
  } catch (error) {
    receipt = baseReceipt("invalid_input", error instanceof Error ? error.message : "CLI refused");
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  process.exit(
    receipt.outcome === "success" || receipt.outcome === "reused"
      ? 0
      : receipt.outcome === "recovery_required"
        ? 3
        : 2,
  );
}
