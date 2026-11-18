import { afterEach, describe, expect, test } from "bun:test";
import { removeBodyFiles } from "../lib/body-file.ts";
import { fakeRefresh, makeFleetWorld, onlyReady, removeFleetWorlds } from "./helpers/fleet-world.ts";
import { planOf, runFleet } from "./helpers/fleet-run.ts";
import { sha } from "./helpers/status.ts";

afterEach(() => {
  removeBodyFiles();
  removeFleetWorlds();
});

function enqueues(world: ReturnType<typeof makeFleetWorld>): number {
  return world.mutations.filter((m) => m.kind === "enqueuePullRequest").length;
}

describe("merge budget through a merge queue", () => {
  test("22 READY PRs give 3 enqueues and 19 deferred", async () => {
    const world = makeFleetWorld();
    onlyReady(world, 22);
    world.queueLength = 0;
    const plan = await planOf(world);
    expect(plan.merge).toMatchObject({ route: "queue", cap: 3 });
    expect(plan.merge.planned).toEqual([100, 101, 102]);
    expect(plan.merge.deferred).toHaveLength(19);
    expect(plan.merge.deferred[0]).toBe(103);
    expect(plan.actions.filter((a) => a.kind === "merge")).toHaveLength(3);
    const run = await runFleet(world, ["apply", "--apply"]);
    expect(enqueues(world)).toBe(3);
    expect(run.code).toBe(0);
    expect(run.out.join("\n")).toContain("deferred (merge budget): #103, #104");
  });

  test("the queue room limits the cap: length + enqueues stays at or below ci.congestion_queue_length", async () => {
    const world = makeFleetWorld();
    onlyReady(world, 22);
    world.queueLength = 3; // threshold 5: room for 2
    const plan = await planOf(world);
    expect(plan.merge.cap).toBe(2);
    await runFleet(world, ["apply", "--apply"]);
    expect(enqueues(world)).toBe(2);
    expect(world.queueLength).toBe(5);
  });

  test("a queue at the congestion length gives 0 merges (default congested cap)", async () => {
    const world = makeFleetWorld();
    onlyReady(world, 22);
    world.queueLength = 5;
    const plan = await planOf(world);
    expect(plan.merge.cap).toBe(0);
    expect(plan.merge.planned).toEqual([]);
    expect(plan.merge.deferred).toHaveLength(22);
    const run = await runFleet(world, ["apply", "--apply"]);
    expect(enqueues(world)).toBe(0);
    expect(run.code).toBe(0);
  });

  test("a queue whose length GitHub does not show gives 0 merges", async () => {
    const world = makeFleetWorld();
    onlyReady(world, 5);
    world.queueLength = null;
    expect((await planOf(world)).merge.cap).toBe(0);
  });

  test("the policy sets the cap, and the room still limits it", async () => {
    const world = makeFleetWorld();
    onlyReady(world, 22);
    world.queueLength = 0;
    world.policyToml = "[fleet]\nmax_merges_per_pass = 4\n[ci]\ncongestion_queue_length = 10";
    expect((await planOf(world)).merge.cap).toBe(4);
    world.policyToml = "[fleet]\nmax_merges_per_pass = 9\n[ci]\ncongestion_queue_length = 6";
    expect((await planOf(world)).merge.cap).toBe(6);
    world.policyToml = "[fleet]\nmax_merges_per_pass = 0";
    expect((await planOf(world)).merge.cap).toBe(0);
  });

  test("the queue grows while the fleet enqueues, so the refresh budget shrinks", async () => {
    const world = makeFleetWorld();
    onlyReady(world, 3);
    world.addPr(200, { headRef: "feat/behind", preset: "behind-approved" });
    world.queueLength = 2;
    // Plan: room 3, cap 3, so 3 enqueues. The queue then holds 5: refreshes are congested.
    const port = fakeRefresh();
    await runFleet(world, ["apply", "--apply"], { refresh: port });
    expect(enqueues(world)).toBe(3);
    expect(port.calls).toEqual([]);
  });
});

describe("merge budget for direct merges", () => {
  test("22 READY PRs give 1 direct merge", async () => {
    const world = makeFleetWorld();
    onlyReady(world, 22);
    world.hasQueue = false;
    world.queueLength = 0;
    world.strictUpToDate = false;
    const plan = await planOf(world);
    expect(plan.merge).toMatchObject({ route: "direct", cap: 1 });
    expect(plan.merge.deferred).toHaveLength(21);
    const run = await runFleet(world, ["apply", "--apply"]);
    expect(world.merges).toHaveLength(1);
    expect(enqueues(world)).toBe(0);
    expect(run.code).toBe(0);
  });

  test("after a direct merge the next PR is read again, and one that is behind the new base is a refresh candidate, not a merge", async () => {
    const world = makeFleetWorld();
    onlyReady(world, 3);
    world.hasQueue = false;
    world.queueLength = 0;
    world.strictUpToDate = false;
    world.policyToml = "[fleet]\nmax_merges_per_pass = 3";
    const port = fakeRefresh();
    const run = await runFleet(world, ["apply", "--apply"], { refresh: port });
    expect(world.merges).toHaveLength(1);
    const text = run.out.join("\n");
    expect(text).toContain("skipped: merge #101: behind the new base");
    expect(text).toContain("skipped: merge #102: behind the new base");
    expect(port.calls).toEqual([101, 102]);
    expect(run.code).toBe(0);
  });

  test("a PR behind the new base is refreshed only within the refresh budget", async () => {
    const world = makeFleetWorld();
    onlyReady(world, 4);
    world.hasQueue = false;
    world.queueLength = 0;
    world.strictUpToDate = false;
    world.policyToml = "[fleet]\nmax_merges_per_pass = 4\n[ci]\nmax_refreshes = 1";
    const port = fakeRefresh();
    await runFleet(world, ["apply", "--apply"], { refresh: port });
    expect(world.merges).toHaveLength(1);
    expect(port.calls).toEqual([101]);
  });
});

describe("documentation of the cap", () => {
  test("the plan text names the merge budget and the deferred PRs", async () => {
    const world = makeFleetWorld();
    onlyReady(world, 5);
    world.queueLength = 0;
    const run = await runFleet(world, ["plan"]);
    expect(run.out.join("\n")).toContain("merge budget: 3 (queue)");
    expect(run.out.join("\n")).toContain("deferred (merge budget): #103, #104");
  });

  test("a held PR takes no part in the merge budget", async () => {
    const world = makeFleetWorld();
    onlyReady(world, 5);
    world.queueLength = 0;
    world.policyToml = "[fleet]\nhold = [100]";
    expect((await planOf(world)).merge.planned).toEqual([101, 102, 103]);
  });
});

describe("mid-pass freeze and hold", () => {
  function freezeAfterFirstWrite(world: ReturnType<typeof makeFleetWorld>, toml: string): void {
    let first = true;
    world.afterWrite = (w) => {
      if (first) {
        first = false;
        w.policyToml = toml;
        w.defaultSha = sha("e"); // the policy file changed in a new commit of the default branch
      }
    };
  }

  test("a freeze turned on in the policy after the first write stops the pass with exit 3", async () => {
    const world = makeFleetWorld();
    onlyReady(world, 3);
    world.queueLength = 0;
    freezeAfterFirstWrite(world, "[fleet]\nfreeze = true");
    const run = await runFleet(world, ["apply", "--apply"]);
    expect(enqueues(world)).toBe(1);
    expect(run.code).toBe(3);
    const text = run.out.join("\n");
    expect(text).toContain("refused: merge #101");
    expect(text).toContain("refused: merge #102");
    expect(text).toContain("freeze is on");
  });

  test("PR_FLEET_FREEZE=1 set after the first write stops the pass with exit 3", async () => {
    const world = makeFleetWorld();
    onlyReady(world, 3);
    world.queueLength = 0;
    const env: Record<string, string | undefined> = {};
    world.afterWrite = () => {
      env["PR_FLEET_FREEZE"] = "1";
    };
    const run = await runFleet(world, ["apply", "--apply"], { env });
    expect(enqueues(world)).toBe(1);
    expect(run.code).toBe(3);
  });

  test("a freeze stops a dequeue and a refresh too", async () => {
    const world = makeFleetWorld();
    world.policyToml = "[ci]\ncongestion_queue_length = 9";
    for (const number of [11, 19]) world.prs.delete(number);
    const port = fakeRefresh();
    freezeAfterFirstWrite(world, "[ci]\ncongestion_queue_length = 9\n[fleet]\nfreeze = true");
    const run = await runFleet(world, ["apply", "--apply"], { refresh: port });
    // The dequeue of #13 is the first write. Both refreshes are then refused.
    expect(world.mutations.map((m) => m.kind)).toEqual(["dequeuePullRequest"]);
    expect(port.calls).toEqual([]);
    expect(run.code).toBe(3);
  });

  test("a PR that the policy holds after the plan is skipped, and the pass goes on", async () => {
    const world = makeFleetWorld();
    onlyReady(world, 3);
    world.queueLength = 0;
    freezeAfterFirstWrite(world, "[fleet]\nhold = [101]");
    const run = await runFleet(world, ["apply", "--apply"]);
    const text = run.out.join("\n");
    expect(text).toContain("skipped: merge #101: held by the policy");
    expect(text).toContain("done: merge #102");
    expect(enqueues(world)).toBe(2);
    expect(run.code).toBe(0);
  });
});

describe("budgets read again during the pass", () => {
  test("a merge budget that the policy lowers during the pass holds back the later merges", async () => {
    const world = makeFleetWorld();
    onlyReady(world, 3);
    world.queueLength = 0;
    let first = true;
    world.afterWrite = (w) => {
      if (first) {
        first = false;
        w.policyToml = "[fleet]\nmax_merges_per_pass = 1";
        w.defaultSha = sha("e");
      }
    };
    const run = await runFleet(world, ["apply", "--apply"]);
    expect(enqueues(world)).toBe(1);
    expect(run.out.join("\n")).toContain("skipped: merge #101: deferred (merge budget)");
  });

  test("a refresh budget that the policy lowers during the pass counts the refreshes still in CI", async () => {
    const world = makeFleetWorld();
    world.policyToml = "[ci]\ncongestion_queue_length = 9";
    for (const number of [11, 19]) world.prs.delete(number);
    world.addPr(50, { headRef: "feat/refreshed", preset: "refreshing" });
    // Budget 2, one refresh in CI: one is planned. The policy then lowers the budget to 1: none is left.
    let first = true;
    world.afterWrite = (w) => {
      if (first) {
        first = false;
        w.policyToml = "[ci]\ncongestion_queue_length = 9\nmax_refreshes = 1";
        w.defaultSha = sha("e");
      }
    };
    const port = fakeRefresh();
    const run = await runFleet(world, ["apply", "--apply"], { refresh: port });
    expect(port.calls).toEqual([]);
    expect(run.out.join("\n")).toContain("1 still in CI, budget 1");
  });

  test("a freeze that starts while an action reads is caught right before its write", async () => {
    const world = makeFleetWorld();
    onlyReady(world, 2);
    world.queueLength = 0;
    const env: Record<string, string | undefined> = {};
    // The plan reads 2 PRs. The first apply read is read 3: the freeze starts during it.
    world.script = (gather) => {
      if (gather === 3) env["PR_FLEET_FREEZE"] = "1";
    };
    const run = await runFleet(world, ["apply", "--apply"], { env });
    expect(enqueues(world)).toBe(0);
    expect(run.out.join("\n")).toContain("refused: merge #100: freeze is on (environment PR_FLEET_FREEZE=1)");
    expect(run.code).toBe(3);
  });
});

describe("pass deadline", () => {
  test("a pass that runs past its deadline leaves the remaining actions pending, below the lock bound", async () => {
    const world = makeFleetWorld();
    onlyReady(world, 3);
    world.queueLength = 0;
    world.afterWrite = (w) => {
      w.clock += 31 * 60 * 1000; // more than the 30 minute deadline, less than the 60 minute lock
    };
    const run = await runFleet(world, ["apply", "--apply"]);
    expect(enqueues(world)).toBe(1);
    expect(run.out.join("\n")).toContain("pending: merge #101: deferred (pass deadline)");
    expect(run.code).toBe(10);
  });
});
