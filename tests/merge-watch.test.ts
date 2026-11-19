import { afterEach, describe, expect, test } from "bun:test";
import { removeBodyFiles } from "../lib/body-file.ts";
import { EXIT } from "../lib/merge/types.ts";
import { watchStep, type WatchOptions } from "../lib/merge/watch.ts";
import { thread } from "./helpers/fake-gh.ts";
import { graphqlError, makeWorld, removeWorlds, type World } from "./helpers/merge-world.ts";
import { HEAD, sha } from "./helpers/status.ts";

afterEach(() => {
  removeBodyFiles();
  removeWorlds();
});

const options: WatchOptions = { intervalSeconds: 180, timeoutSeconds: 5400 };
const openThread = { reviewThreads: { totalCount: 1, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [thread(1)] } };
const changesNeeded = {
  latestOpinionatedReviews: {
    totalCount: 1,
    nodes: [{ author: { login: "reviewer-a" }, authorAssociation: "MEMBER", state: "CHANGES_REQUESTED", commit: { oid: HEAD } }],
  },
};

function queued(patch: Partial<Pick<World, "policyToml">> = {}): World {
  const world = makeWorld(patch);
  world.queue({});
  return world;
}

describe("watch", () => {
  test("reports the merge commit when the PR merges", async () => {
    const world = queued();
    world.script = (gather, w) => {
      if (gather === 3) w.prState = "MERGED";
    };
    const outcome = await watchStep(world.context(), options);
    expect(outcome.exit).toBe(EXIT.done);
    expect(outcome.outcome).toBe("merged");
    expect(outcome.mergeCommit).toBe(world.mergeCommit);
    expect(world.sleeps).toEqual([180_000, 180_000]);
    expect(world.mutations).toEqual([]);
    expect(world.lines.join("\n")).toContain(`merged as ${world.mergeCommit}`);
  });

  test("prints a line only when the queue view changes", async () => {
    const world = queued();
    world.script = (gather, w) => {
      if (gather === 4) w.prState = "MERGED";
    };
    await watchStep(world.context(), options);
    expect(world.lines.filter((l) => l.startsWith("queued:"))).toHaveLength(1);
  });

  test("dequeues and reports when a review asks for changes while queued", async () => {
    const world = queued();
    world.script = (gather, w) => {
      if (gather === 2) w.pr = { ...w.pr, ...changesNeeded };
    };
    const outcome = await watchStep(world.context(), options);
    expect(outcome.exit).toBe(EXIT.blocked);
    expect(outcome.outcome).toBe("dequeued");
    expect(world.mutations).toEqual([{ kind: "dequeuePullRequest", entryId: "MQE_1" }]);
    expect(world.comments).toHaveLength(1);
    expect(world.comments[0]).toContain("Reason: a review asks for changes.");
    expect(world.comments[0]).toContain("review_changes_requested");
    expect(world.lines.join("\n")).toContain("a review asks for changes while the PR is queued");
  });

  test("does not dequeue for other blockers; it reports them", async () => {
    const world = queued();
    world.script = (gather, w) => {
      if (gather === 2) w.pr = { ...w.pr, ...openThread };
      if (gather === 4) w.prState = "MERGED";
    };
    const outcome = await watchStep(world.context(), options);
    expect(outcome.outcome).toBe("merged");
    expect(world.mutations).toEqual([]);
    expect(world.lines.join("\n")).toContain("open blockers: threads_unresolved");
  });

  test("an UNMERGEABLE entry stops the watch and names the dequeue", async () => {
    const world = makeWorld();
    world.queue({ state: "UNMERGEABLE" });
    const outcome = await watchStep(world.context(), options);
    expect(outcome.exit).toBe(EXIT.blocked);
    expect(outcome.next).toContain("dequeue 7 --confirm 7");
    expect(world.mutations).toEqual([]);
  });

  test("an entry that leaves the queue gives the removal reason and the blockers", async () => {
    const world = queued();
    world.script = (gather, w) => {
      if (gather === 2) {
        w.queue(null);
        w.removed("merge_conflict");
        w.pr = { ...w.pr, mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" };
      }
    };
    const outcome = await watchStep(world.context(), options);
    expect(outcome.exit).toBe(EXIT.blocked);
    expect(outcome.outcome).toBe("ejected");
    const text = world.lines.join("\n");
    expect(text).toContain("removal reason: merge_conflict");
    expect(text).toContain("conflict");
    expect(text).toContain("queue_ejected");
    expect(world.sleeps).toEqual([180_000, 5000, 5000, 5000]);
    expect(world.mutations).toEqual([]);
  });

  test("an open PR right after the queue entry vanishes is read again before the verdict", async () => {
    const world = queued();
    world.script = (gather, w) => {
      if (gather === 2) w.queue(null);
      if (gather === 3) w.prState = "MERGED";
    };
    const outcome = await watchStep(world.context(), options);
    expect(outcome.outcome).toBe("merged");
    expect(world.sleeps).toEqual([180_000, 5000]);
  });

  test("a PR removed from the queue before the watch started is reported", async () => {
    const world = makeWorld();
    world.removed("failed_checks");
    const outcome = await watchStep(world.context(), options);
    expect(outcome.outcome).toBe("ejected");
    expect(world.lines.join("\n")).toContain("removal reason: failed_checks");
  });

  test("a PR that was never queued has nothing to watch (exit 3)", async () => {
    const world = makeWorld();
    const outcome = await watchStep(world.context(), options);
    expect(outcome.exit).toBe(EXIT.refused);
    expect(world.sleeps).toEqual([]);
    expect(world.lines.join("\n")).toContain("nothing to watch");
  });

  test("the interval comes from merge.watch_interval_seconds, and --interval overrides it", async () => {
    const policy = makeWorld({ policyToml: "[merge]\nwatch_interval_seconds = 60\n" });
    policy.queue({});
    await watchStep(policy.context(), { intervalSeconds: null, timeoutSeconds: 150 });
    expect(policy.sleeps).toEqual([60_000, 60_000, 30_000]);
    const flag = makeWorld({ policyToml: "[merge]\nwatch_interval_seconds = 60\n" });
    flag.queue({});
    await watchStep(flag.context(), { intervalSeconds: 100, timeoutSeconds: 250 });
    expect(flag.sleeps).toEqual([100_000, 100_000, 50_000]);
    const fallback = queued();
    await watchStep(fallback.context(), { intervalSeconds: null, timeoutSeconds: 400 });
    expect(fallback.sleeps).toEqual([180_000, 180_000, 40_000]);
  });

  test("the settle reads count inside the deadline: no wait runs past it", async () => {
    const world = queued();
    world.script = (gather, w) => {
      if (gather === 2) w.queue(null);
    };
    const outcome = await watchStep(world.context(), { intervalSeconds: 5, timeoutSeconds: 8 });
    expect(outcome.exit).toBe(EXIT.waiting);
    expect(outcome.outcome).toBe("timeout");
    expect(world.sleeps).toEqual([5000, 3000]);
    expect(world.sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(8000);
    expect(world.lines.join("\n")).toContain("neither seen merged nor judged");
    expect(world.mutations).toEqual([]);
  });

  test("a merge that shows up in the last settle read is still reported as merged", async () => {
    const world = queued();
    world.script = (gather, w) => {
      if (gather === 2) w.queue(null);
      if (gather === 3) w.prState = "MERGED";
    };
    const outcome = await watchStep(world.context(), { intervalSeconds: 5, timeoutSeconds: 8 });
    expect(outcome.outcome).toBe("merged");
    expect(world.sleeps).toEqual([5000, 3000]);
  });

  test("the settle reads stay bounded when the deadline is far away", async () => {
    const world = queued();
    world.script = (gather, w) => {
      if (gather === 2) w.queue(null);
    };
    const outcome = await watchStep(world.context(), { intervalSeconds: 5, timeoutSeconds: 600 });
    expect(outcome.outcome).toBe("ejected");
    expect(world.sleeps).toEqual([5000, 5000, 5000, 5000]);
  });

  test("a closed PR is blocked", async () => {
    const world = queued();
    world.script = (gather, w) => {
      if (gather === 2) w.prState = "CLOSED";
    };
    const outcome = await watchStep(world.context(), options);
    expect(outcome.exit).toBe(EXIT.blocked);
    expect(outcome.outcome).toBe("closed");
  });

  test("the time bound ends the watch with exit 10 and no write", async () => {
    const world = queued();
    const outcome = await watchStep(world.context(), { intervalSeconds: 180, timeoutSeconds: 600 });
    expect(outcome.exit).toBe(EXIT.waiting);
    expect(outcome.outcome).toBe("timeout");
    expect(world.gathers).toBe(5);
    expect(world.sleeps).toEqual([180_000, 180_000, 180_000, 60_000]);
    expect(world.mutations).toEqual([]);
  });

  test("three failed reads in a row stop the watch", async () => {
    const world = queued();
    world.script = (gather, w) => {
      if (gather === 2) w.failReads = 3;
    };
    const outcome = await watchStep(world.context(), options);
    expect(outcome.exit).toBe(EXIT.blocked);
    expect(world.gathers).toBe(4);
    expect(world.mutations).toEqual([]);
  });

  test("one 502 on the policy read after the base moves does not end the watch", async () => {
    const world = queued();
    world.script = (gather, w) => {
      if (gather === 2) {
        w.defaultSha = sha("d");
        w.policyFails = 1;
      }
      if (gather === 4) w.prState = "MERGED";
    };
    const outcome = await watchStep(world.context(), options);
    expect(outcome.outcome).toBe("merged");
    expect(outcome.exit).toBe(EXIT.done);
    expect(world.policyFails).toBe(0);
    expect(world.mutations).toEqual([]);
  });

  test("three policy read failures in a row stop the watch with exit 20, not exit 2", async () => {
    const world = queued();
    world.script = (gather, w) => {
      if (gather === 2) {
        w.defaultSha = sha("d");
        w.policyFails = 3;
      }
    };
    const outcome = await watchStep(world.context(), options);
    expect(outcome.exit).toBe(EXIT.blocked);
    expect(outcome.outcome).toBe("blocked");
    expect(world.lines.join("\n")).toContain("could not be read");
  });

  test("a policy file that is read and invalid still ends the watch with exit 2", async () => {
    const world = queued();
    world.script = (gather, w) => {
      if (gather === 2) {
        w.defaultSha = sha("d");
        w.policyToml = "schema = 9\n";
      }
    };
    const outcome = await watchStep(world.context(), options);
    expect(outcome.exit).toBe(EXIT.usage);
    expect(outcome.outcome).toBe("policy_error");
  });

  test("a failed read that recovers does not stop the watch", async () => {
    const world = queued();
    world.script = (gather, w) => {
      if (gather === 2) w.failReads = 2;
      if (gather === 5) w.prState = "MERGED";
    };
    const outcome = await watchStep(world.context(), options);
    expect(outcome.outcome).toBe("merged");
  });

  test("the plan names the interval of the policy", async () => {
    const world = makeWorld({ policyToml: "[merge]\nwatch_interval_seconds = 45\n" });
    world.queue({});
    await watchStep(world.context({ confirmed: false }), { intervalSeconds: null, timeoutSeconds: 600 });
    expect(world.lines.join("\n")).toContain("poll every 45s");
  });

  test("without --confirm it reads once and prints the plan", async () => {
    const world = queued();
    const outcome = await watchStep(world.context({ confirmed: false }), options);
    expect(outcome.exit).toBe(EXIT.plan);
    expect(outcome.outcome).toBe("plan");
    expect(world.gathers).toBe(1);
    expect(world.sleeps).toEqual([]);
    expect(world.mutations).toEqual([]);
  });

  test("a refused dequeue inside the watch is reported as blocked", async () => {
    const world = queued();
    world.script = (gather, w) => {
      if (gather === 2) w.pr = { ...w.pr, ...changesNeeded };
    };
    world.mutationReply.dequeuePullRequest = () => graphqlError("Not allowed");
    const outcome = await watchStep(world.context(), options);
    expect(outcome.exit).toBe(EXIT.blocked);
    expect(outcome.outcome).toBe("blocked");
    expect(world.comments).toEqual([]);
  });

  test("a fork PR is refused before any poll", async () => {
    const world = queued();
    world.pr = { ...world.pr, isCrossRepository: true, headRepository: { nameWithOwner: "fork-user/example-repo" } };
    const outcome = await watchStep(world.context(), options);
    expect(outcome.exit).toBe(EXIT.refused);
    expect(world.sleeps).toEqual([]);
  });
});
