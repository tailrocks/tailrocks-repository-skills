// A fake GitHub for pr-fleet tests with many open PRs. It sits behind the
// MergeIo boundary: the real gather, evaluate, policy, plan, and apply code run
// on top of it. The world is mutable, so a write changes what the next read sees.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RefreshPort, RefreshResult } from "../../lib/fleet/types.ts";
import type { MergeIo } from "../../lib/merge/types.ts";
import type { RunResult } from "../../lib/proc.ts";
import { checkGh, ghMutationArgv, type GhMutation } from "../../lib/safety-gh.ts";
import { baseResponse, commitNode, ctxRun, fakeGh, prResponse, thread } from "./fake-gh.ts";
import { sha } from "./status.ts";

export const REPO = "example-org/example-repo";
const OTHER_BASE_SHA = sha("d");

export type Preset =
  | "ready"
  | "queued-mergeable"
  | "queued-unmergeable"
  | "behind-approved"
  | "unresolved-thread"
  | "needs-review"
  | "conflict"
  | "conflict-thread"
  | "refreshing"
  | "ci-running"
  | "draft";

const QUEUE_STATES = ["QUEUED", "AWAITING_CHECKS", "MERGEABLE", "UNMERGEABLE", "LOCKED"] as const;

export interface WorldPr {
  number: number;
  headRef: string;
  author: string;
  preset: Preset;
  /** One character that makes the head commit id. */
  headChar: string;
  baseRef: string;
  queue: { position: number; state: (typeof QUEUE_STATES)[number] } | null;
  isCrossRepository: boolean;
  /** The PR cannot be read: its query fails. */
  unreadable: boolean;
}

export interface FleetWorld {
  readonly io: MergeIo;
  readonly prs: Map<number, WorldPr>;
  defaultBranch: string;
  /** The tip of the default branch. A test moves it to make GitHub serve a new policy commit. */
  defaultSha: ReturnType<typeof sha>;
  /** False: the base branch has no merge queue (direct merges). */
  hasQueue: boolean;
  /** True: every PR is behind the base, as after a direct merge. */
  baseMoved: boolean;
  /** The fake clock in milliseconds. */
  clock: number;
  /** Runs after each mutation and each direct merge. */
  afterWrite: ((world: FleetWorld) => void) | null;
  queueLength: number | null;
  requiredApprovals: number;
  strictUpToDate: boolean;
  policyToml: string | null;
  files: readonly string[];
  runs: readonly Record<string, unknown>[] | "fail";
  /** Runs by status. A status that is not a key lists no run. When set, it replaces `runs`. */
  runsByStatus: Readonly<Record<string, readonly Record<string, unknown>[]>> | null;
  /** GraphQL points that the fake shows as left. */
  graphqlRemaining: number;
  /** Runs before each read of a PR. Return after changing the world. */
  script: ((gather: number, world: FleetWorld) => void) | null;
  gathers: number;
  readonly calls: string[][];
  readonly mutations: GhMutation[];
  readonly merges: string[][];
  readonly comments: string[];
  readonly lockDir: string;
  alivePids: Set<number>;
  /** Make the next GraphQL list read fail. */
  listFails: boolean;
  setPreset(number: number, preset: Preset): void;
  addPr(number: number, patch: Partial<WorldPr> & { headRef: string }): WorldPr;
}

const dirs: string[] = [];

export function removeFleetWorlds(): void {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface Fixture {
  readonly defaultBranch: string;
  readonly queueLength: number;
  readonly requiredApprovals: number;
  readonly strictUpToDate: boolean;
  readonly prs: readonly { number: number; headRef: string; author: string; preset: Preset; queue: WorldPr["queue"] }[];
  readonly runs: readonly Record<string, unknown>[];
}

const PRESETS: readonly Preset[] = ["ready", "queued-mergeable", "queued-unmergeable", "behind-approved", "unresolved-thread", "needs-review", "conflict", "conflict-thread", "refreshing", "ci-running", "draft"];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readFixture(name: string): Fixture {
  const data: unknown = JSON.parse(readFileSync(join(import.meta.dir, "..", "fixtures", "fleet", name), "utf8"));
  if (!isObject(data) || typeof data["defaultBranch"] !== "string" || typeof data["queueLength"] !== "number") {
    throw new Error(`bad fixture ${name}`);
  }
  const { defaultBranch, queueLength } = data;
  const requiredApprovals = data["requiredApprovals"];
  const strictUpToDate = data["strictUpToDate"];
  const prs = data["prs"];
  const runs = data["runs"];
  if (typeof requiredApprovals !== "number" || typeof strictUpToDate !== "boolean" || !Array.isArray(prs) || !Array.isArray(runs)) {
    throw new Error(`bad fixture ${name}`);
  }
  return {
    defaultBranch,
    queueLength,
    requiredApprovals,
    strictUpToDate,
    prs: prs.map((entry): Fixture["prs"][number] => {
      const preset = isObject(entry) ? PRESETS.find((p) => p === entry["preset"]) : undefined;
      if (!isObject(entry) || typeof entry["number"] !== "number" || typeof entry["headRef"] !== "string" || typeof entry["author"] !== "string" || preset === undefined) {
        throw new Error(`bad PR in fixture ${name}`);
      }
      const queue = entry["queue"];
      const state = isObject(queue) ? QUEUE_STATES.find((q) => q === queue["state"]) : undefined;
      return {
        number: entry["number"],
        headRef: entry["headRef"],
        author: entry["author"],
        preset,
        queue: isObject(queue) && typeof queue["position"] === "number" && state !== undefined ? { position: queue["position"], state } : null,
      };
    }),
    runs: runs.filter(isObject),
  };
}

export function headOf(pr: WorldPr) {
  return sha(pr.headChar);
}

const CHARS = "0123456789abde";

function ok(data: unknown = {}): RunResult {
  return { code: 0, stdout: JSON.stringify({ data }), stderr: "" };
}

function baseShaOf(world: FleetWorld, pr: WorldPr) {
  return pr.baseRef === world.defaultBranch ? world.defaultSha : OTHER_BASE_SHA;
}

function hasThread(pr: WorldPr): boolean {
  return pr.preset === "unresolved-thread" || pr.preset === "conflict-thread";
}

function conflicting(pr: WorldPr): boolean {
  return pr.preset === "conflict" || pr.preset === "conflict-thread";
}

function prNode(world: FleetWorld, pr: WorldPr): Record<string, unknown> {
  const head = headOf(pr);
  const approved = pr.preset !== "needs-review";
  const running = pr.preset === "refreshing" || pr.preset === "ci-running";
  const check = ctxRun("Required", running ? { isRequired: true, status: "IN_PROGRESS", conclusion: null, completedAt: null } : { isRequired: true });
  const message =
    pr.preset === "refreshing"
      ? "Merge remote-tracking branch 'origin/main' into topic\n\nSigned-off-by: A <a@example.com>"
      : "msg\n\nSigned-off-by: A <a@example.com>";
  return {
    id: `PR_node_${pr.number}`,
    number: pr.number,
    isDraft: pr.preset === "draft",
    baseRefName: pr.baseRef,
    baseRefOid: baseShaOf(world, pr),
    headRefName: pr.headRef,
    headRefOid: head,
    isCrossRepository: pr.isCrossRepository,
    headRepository: { nameWithOwner: pr.isCrossRepository ? "other-user/example-repo" : REPO },
    author: { login: pr.author },
    mergeable: conflicting(pr) ? "CONFLICTING" : "MERGEABLE",
    mergeStateStatus: conflicting(pr) ? "DIRTY" : pr.preset === "behind-approved" ? "BEHIND" : "CLEAN",
    reviewDecision: approved ? "APPROVED" : "REVIEW_REQUIRED",
    labels: { totalCount: 0, nodes: [] },
    mergeQueueEntry:
      pr.queue === null ? null : { id: `MQE_${pr.number}`, position: pr.queue.position, state: pr.queue.state, enqueuedAt: "2026-01-02T00:00:00Z", jump: false },
    commits: { totalCount: 1, pageInfo: { hasPreviousPage: false, startCursor: null }, nodes: [commitNode(head, pr.preset === "refreshing" ? [sha("b"), sha("c")] : [sha("b")], message)] },
    latestCommit: {
      nodes: [
        {
          commit: {
            id: `C_node_${pr.number}`,
            oid: head,
            statusCheckRollup: { contexts: { totalCount: 1, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [check] } },
          },
        },
      ],
    },
    latestOpinionatedReviews: {
      totalCount: approved ? 1 : 0,
      nodes: approved ? [{ author: { login: "user-r" }, authorAssociation: "MEMBER", state: "APPROVED", commit: { oid: head } }] : [],
    },
    reviewThreads: {
      totalCount: hasThread(pr) ? 1 : 0,
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: hasThread(pr) ? [thread(pr.number)] : [],
    },
    timelineItems: { nodes: [] },
  };
}

const POLICY_LINE = /^schema\s*=/m;

export function makeFleetWorld(fixtureName = "mixed-queue.json"): FleetWorld {
  const fixture = readFixture(fixtureName);
  const calls: string[][] = [];
  const mutations: GhMutation[] = [];
  const merges: string[][] = [];
  const comments: string[] = [];
  const lockDir = mkdtempSync(join(tmpdir(), "pr-fleet-test-"));
  dirs.push(lockDir);
  const prs = new Map<number, WorldPr>();
  let next = 0;
  const addPr = (number: number, patch: Partial<WorldPr> & { headRef: string }): WorldPr => {
    const pr: WorldPr = {
      number,
      author: "user-a",
      preset: "ready",
      headChar: CHARS.charAt(next % CHARS.length),
      baseRef: fixture.defaultBranch,
      queue: null,
      isCrossRepository: false,
      unreadable: false,
      ...patch,
    };
    next += 1;
    prs.set(number, pr);
    return pr;
  };
  for (const entry of fixture.prs) {
    addPr(entry.number, { headRef: entry.headRef, author: entry.author, preset: entry.preset, queue: entry.queue });
  }

  const graphql = fakeGh({
    fleetOpen: () => {
      if (world.listFails) {
        return { errors: [{ message: "list failed" }] };
      }
      return {
        data: {
          repository: {
            defaultBranchRef: { name: world.defaultBranch, target: { oid: world.defaultSha } },
            pullRequests: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [...prs.values()].map((pr) => ({
                number: pr.number,
                isDraft: pr.preset === "draft",
                headRefName: pr.headRef,
                headRefOid: headOf(pr),
                baseRefName: pr.baseRef,
                baseRefOid: baseShaOf(world, pr),
                isCrossRepository: pr.isCrossRepository,
                author: { login: pr.author },
              })),
            },
          },
        },
      };
    },
    pr: (vars) => {
      world.gathers += 1;
      world.script?.(world.gathers, world);
      const pr = prs.get(Number(vars["number"]));
      if (pr === undefined || pr.unreadable) {
        return { errors: [{ message: "read failed" }] };
      }
      return prResponse(prNode(world, pr));
    },
    base: (vars) => {
      const pr = [...prs.values()].find((p) => headOf(p) === vars["head"]);
      return baseResponse({
        mergeQueue: !world.hasQueue
          ? null
          : world.queueLength === null
            ? { id: "MQ_1", entries: { totalCount: null } }
            : { id: "MQ_1", entries: { totalCount: world.queueLength } },
        ref: { compare: { behindBy: pr?.preset === "behind-approved" || world.baseMoved ? 3 : 0, aheadBy: 1 } },
      });
    },
    issue: () => ({ data: { repository: { issueOrPullRequest: null } } }),
    mergeability: () => ({ data: {} }),
  });

  const notFound = (endpoint: string): RunResult => ({ code: 1, stdout: "", stderr: `gh: Not Found (HTTP 404) for ${endpoint}` });
  const reply = (value: unknown): RunResult => ({ code: 0, stdout: JSON.stringify(value), stderr: "" });

  const runGh = async (args: readonly string[]): Promise<RunResult> => {
    calls.push([...args]);
    const guard = checkGh(args);
    if (!guard.allowed) {
      throw new Error(`fake gh: the guard refused ${args.slice(0, 3).join(" ")}: ${guard.reason}`);
    }
    if (args[0] === "run" && args[1] === "list") {
      if (world.runsByStatus !== null) {
        return reply(world.runsByStatus[args[args.indexOf("--status") + 1] ?? ""] ?? []);
      }
      return world.runs === "fail" ? { code: 1, stdout: "", stderr: "gh: Server Error (HTTP 500)" } : reply(world.runs);
    }
    if (args[0] === "pr") {
      const number = Number(args[2]);
      switch (args[1]) {
        case "merge":
          merges.push([...args]);
          prs.delete(number);
          world.baseMoved = true;
          world.afterWrite?.(world);
          return { code: 0, stdout: "", stderr: "" };
        case "view": {
          const pr = prs.get(number);
          return reply({ state: pr === undefined ? "MERGED" : "OPEN", mergeCommit: pr === undefined ? { oid: sha("e") } : null, headRefOid: pr === undefined ? sha("e") : headOf(pr) });
        }
        case "comment":
          comments.push(readFileSync(args[args.indexOf("--body-file") + 1] ?? "", "utf8"));
          return { code: 0, stdout: "", stderr: "" };
        default:
          throw new Error(`fake gh: no handler for gh pr ${args[1] ?? ""}`);
      }
    }
    if (args[0] === "api" && args[1] !== "graphql") {
      const endpoint = args.find((a, i) => i > 0 && !a.startsWith("-") && args[i - 1] !== "-X" && args[i - 1] !== "-H") ?? "";
      if (endpoint === "rate_limit") {
        return reply({ resources: { graphql: { remaining: world.graphqlRemaining, limit: 5000, reset: 2_000_000_000 } } });
      }
      if (endpoint.startsWith(`repos/${REPO}/contents/.config/pr-policy.toml`)) {
        const text = world.policyToml;
        return text === null ? notFound(endpoint) : { code: 0, stdout: POLICY_LINE.test(text) ? text : `schema = 1\n${text}`, stderr: "" };
      }
      const files = /^repos\/example-org\/example-repo\/pulls\/(\d+)\/files/.exec(endpoint);
      if (files !== null) {
        return reply(world.files.map((filename) => ({ filename, status: "modified" })));
      }
      if (endpoint === `repos/${REPO}/rules/branches/${world.defaultBranch}`) {
        return reply([
          {
            type: "pull_request",
            parameters: {
              required_approving_review_count: world.requiredApprovals,
              require_code_owner_review: false,
              dismiss_stale_reviews_on_push: true,
              required_review_thread_resolution: true,
              allowed_merge_methods: ["squash"],
            },
          },
          {
            type: "required_status_checks",
            parameters: { strict_required_status_checks_policy: world.strictUpToDate, required_status_checks: [{ context: "Required" }] },
          },
          ...(world.hasQueue ? [{ type: "merge_queue", parameters: { merge_method: "SQUASH" } }] : []),
        ]);
      }
      if (endpoint === `repos/${REPO}/branches/${world.defaultBranch}`) {
        return reply({ protection: { enabled: false } });
      }
      return notFound(endpoint);
    }
    return graphql.run(args);
  };

  const mutate = async (op: GhMutation): Promise<RunResult> => {
    mutations.push(op);
    ghMutationArgv(op);
    try {
      return await applyMutation(op);
    } finally {
      world.afterWrite?.(world);
    }
  };

  const applyMutation = async (op: GhMutation): Promise<RunResult> => {
    const byNode = (id: string): WorldPr | undefined => [...prs.values()].find((p) => `PR_node_${p.number}` === id || `MQE_${p.number}` === id);
    if (op.kind === "dequeuePullRequest") {
      const pr = byNode(op.entryId);
      if (pr !== undefined) {
        pr.queue = null;
        world.queueLength = world.queueLength === null ? null : world.queueLength - 1;
      }
      return ok({ dequeuePullRequest: { mergeQueueEntry: { id: op.entryId } } });
    }
    if (op.kind === "enqueuePullRequest") {
      const pr = byNode(op.pullRequestId);
      if (pr !== undefined) {
        world.queueLength = world.queueLength === null ? null : world.queueLength + 1;
        pr.queue = { position: world.queueLength ?? 1, state: "QUEUED" };
      }
      return ok({ enqueuePullRequest: { mergeQueueEntry: { id: op.pullRequestId, position: 1, state: "QUEUED" } } });
    }
    throw new Error(`fake gh: unexpected mutation ${op.kind}`);
  };

  const io: MergeIo = {
    runGh,
    mutate,
    sleep: async () => undefined,
    now: () => world.clock,
    lockDir,
    pid: 4242,
    isAlive: (pid) => world.alivePids.has(pid),
    startOf: () => null,
    onStopSignal: () => () => undefined,
    exit: () => undefined,
  };

  const world: FleetWorld = {
    io,
    prs,
    defaultBranch: fixture.defaultBranch,
    defaultSha: sha("f"),
    hasQueue: true,
    baseMoved: false,
    clock: 1_000_000,
    afterWrite: null,
    queueLength: fixture.queueLength,
    requiredApprovals: fixture.requiredApprovals,
    strictUpToDate: fixture.strictUpToDate,
    policyToml: null,
    files: ["src/lib.rs"],
    runs: fixture.runs,
    runsByStatus: null,
    graphqlRemaining: 4000,
    script: null,
    gathers: 0,
    calls,
    mutations,
    merges,
    comments,
    lockDir,
    alivePids: new Set([4242]),
    listFails: false,
    setPreset(number, preset) {
      const pr = prs.get(number);
      if (pr === undefined) {
        throw new Error(`no PR ${number}`);
      }
      pr.preset = preset;
    },
    addPr,
  };
  return world;
}

/** Replace every PR with `count` READY PRs from one author. */
export function onlyReady(world: FleetWorld, count: number): void {
  world.prs.clear();
  for (let i = 0; i < count; i += 1) {
    world.addPr(100 + i, { headRef: `feat/ready-${i}` });
  }
}

/** A refresh port that records its calls. */
export function fakeRefresh(result: RefreshResult = { ok: true, note: "synced" }): RefreshPort & { readonly calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    sync: async (number) => {
      calls.push(number);
      return result;
    },
  };
}
