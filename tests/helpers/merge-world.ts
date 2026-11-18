// A fake GitHub for pr-merge tests. It sits behind the MergeIo boundary: the
// real gather, evaluate, policy, and step code run on top of it. The world is
// mutable, so a write (enqueue, dequeue, merge) changes what the next read sees.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StopSignal } from "../../lib/merge/signals.ts";
import type { MergeIo, StepContext } from "../../lib/merge/types.ts";
import { newShared } from "../../lib/merge/types.ts";
import type { RunResult } from "../../lib/proc.ts";
import { checkGh, ghMutationArgv, type GhMutation } from "../../lib/safety-gh.ts";
import { parseRepoSlug, type Sha } from "../../lib/types.ts";
import { baseResponse, commitNode, fakeGh, prResponse } from "./fake-gh.ts";
import { HEAD, OLD, sha } from "./status.ts";

const REPO = "example-org/example-repo";

export interface QueueEntryData {
  readonly id: string;
  readonly position: number;
  readonly state: "QUEUED" | "AWAITING_CHECKS" | "MERGEABLE" | "UNMERGEABLE" | "LOCKED";
  readonly jump: boolean;
}

export interface World {
  readonly io: MergeIo;
  /** A step context on this world. */
  context(patch?: Partial<StepContext>): StepContext;
  /** Patch of the PR query. Each key replaces the default. */
  pr: Record<string, unknown>;
  head: Sha;
  prState: "OPEN" | "MERGED" | "CLOSED";
  mergeCommit: Sha;
  /** Number of PR reads so far. */
  gathers: number;
  /** Runs before each PR read. The test changes the world here. */
  script: ((gather: number, world: World) => void) | null;
  /** Base-branch policy file text, or null for no file. The `schema = 1` line is added when missing. */
  policyToml: string | null;
  /** `merge_method` of the queue rule, or null for a rule without one, or "none" for no rule. */
  queueMethod: string | null | "none";
  /** False: the base branch has no merge queue. */
  hasQueue: boolean;
  allowedMethods: readonly string[];
  /** Changed files (a rename has a previous name), or "fail" when the files API fails. */
  files: readonly (string | { readonly filename: string; readonly previous_filename: string })[] | "fail";
  /** Make the PR query fail: number of reads that fail from now on. */
  failReads: number;
  /** Runs before each mutation is applied. */
  beforeMutation: ((op: GhMutation, world: World) => void) | null;
  /** Replies for mutations. A function that returns a result replaces the default. */
  mutationReply: Partial<Record<GhMutation["kind"], (op: GhMutation) => RunResult>>;
  /** The next reads of the policy file fail with a 502. Counts down. */
  policyFails: number;
  /** `gh pr merge` fails with this text. */
  mergeFails: string | null;
  /** `gh pr comment` fails. */
  commentFails: boolean;
  readonly calls: string[][];
  readonly mutations: GhMutation[];
  readonly mutationArgv: string[][];
  readonly comments: string[];
  readonly merges: string[][];
  readonly sleeps: number[];
  readonly lines: string[];
  /** Directory of the watch locks. */
  readonly lockDir: string;
  /** Pids that count as alive. Pid 4242 is the pid of this run. */
  alivePids: Set<number>;
  /** Start times by pid. A pid without an entry has none. */
  starts: Map<number, string>;
  /** Handlers that the watch installed for the stop signals. */
  readonly signalHandlers: ((signal: StopSignal) => void)[];
  /** Exit codes that the watch asked for. */
  readonly exits: number[];
  queue(entry: Partial<QueueEntryData> | null): void;
  removed(reason: string): void;
}

export function headPatch(oid: Sha): Record<string, unknown> {
  return {
    headRefOid: oid,
    commits: { totalCount: 1, pageInfo: { hasPreviousPage: false, startCursor: null }, nodes: [commitNode(oid, [OLD])] },
  };
}

const lockDirs: string[] = [];

/** Remove the lock directories that the worlds made. Call it in afterEach. */
export function removeWorlds(): void {
  for (const dir of lockDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A runaway loop in a fake clock fails the test instead of hanging the suite. */
const MAX_SLEEPS = 2000;

export function ok(data: unknown = {}): RunResult {
  return { code: 0, stdout: JSON.stringify({ data }), stderr: "" };
}

export function graphqlError(message: string): RunResult {
  return { code: 1, stdout: JSON.stringify({ data: null, errors: [{ message }] }), stderr: `gh: ${message}` };
}

export function makeWorld(patch: Partial<Pick<World, "policyToml" | "queueMethod" | "hasQueue" | "allowedMethods" | "files">> = {}): World {
  const calls: string[][] = [];
  const mutations: GhMutation[] = [];
  const mutationArgv: string[][] = [];
  const comments: string[] = [];
  const merges: string[][] = [];
  const sleeps: number[] = [];
  const lines: string[] = [];
  const signalHandlers: ((signal: StopSignal) => void)[] = [];
  const exits: number[] = [];
  let clock = 1_000_000;
  const lockDir = mkdtempSync(join(tmpdir(), "pr-merge-test-"));
  lockDirs.push(lockDir);

  // The closures below read `world` when they run, after it is built.
  const graphqlGh = fakeGh({
    pr: () => {
      world.gathers += 1;
      world.script?.(world.gathers, world);
      if (world.failReads > 0) {
        world.failReads -= 1;
        return { errors: [{ message: "read failed" }] };
      }
      return prResponse({ ...headPatch(world.head), state: world.prState, ...world.pr });
    },
    base: () => baseResponse(world.hasQueue ? {} : { mergeQueue: null }),
    issue: () => ({ data: { repository: { issueOrPullRequest: null } } }),
    mergeability: () => ({ data: {} }),
  });

  const notFound = (endpoint: string): RunResult => ({ code: 1, stdout: "", stderr: `gh: Not Found (HTTP 404) for ${endpoint}` });

  const runGh = async (args: readonly string[]): Promise<RunResult> => {
    calls.push([...args]);
    const guard = checkGh(args);
    if (!guard.allowed) {
      throw new Error(`fake gh: the guard refused ${args.slice(0, 3).join(" ")}: ${guard.reason}`);
    }
    if (args[0] === "pr") {
      switch (args[1]) {
        case "merge": {
          merges.push([...args]);
          if (world.mergeFails !== null) {
            return { code: 1, stdout: "", stderr: world.mergeFails };
          }
          world.prState = "MERGED";
          return { code: 0, stdout: "", stderr: "" };
        }
        case "view":
          return {
            code: 0,
            stdout: JSON.stringify({ state: world.prState, mergeCommit: world.prState === "MERGED" ? { oid: world.mergeCommit } : null, headRefOid: world.head }),
            stderr: "",
          };
        case "comment": {
          const file = args[args.indexOf("--body-file") + 1] ?? "";
          if (world.commentFails) {
            return { code: 1, stdout: "", stderr: "gh: comment failed" };
          }
          comments.push(readFileSync(file, "utf8"));
          return { code: 0, stdout: "", stderr: "" };
        }
        default:
          throw new Error(`fake gh: no handler for gh pr ${args[1] ?? ""}`);
      }
    }
    if (args[0] === "api" && args[1] !== "graphql") {
      const endpoint = args.find((a, i) => i > 0 && !a.startsWith("-") && args[i - 1] !== "-X" && args[i - 1] !== "-H") ?? "";
      if (endpoint.startsWith(`repos/${REPO}/contents/.config/pr-policy.toml`)) {
        if (world.policyFails > 0) {
          world.policyFails -= 1;
          return { code: 1, stdout: "", stderr: "gh: HTTP 502: Bad Gateway" };
        }
        return world.policyToml === null ? notFound(endpoint) : { code: 0, stdout: /^schema\s*=/m.test(world.policyToml) ? world.policyToml : `schema = 1\n${world.policyToml}`, stderr: "" };
      }
      if (endpoint.startsWith(`repos/${REPO}/pulls/7/files`)) {
        if (world.files === "fail") {
          return { code: 1, stdout: "", stderr: "gh: Server Error (HTTP 500)" };
        }
        const page = Number(/[?&]page=(\d+)/.exec(endpoint)?.[1] ?? "1");
        const perPage = Number(/[?&]per_page=(\d+)/.exec(endpoint)?.[1] ?? "30");
        const items = world.files.slice((page - 1) * perPage, page * perPage).map((f) => (typeof f === "string" ? { filename: f, status: "modified" } : { ...f, status: "renamed" }));
        return { code: 0, stdout: JSON.stringify(items), stderr: "" };
      }
      if (endpoint === `repos/${REPO}/rules/branches/main`) {
        const rules: unknown[] = [
          { type: "pull_request", parameters: { required_approving_review_count: 0, require_code_owner_review: false, dismiss_stale_reviews_on_push: true, required_review_thread_resolution: true, allowed_merge_methods: world.allowedMethods } },
        ];
        if (world.hasQueue && world.queueMethod !== "none") {
          rules.push({ type: "merge_queue", parameters: world.queueMethod === null ? {} : { merge_method: world.queueMethod } });
        }
        return { code: 0, stdout: JSON.stringify(rules), stderr: "" };
      }
      if (endpoint === `repos/${REPO}/branches/main`) {
        return { code: 0, stdout: JSON.stringify({ protection: { enabled: false } }), stderr: "" };
      }
      return notFound(endpoint);
    }
    return graphqlGh.run(args);
  };

  const mutate = async (op: GhMutation): Promise<RunResult> => {
    mutations.push(op);
    mutationArgv.push([...ghMutationArgv(op)]);
    world.beforeMutation?.(op, world);
    const custom = world.mutationReply[op.kind];
    if (custom !== undefined) {
      return custom(op);
    }
    switch (op.kind) {
      case "enqueuePullRequest":
        world.queue({ jump: op.jump });
        return ok({ enqueuePullRequest: { mergeQueueEntry: { id: "MQE_1", position: 3, state: "QUEUED" } } });
      case "dequeuePullRequest":
        world.queue(null);
        return ok({ dequeuePullRequest: { mergeQueueEntry: { id: op.entryId } } });
      case "markPullRequestReadyForReview":
        world.pr = { ...world.pr, isDraft: false };
        return ok({ markPullRequestReadyForReview: { pullRequest: { id: op.pullRequestId, isDraft: false } } });
      default:
        throw new Error(`fake gh: unexpected mutation ${op.kind}`);
    }
  };

  const slug = parseRepoSlug(REPO);
  if (!slug.ok) {
    throw new Error("slug");
  }
  const io: MergeIo = {
    runGh,
    mutate,
    sleep: async (ms) => {
      sleeps.push(ms);
      if (sleeps.length > MAX_SLEEPS) {
        throw new Error("runaway loop: the fake clock slept more than the bound");
      }
      clock += ms;
    },
    now: () => clock,
    lockDir,
    pid: 4242,
    isAlive: (pid) => world.alivePids.has(pid),
    startOf: (pid) => world.starts.get(pid) ?? null,
    onStopSignal: (handler) => {
      signalHandlers.push(handler);
      return () => void signalHandlers.splice(signalHandlers.indexOf(handler), 1);
    },
    exit: (code) => void exits.push(code),
  };
  const context = (extra: Partial<StepContext> = {}): StepContext => ({
    repo: slug.value,
    number: 7,
    cwd: "/",
    gitDir: null,
    io,
    shared: newShared(),
    say: (line: string) => void lines.push(line),
    confirmed: true,
    ...extra,
  });

  const world: World = {
    pr: {},
    head: HEAD,
    prState: "OPEN",
    mergeCommit: sha("e"),
    gathers: 0,
    script: null,
    policyToml: null,
    queueMethod: "SQUASH",
    hasQueue: true,
    allowedMethods: ["squash"],
    files: ["src/lib.rs"],
    failReads: 0,
    beforeMutation: null,
    mutationReply: {},
    policyFails: 0,
    mergeFails: null,
    commentFails: false,
    calls,
    mutations,
    mutationArgv,
    comments,
    merges,
    sleeps,
    lines,
    lockDir,
    alivePids: new Set([4242]),
    starts: new Map(),
    signalHandlers,
    exits,
    ...patch,
    io,
    context,
    queue(entry) {
      world.pr = {
        ...world.pr,
        mergeQueueEntry:
          entry === null ? null : { id: "MQE_1", position: 3, state: "QUEUED", jump: false, enqueuedAt: "2026-01-02T00:00:00Z", ...entry },
      };
    },
    removed(reason) {
      world.pr = {
        ...world.pr,
        timelineItems: {
          nodes: [{ __typename: "RemovedFromMergeQueueEvent", createdAt: "2026-01-03T00:00:00Z", reason, beforeCommit: { oid: world.head } }],
        },
      };
    },
  };

  return world;
}
