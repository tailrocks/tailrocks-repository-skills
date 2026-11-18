import { afterEach, describe, expect, test } from "bun:test";
import { removeBodyFiles } from "../lib/body-file.ts";
import { acquireWatchLock } from "../lib/merge/lock.ts";
import { LOCK_PREFIX } from "../lib/fleet/apply.ts";
import { fakeRefresh, headOf, makeFleetWorld, REPO, removeFleetWorlds } from "./helpers/fleet-world.ts";
import { DEADLINE_SECONDS, LOCK_SECONDS, estimatedReads } from "../lib/fleet/apply.ts";
import { sha } from "./helpers/status.ts";
import { runFleet } from "./helpers/fleet-run.ts";
import type { GhMutation } from "../lib/safety-gh.ts";
import { parseRepoSlug } from "../lib/types.ts";

afterEach(() => {
  removeBodyFiles();
  removeFleetWorlds();
});

const OTHER = 9999;

function prOf(world: ReturnType<typeof makeFleetWorld>, number: number) {
  const pr = world.prs.get(number);
  if (pr === undefined) throw new Error(`no PR ${number}`);
  return pr;
}

function target(op: GhMutation): string {
  if (op.kind === "dequeuePullRequest") return op.entryId;
  if (op.kind === "enqueuePullRequest") return op.pullRequestId;
  throw new Error(`unexpected mutation ${op.kind}`);
}

function kinds(world: ReturnType<typeof makeFleetWorld>): readonly string[] {
  return world.mutations.map((m) => `${m.kind}`);
}

describe("apply without --apply", () => {
  test("prints the plan, writes nothing, and exits 4", async () => {
    const world = makeFleetWorld();
    const run = await runFleet(world, ["apply"]);
    expect(run.code).toBe(4);
    expect(run.out.join("\n")).toContain("nothing was written; add --apply");
    expect(world.mutations).toEqual([]);
    expect(world.merges).toEqual([]);
  });

  test("a plan with no action has nothing to do and exits 0", async () => {
    const world = makeFleetWorld();
    for (const number of [11, 19, 13, 14, 17, 20]) world.prs.delete(number);
    const run = await runFleet(world, ["apply"]);
    expect(run.code).toBe(0);
    expect(run.out.join("\n")).toContain("nothing to do");
  });
});

describe("apply --apply", () => {
  test("dequeues the UNMERGEABLE entry, enqueues READY PRs, and leaves refresh pending without pr-refresh", async () => {
    const world = makeFleetWorld();
    world.queueLength = 2;
    const run = await runFleet(world, ["apply", "--apply"]);
    expect(kinds(world)).toEqual(["dequeuePullRequest", "enqueuePullRequest", "enqueuePullRequest"]);
    expect(world.mutations.map(target)).toEqual(["MQE_13", "PR_node_11", "PR_node_19"]);
    const text = run.out.join("\n");
    expect(text).toContain("done: dequeue #13");
    expect(text).toContain("done: merge #11");
    expect(text).toContain("pending: refresh #14: pending: pr-refresh not available");
    expect(text).toContain("refreshes run: 0");
    // 10: nothing failed, and two refreshes are pending.
    expect(run.code).toBe(10);
    // The dequeue wrote its reason comment.
    expect(world.comments).toHaveLength(1);
    expect(world.comments[0]).toContain("UNMERGEABLE");
  });

  test("enqueue pins the head that the plan saw", async () => {
    const world = makeFleetWorld();
    await runFleet(world, ["apply", "--apply"]);
    const enqueue = world.mutations.find((m) => m.kind === "enqueuePullRequest");
    expect(enqueue).toMatchObject({ expectedHeadOid: headOf(prOf(world, 11)), jump: false });
  });

  test("never more refreshes than the budget allows", async () => {
    const world = makeFleetWorld();
    // Three candidates (14, 17, 20), room for two: the queue stays below 5.
    world.policyToml = "[ci]\ncongestion_queue_length = 9";
    for (const number of [11, 19]) world.prs.delete(number);
    const port = fakeRefresh();
    const run = await runFleet(world, ["apply", "--apply"], { refresh: port });
    expect(port.calls).toEqual([14, 17]);
    expect(run.out.join("\n")).toContain("refreshes run: 2");
    expect(run.code).toBe(0);
  });

  test("a budget of one allows one refresh", async () => {
    const world = makeFleetWorld();
    world.policyToml = "[ci]\ncongestion_queue_length = 9\nmax_refreshes = 1";
    const port = fakeRefresh();
    await runFleet(world, ["apply", "--apply"], { refresh: port });
    expect(port.calls).toEqual([14]);
  });

  test("the queue grows while the fleet enqueues, so the budget shrinks before the refreshes run", async () => {
    const world = makeFleetWorld();
    // Queue 4 now: below 5, so the plan holds two refreshes and one enqueue. The enqueue makes it 5: congested.
    world.prs.delete(13);
    const port = fakeRefresh();
    const run = await runFleet(world, ["apply", "--apply"], { refresh: port });
    expect(port.calls).toEqual([]);
    expect(run.out.join("\n")).toContain("skipped: refresh #14: deferred: the queue is congested");
    expect(run.code).toBe(0);
  });

  test("a refresh that fails is reported and stops nothing else", async () => {
    const world = makeFleetWorld();
    world.policyToml = "[ci]\ncongestion_queue_length = 9";
    for (const number of [11, 19]) world.prs.delete(number);
    const port = fakeRefresh({ ok: false, note: "conflict outside the generated files", next: "resolve keeping both sides" });
    const run = await runFleet(world, ["apply", "--apply"], { refresh: port });
    expect(port.calls).toEqual([14, 17]);
    expect(run.code).toBe(20);
    expect(run.out.join("\n")).toContain("stopped: refresh #14");
    expect(run.out.join("\n")).toContain("next: #14: resolve keeping both sides");
  });

  test("a failed refresh still counts against the budget", async () => {
    const world = makeFleetWorld();
    world.policyToml = "[ci]\ncongestion_queue_length = 9";
    for (const number of [11, 19]) world.prs.delete(number);
    // The plan holds two refreshes. After the first write, a new policy commit lowers the budget to one.
    let first = true;
    world.afterWrite = (w) => {
      if (first) {
        first = false;
        w.policyToml = "[ci]\ncongestion_queue_length = 9\nmax_refreshes = 1";
        w.defaultSha = sha("e");
      }
    };
    const port = fakeRefresh({ ok: false, note: "blocked", next: "none" });
    const run = await runFleet(world, ["apply", "--apply"], { refresh: port });
    expect(port.calls).toEqual([14]);
    expect(run.out.join("\n")).toContain("skipped: refresh #17: deferred: the budget is used (1 refreshes run in this pass, 0 still in CI, budget 1)");
  });

  test("refreshes that still run CI from an earlier pass count against the budget in apply", async () => {
    const world = makeFleetWorld();
    world.policyToml = "[ci]\ncongestion_queue_length = 9";
    for (const number of [11, 19]) world.prs.delete(number);
    world.addPr(50, { headRef: "feat/refreshed", preset: "refreshing" });
    const port = fakeRefresh();
    await runFleet(world, ["apply", "--apply"], { refresh: port });
    expect(port.calls).toEqual([14]);
  });
});

describe("re-evaluation right before each action", () => {
  test("a head that moved after the plan stops the merge, and nothing is written for it", async () => {
    const world = makeFleetWorld();
    // The plan reads 10 PRs. The next reads belong to apply. Move PR 11 before its fresh read.
    world.script = (gather, w) => {
      if (gather > 10) {
        prOf(w, 11).headChar = "9";
      }
    };
    const run = await runFleet(world, ["apply", "--apply"]);
    const text = run.out.join("\n");
    expect(text).toContain("stopped: merge #11: the head moved since the plan");
    expect(world.mutations.some((m) => m.kind === "enqueuePullRequest" && target(m) === "PR_node_11")).toBe(false);
    expect(run.code).toBe(20);
  });

  test("an entry that is no longer UNMERGEABLE is left alone", async () => {
    const world = makeFleetWorld();
    world.script = (gather, w) => {
      const pr = w.prs.get(13);
      if (gather > 10 && pr !== undefined && pr.queue !== null) pr.queue = { position: 2, state: "MERGEABLE" };
    };
    const run = await runFleet(world, ["apply", "--apply"]);
    expect(run.out.join("\n")).toContain("skipped: dequeue #13");
    expect(world.mutations.some((m) => m.kind === "dequeuePullRequest")).toBe(false);
  });

  test("a dequeue whose head moved is stopped even when the entry is still UNMERGEABLE", async () => {
    const world = makeFleetWorld();
    world.script = (gather, w) => {
      if (gather > 10) prOf(w, 13).headChar = "9";
    };
    const run = await runFleet(world, ["apply", "--apply"]);
    expect(run.out.join("\n")).toContain("stopped: dequeue #13: the head moved since the plan");
    expect(world.mutations.some((m) => m.kind === "dequeuePullRequest")).toBe(false);
    expect(run.code).toBe(20);
  });

  test("a dequeue is skipped when the entry has dropped out of the first 5 positions", async () => {
    const world = makeFleetWorld();
    world.script = (gather, w) => {
      const pr = prOf(w, 13);
      if (gather > 10 && pr.queue !== null) pr.queue = { position: 6, state: "UNMERGEABLE" };
    };
    const run = await runFleet(world, ["apply", "--apply"]);
    expect(run.out.join("\n")).toContain("skipped: dequeue #13: the entry is UNMERGEABLE at position 6");
    expect(world.mutations.some((m) => m.kind === "dequeuePullRequest")).toBe(false);
  });

  test("a dequeue is skipped when the PR was retargeted to another base branch", async () => {
    const world = makeFleetWorld();
    world.script = (gather, w) => {
      if (gather > 10) prOf(w, 13).baseRef = "release/1";
    };
    const run = await runFleet(world, ["apply", "--apply"]);
    expect(run.out.join("\n")).toContain("skipped: dequeue #13: the PR base is release/1, not the default branch");
    expect(world.mutations.some((m) => m.kind === "dequeuePullRequest")).toBe(false);
  });

  test("a PR that is no longer READY is not enqueued", async () => {
    const world = makeFleetWorld();
    world.queueLength = 2;
    world.script = (gather, w) => {
      if (gather > 10) w.setPreset(19, "unresolved-thread");
    };
    const run = await runFleet(world, ["apply", "--apply"]);
    expect(run.out.join("\n")).toContain("skipped: merge #19");
    expect(world.mutations.some((m) => m.kind === "enqueuePullRequest" && target(m) === "PR_node_19")).toBe(false);
  });

  test("a PR that no longer needs a base merge is not refreshed", async () => {
    const world = makeFleetWorld();
    world.policyToml = "[ci]\ncongestion_queue_length = 9";
    for (const number of [11, 19]) world.prs.delete(number);
    const port = fakeRefresh();
    world.script = (gather, w) => {
      if (gather > 8) w.setPreset(14, "ready");
    };
    const run = await runFleet(world, ["apply", "--apply"], { refresh: port });
    expect(port.calls).not.toContain(14);
    expect(run.out.join("\n")).toContain("skipped: refresh #14");
  });

  test("a refresh target whose head moved is stopped and not refreshed", async () => {
    const world = makeFleetWorld();
    world.policyToml = "[ci]\ncongestion_queue_length = 9";
    for (const number of [11, 19]) world.prs.delete(number);
    const port = fakeRefresh();
    world.script = (gather, w) => {
      if (gather > 8) prOf(w, 14).headChar = "9";
    };
    const run = await runFleet(world, ["apply", "--apply"], { refresh: port });
    expect(port.calls).toEqual([17]);
    expect(run.out.join("\n")).toContain("stopped: refresh #14: the head moved since the plan");
    expect(run.code).toBe(20);
  });

  test("a high-risk path is refused by pr-merge, and the fleet never accepts the risk", async () => {
    const world = makeFleetWorld();
    world.files = [".github/workflows/ci.yml"];
    const run = await runFleet(world, ["apply", "--apply"]);
    expect(world.mutations.some((m) => m.kind === "enqueuePullRequest")).toBe(false);
    expect(run.out.join("\n")).toContain("stopped: merge #11");
    expect(run.out.join("\n")).toContain("high-risk");
    expect(run.code).toBe(20);
  });
});

describe("pass deadline", () => {
  test("the pass deadline is below the lock bound", () => {
    expect(DEADLINE_SECONDS).toBeLessThan(LOCK_SECONDS);
  });
});

describe("freeze, local policy, and one apply at a time", () => {
  test("freeze refuses apply with exit 3 and writes nothing", async () => {
    const world = makeFleetWorld();
    world.policyToml = "[fleet]\nfreeze = true";
    const run = await runFleet(world, ["apply", "--apply"], { refresh: fakeRefresh() });
    expect(run.code).toBe(3);
    expect(run.out.join("\n")).toContain("refused: freeze is on");
    expect(world.mutations).toEqual([]);
    expect(world.merges).toEqual([]);
  });

  test("PR_FLEET_FREEZE=1 refuses apply, with or without --apply", async () => {
    for (const argv of [["apply", "--apply"], ["apply"]]) {
      const world = makeFleetWorld();
      const port = fakeRefresh();
      const run = await runFleet(world, argv, { env: { PR_FLEET_FREEZE: "1" }, refresh: port });
      expect(run.code).toBe(3);
      expect(world.mutations).toEqual([]);
      expect(port.calls).toEqual([]);
    }
  });

  test("a local policy file is refused by apply", async () => {
    const world = makeFleetWorld();
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const file = join(world.lockDir, "local.toml");
    writeFileSync(file, "schema = 1\n");
    const run = await runFleet(world, ["apply", "--apply", "--policy", file]);
    expect(run.code).toBe(3);
    expect(run.out.join("\n")).toContain("local policy");
    expect(world.mutations).toEqual([]);
  });

  test("a second apply is refused while the first holds the lock", async () => {
    const world = makeFleetWorld();
    world.alivePids.add(OTHER);
    const slug = parseRepoSlug(REPO);
    if (!slug.ok) throw new Error("slug");
    const held = acquireWatchLock({
      dir: world.lockDir,
      repo: slug.value,
      number: 0,
      timeoutSeconds: 3600,
      now: world.io.now,
      isAlive: world.io.isAlive,
      startOf: world.io.startOf,
      pid: OTHER,
      prefix: LOCK_PREFIX,
    });
    expect(held.ok).toBe(true);
    const run = await runFleet(world, ["apply", "--apply"]);
    expect(run.code).toBe(3);
    expect(run.out.join("\n")).toContain("another fleet apply (process 9999) is running");
    expect(world.mutations).toEqual([]);
  });

  test("the lock is released after the run, so the next apply can run", async () => {
    const world = makeFleetWorld();
    expect((await runFleet(world, ["apply", "--apply"])).code).toBe(10);
    expect((await runFleet(world, ["apply", "--apply"])).code).not.toBe(3);
  });
});

describe("rate limit", () => {
  test("the estimate counts 4 reads for an enqueue, 3 for a dequeue, and 6 for a refresh", () => {
    const action = (kind: "dequeue" | "merge" | "refresh") => ({ kind, number: 1, headSha: sha("a"), detail: "", late: false, pending: null });
    expect(estimatedReads([action("merge")])).toBe(4);
    expect(estimatedReads([action("dequeue"), action("merge"), action("refresh")])).toBe(13);
    expect(estimatedReads([])).toBe(0);
  });

  test("a budget that covers the plan but not the writes stops apply with exit 2", async () => {
    const world = makeFleetWorld();
    world.prs.clear();
    world.addPr(100, { headRef: "feat/only" });
    world.queueLength = 0;
    // Plan: 2 x 8 = 16 points. The enqueue: 4 reads x 8 = 32 points. Three reads would need only 24.
    world.graphqlRemaining = 28;
    const run = await runFleet(world, ["apply", "--apply"]);
    expect(run.code).toBe(2);
    expect(world.mutations).toEqual([]);
  });

  test("a low GraphQL budget stops the plan with exit 2 and reads no PR", async () => {
    const world = makeFleetWorld();
    world.graphqlRemaining = 10;
    const run = await runFleet(world, ["plan"]);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("GraphQL budget");
    expect(world.gathers).toBe(0);
  });

  test("a low budget before the writes stops apply with exit 2 and nothing is written", async () => {
    const world = makeFleetWorld();
    // 10 PRs need 88 points to plan; five actions need 120 more.
    world.graphqlRemaining = 100;
    const run = await runFleet(world, ["apply", "--apply"]);
    expect(run.code).toBe(2);
    expect(world.mutations).toEqual([]);
  });
});
