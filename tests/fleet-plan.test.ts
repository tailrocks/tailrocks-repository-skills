import { afterEach, describe, expect, test } from "bun:test";
import { analyze, isApproved, isRefreshing, queueLength, rank, refreshBudget, type Read } from "../lib/fleet/analyze.ts";
import { loadPolicy } from "../lib/policy/load.ts";
import type { Policy } from "../lib/policy/types.ts";
import { removeFleetWorlds, makeFleetWorld } from "./helpers/fleet-world.ts";
import { numbersOf, planOf, runFleet } from "./helpers/fleet-run.ts";
import { BASE, OLD, builtinPolicy, check, green, policyFromText } from "./helpers/status.ts";

afterEach(removeFleetWorlds);

function policyWith(toml: string): Policy {
  const loaded = loadPolicy({ text: `schema = 1\n${toml}`, source: "default-branch" });
  if (!loaded.ok) {
    throw new Error(loaded.errors.map((e) => e.message).join("; "));
  }
  return loaded.policy;
}

describe("ranking", () => {
  test("READY first, then WAITING, then BLOCKED grouped by owner, and a draft is blocked", async () => {
    const plan = await planOf(makeFleetWorld());
    expect(plan.ranking.map((e) => `${e.number}:${e.state}:${e.owner}`)).toEqual([
      "11:READY:pr-merge",
      "19:READY:pr-merge",
      "12:WAITING:pr-merge",
      "14:BLOCKED:pr-refresh",
      "17:BLOCKED:pr-refresh",
      "20:BLOCKED:pr-refresh",
      "15:BLOCKED:pr-threads",
      "13:BLOCKED:pr-merge",
      "18:BLOCKED:pr-merge",
      "16:BLOCKED:reviewer",
    ]);
  });

  test("each entry carries the exact next action of the verdict", async () => {
    const plan = await planOf(makeFleetWorld());
    const thread = plan.ranking.find((e) => e.number === 15);
    expect(thread?.next).toContain("pr-threads");
    expect(thread?.blockers).toEqual(["threads_unresolved"]);
    const review = plan.ranking.find((e) => e.number === 16);
    expect(review?.blockers).toEqual(["review_decision"]);
  });

  test("rank is stable by PR number inside one group", () => {
    const base = { author: "a", headRef: "x", baseRef: "main", headSha: null, owner: "ci", next: "n", codes: [], blockers: [], isDraft: false, isCrossRepository: false, queue: null, behind: false, approved: false, refreshing: false } as const;
    const ranked = rank([
      { ...base, number: 9, state: "BLOCKED" },
      { ...base, number: 3, state: "BLOCKED" },
      { ...base, number: 5, state: "WAITING" },
      { ...base, number: 8, state: "READY" },
    ]);
    expect(ranked.map((e) => e.number)).toEqual([8, 5, 3, 9]);
  });

  test("a held PR is not read and not ranked", async () => {
    const world = makeFleetWorld();
    world.policyToml = "[fleet]\nhold = [11, 20]";
    const plan = await planOf(world);
    expect(plan.held).toEqual([11, 20]);
    expect(plan.open).toBe(10);
    expect(numbersOf(plan.ranking)).not.toContain(11);
    expect(numbersOf(plan.ranking)).not.toContain(20);
    expect(plan.actions.map((a) => a.number)).not.toContain(11);
    expect(plan.refresh.candidates).not.toContain(20);
    // No PR query ran for a held PR: its node id never appears in a call.
    const reads = world.calls.filter((c) => c.some((a) => a.startsWith("number=")));
    expect(reads.some((c) => c.includes("number=11") || c.includes("number=20"))).toBe(false);
  });

  test("an unreadable PR is BLOCKED and owned by pr-status", async () => {
    const world = makeFleetWorld();
    const broken = world.prs.get(16);
    if (broken === undefined) throw new Error("fixture");
    broken.unreadable = true;
    const plan = await planOf(world);
    const entry = plan.ranking.find((e) => e.number === 16);
    expect(entry?.state).toBe("BLOCKED");
    expect(entry?.owner).toBe("pr-status");
  });
});

describe("stockpile", () => {
  test("counts READY PRs that are not queued, and approved PRs that are behind", async () => {
    const plan = await planOf(makeFleetWorld());
    expect(plan.stockpile).toEqual({ readyNotQueued: [11, 19], approvedBehind: [14, 20] });
  });

  test("a queued PR and an unreviewed PR are not stockpiled", async () => {
    const world = makeFleetWorld();
    world.setPreset(14, "needs-review");
    const plan = await planOf(world);
    expect(plan.stockpile.approvedBehind).toEqual([20]);
    expect(plan.stockpile.readyNotQueued).not.toContain(12);
  });

  test("approval needs a positive signal when the policy asks for no approval", () => {
    const policy = builtinPolicy();
    const snapshot = {
      isDraft: false,
      reviewDecision: null,
      latestOpinionatedReviews: [],
    };
    const verdict = { findings: [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(isApproved(snapshot as never, verdict as never, policy)).toBe(false);
  });
});

describe("queue hygiene", () => {
  test("an UNMERGEABLE entry in the first 5 positions gets a planned dequeue", async () => {
    const plan = await planOf(makeFleetWorld());
    expect(plan.hygiene).toEqual([{ number: 13, position: 2, state: "UNMERGEABLE", planned: true, note: null }]);
    expect(plan.actions.filter((a) => a.kind === "dequeue").map((a) => a.number)).toEqual([13]);
  });

  test("an UNMERGEABLE entry at position 6 is not in the head of the queue", async () => {
    const world = makeFleetWorld();
    const entry = world.prs.get(13);
    if (entry === undefined) throw new Error("fixture");
    entry.queue = { position: 6, state: "UNMERGEABLE" };
    const plan = await planOf(world);
    expect(plan.hygiene).toEqual([]);
    expect(plan.actions.filter((a) => a.kind === "dequeue")).toEqual([]);
  });

  test("position 5 is still in the head of the queue", async () => {
    const world = makeFleetWorld();
    const entry = world.prs.get(13);
    if (entry === undefined) throw new Error("fixture");
    entry.queue = { position: 5, state: "UNMERGEABLE" };
    expect((await planOf(world)).hygiene.map((h) => h.number)).toEqual([13]);
  });

  test("a fork PR in the queue is reported and not planned", async () => {
    const world = makeFleetWorld();
    const entry = world.prs.get(13);
    if (entry === undefined) throw new Error("fixture");
    entry.isCrossRepository = true;
    const plan = await planOf(world);
    expect(plan.hygiene[0]?.planned).toBe(false);
    expect(plan.hygiene[0]?.note).toContain("fork");
    expect(plan.actions.filter((a) => a.kind === "dequeue")).toEqual([]);
  });
});

describe("refresh budget", () => {
  test("a queue below the congestion length uses ci.max_refreshes", async () => {
    const plan = await planOf(makeFleetWorld());
    expect(plan.queue).toMatchObject({ length: 4, congested: false });
    expect(plan.refresh).toEqual({ budget: 2, inFlight: [], candidates: [14, 17, 20], planned: [14, 17], deferred: [20] });
  });

  test("a queue at the congestion length uses ci.max_refreshes_congested", async () => {
    const world = makeFleetWorld();
    world.queueLength = 5;
    const plan = await planOf(world);
    expect(plan.queue).toMatchObject({ length: 5, congested: true });
    expect(plan.refresh).toEqual({ budget: 0, inFlight: [], candidates: [14, 17, 20], planned: [], deferred: [14, 17, 20] });
    expect(plan.actions.filter((a) => a.kind === "refresh")).toEqual([]);
  });

  test("the policy sets both budgets and the congestion length", async () => {
    const world = makeFleetWorld();
    world.policyToml = "[ci]\ncongestion_queue_length = 4\nmax_refreshes = 3\nmax_refreshes_congested = 1";
    const plan = await planOf(world);
    expect(plan.queue.congested).toBe(true);
    expect(plan.refresh.planned).toEqual([14]);
  });

  test("a queue whose length GitHub does not show counts as congested", async () => {
    const world = makeFleetWorld();
    world.queueLength = null;
    const plan = await planOf(world);
    expect(plan.queue).toMatchObject({ length: null, congested: true });
    expect(plan.refresh.budget).toBe(0);
  });

  test("a PR with another blocker is not a refresh candidate, and a draft is not either", async () => {
    const world = makeFleetWorld();
    expect((await planOf(world)).refresh.candidates).not.toContain(15);
    expect((await planOf(world)).refresh.candidates).not.toContain(18);
  });

  test("a conflict plus an unresolved thread is not a refresh candidate: a base merge alone does not unblock it", async () => {
    const world = makeFleetWorld();
    world.addPr(60, { headRef: "feat/conflict-and-thread", preset: "conflict-thread" });
    const plan = await planOf(world);
    const entry = plan.ranking.find((e) => e.number === 60);
    expect(entry?.blockers).toEqual(expect.arrayContaining(["conflict", "threads_unresolved"]));
    expect(plan.refresh.candidates).not.toContain(60);
    expect(plan.refresh.candidates).toContain(17);
  });

  test("a refresh from an earlier pass that still runs CI uses up the budget", async () => {
    const world = makeFleetWorld();
    world.addPr(50, { headRef: "feat/refreshed", preset: "refreshing" });
    const plan = await planOf(world);
    expect(plan.refresh.inFlight).toEqual([50]);
    expect(plan.refresh).toMatchObject({ budget: 2, planned: [14], deferred: [17, 20] });
  });

  test("two refreshes in CI leave no room, and a PR whose CI runs for another reason is not counted", async () => {
    const world = makeFleetWorld();
    world.addPr(50, { headRef: "feat/refreshed-a", preset: "refreshing" });
    world.addPr(51, { headRef: "feat/refreshed-b", preset: "refreshing" });
    world.addPr(52, { headRef: "feat/plain-ci", preset: "ci-running" });
    const plan = await planOf(world);
    expect(plan.refresh.inFlight).toEqual([50, 51]);
    expect(plan.refresh.planned).toEqual([]);
    expect(plan.actions.filter((a) => a.kind === "refresh")).toEqual([]);
  });

  test("the head commit decides what an in-flight refresh is", () => {
    const base = green();
    const merge = { ...base.commits[0]!, parents: [OLD, BASE], message: "Merge branch 'main' into topic\n\nSigned-off-by: A <a@example.com>" };
    const running = [check("Required", { status: "in_progress", conclusion: null })];
    expect(isRefreshing({ ...base, commits: [merge], checks: running })).toBe(true);
    expect(isRefreshing({ ...base, commits: [merge] })).toBe(false); // CI finished
    const fresh = { ...base.commits[0]!, message: "Start a fresh CI run\n\nSigned-off-by: A <a@example.com>" };
    expect(isRefreshing({ ...base, commits: [fresh], checks: running })).toBe(true);
    expect(isRefreshing({ ...base, commits: [base.commits[0]!], checks: running })).toBe(false); // an ordinary commit
    expect(isRefreshing({ ...base, commits: [merge], checks: running, state: "CLOSED" })).toBe(false);
    expect(isRefreshing({ ...base, commits: [], checks: running })).toBe(false);
  });

  test("refreshBudget and queueLength are pure", () => {
    const policy = policyFromText("schema = 1\n[ci]\ncongestion_queue_length = 3\nmax_refreshes = 7\nmax_refreshes_congested = 1");
    expect(refreshBudget(policy, 2)).toEqual({ budget: 7, congested: false });
    expect(refreshBudget(policy, 3)).toEqual({ budget: 1, congested: true });
    expect(refreshBudget(policy, null)).toEqual({ budget: 1, congested: true });
    expect(queueLength([], "main")).toBe(0);
  });

  test("every planned action can run: no action carries a pending note", async () => {
    const plan = await planOf(makeFleetWorld());
    expect(plan.actions.filter((a) => a.kind === "refresh").map((a) => a.number)).toEqual([14, 17]);
    expect(plan.actions.every((a) => !("pending" in a))).toBe(true);
    expect(JSON.stringify(plan)).not.toContain("not available");
  });
});

describe("freeze", () => {
  test("policy fleet.freeze plans nothing that pushes, enqueues, or dequeues", async () => {
    const world = makeFleetWorld();
    world.policyToml = "[fleet]\nfreeze = true";
    const plan = await planOf(world);
    expect(plan.frozen).toBe("policy");
    expect(plan.actions).toEqual([]);
    expect(plan.hygiene[0]?.planned).toBe(false);
    expect(plan.refresh.planned).toEqual([]);
    expect(plan.ranking).toHaveLength(10);
    expect(plan.next).toContain("Freeze is on");
  });

  test("PR_FLEET_FREEZE=1 freezes without a policy key", async () => {
    const plan = await planOf(makeFleetWorld(), { env: { PR_FLEET_FREEZE: "1" } });
    expect(plan.frozen).toBe("env");
    expect(plan.actions).toEqual([]);
  });

  test("any other value of PR_FLEET_FREEZE does not freeze", async () => {
    for (const value of ["0", "", "true", "yes"]) {
      expect((await planOf(makeFleetWorld(), { env: { PR_FLEET_FREEZE: value } })).frozen).toBeNull();
    }
  });
});

describe("policy source", () => {
  test("the fleet policy is read at the default branch commit, from the base branch", async () => {
    const world = makeFleetWorld();
    world.policyToml = "[fleet]\nhold = [11]";
    await planOf(world);
    const reads = world.calls.filter((c) => c.some((a) => a.includes("contents/.config/pr-policy.toml")));
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.every((c) => c.some((a) => a.endsWith("?ref=" + "f".repeat(40))))).toBe(true);
  });

  test("a PR on another base branch is judged with the default-branch policy", async () => {
    const world = makeFleetWorld();
    world.policyToml = "[fleet]\nhold = [20]";
    world.addPr(30, { headRef: "feat/stacked-work", baseRef: "release/1" });
    const plan = await planOf(world);
    expect(plan.ranking.find((e) => e.number === 30)?.baseRef).toBe("release/1");
    const refs = world.calls.flatMap((c) => c.filter((a) => a.includes("pr-policy.toml")));
    expect(refs.every((a) => a.endsWith("?ref=" + "f".repeat(40)))).toBe(true);
    expect(plan.actions.map((a) => a.number)).not.toContain(30);
  });

  test("a local policy file marks the plan advisory", async () => {
    const plan = await planOf(makeFleetWorld(), { localPolicy: policyWith("[fleet]\nhold = [11]") });
    expect(plan.advisory).toBe(true);
    expect(plan.policySource).toBe("local");
    expect(plan.held).toEqual([11]);
  });

  test("a policy that GitHub serves with a typo stops the plan with exit 2", async () => {
    const world = makeFleetWorld();
    world.policyToml = "[fleet]\nholds = [1]";
    const run = await runFleet(world, ["plan"]);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("invalid policy");
  });
});

describe("orphan runs", () => {
  test("lists in-progress runs on branches with no open PR, and never cancels", async () => {
    const world = makeFleetWorld();
    const plan = await planOf(world);
    expect(plan.orphanRuns.runs.map((r) => r.id)).toEqual([9002, 9005]);
    expect(plan.orphanRuns.error).toBeNull();
    expect(world.calls.some((c) => c.includes("cancel"))).toBe(false);
    expect(world.mutations).toEqual([]);
  });

  test("runs on open PR branches, the default branch, and the merge queue are not orphans", async () => {
    const plan = await planOf(makeFleetWorld());
    const ids = plan.orphanRuns.runs.map((r) => r.id);
    for (const kept of [9001, 9003, 9004]) {
      expect(ids).not.toContain(kept);
    }
  });

  test("a held PR still owns its branch", async () => {
    const world = makeFleetWorld();
    world.policyToml = "[fleet]\nhold = [11]";
    expect((await planOf(world)).orphanRuns.runs.map((r) => r.id)).toEqual([9002, 9005]);
  });

  test("queued, waiting, and pending runs count too, one list call for each active status", async () => {
    const world = makeFleetWorld();
    const run = (id: number, branch: string) => ({ databaseId: id, headBranch: branch, workflowName: "CI", event: "push" });
    world.runsByStatus = {
      in_progress: [run(1, "old/a")],
      queued: [run(2, "old/b"), run(1, "old/a"), run(3, "feat/alpha")],
      waiting: [run(4, "old/c")],
      pending: [run(5, "old/d")],
    };
    const plan = await planOf(world);
    expect(plan.orphanRuns.runs.map((r) => r.id)).toEqual([1, 2, 4, 5]);
    const statuses = world.calls.filter((c) => c[0] === "run").map((c) => c[c.indexOf("--status") + 1]);
    expect(statuses).toEqual(["in_progress", "queued", "waiting", "pending"]);
  });

  test("a failed run list is reported and does not stop the plan", async () => {
    const world = makeFleetWorld();
    world.runs = "fail";
    const plan = await planOf(world);
    expect(plan.orphanRuns.error).toContain("could not be read");
    expect(plan.ranking).toHaveLength(10);
  });

  test("a list at the limit may be cut", async () => {
    const world = makeFleetWorld();
    world.runs = Array.from({ length: 100 }, (_, i) => ({ databaseId: i + 1, headBranch: `old/${i}`, workflowName: "CI", event: "push" }));
    const plan = await planOf(world);
    expect(plan.orphanRuns.truncated).toBe(true);
    expect(plan.orphanRuns.runs).toHaveLength(100);
  });
});

describe("analyze with no PR", () => {
  test("an empty repository gives an empty plan and says so", () => {
    const policy = builtinPolicy();
    const plan = analyze({
      repo: "example-org/example-repo" as never,
      defaultBranch: "main",
      fleet: { policy, source: "default", sha: "f".repeat(40) as never },
      advisory: false,
      frozen: null,
      open: 0,
      held: [],
      reads: [] satisfies readonly Read[],
      orphanRuns: { runs: [], truncated: false, error: null },
    });
    expect(plan.actions).toEqual([]);
    expect(plan.next).toBe("None. No open PR was read.");
  });
});
