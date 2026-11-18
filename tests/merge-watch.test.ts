import { afterEach, describe, expect, test } from "bun:test";
import { removeBodyFiles } from "../lib/body-file.ts";
import { EXIT } from "../lib/merge/types.ts";
import { watchStep } from "../lib/merge/watch.ts";
import { thread } from "./helpers/fake-gh.ts";
import { graphqlError, makeWorld, type World } from "./helpers/merge-world.ts";
import { HEAD } from "./helpers/status.ts";

afterEach(() => removeBodyFiles());

const options = { intervalSeconds: 180, timeoutSeconds: 5400 };
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

  test("a failed read that recovers does not stop the watch", async () => {
    const world = queued();
    world.script = (gather, w) => {
      if (gather === 2) w.failReads = 2;
      if (gather === 5) w.prState = "MERGED";
    };
    const outcome = await watchStep(world.context(), options);
    expect(outcome.outcome).toBe("merged");
  });

  test("without --confirm it reads once and prints the plan", async () => {
    const world = queued();
    const outcome = await watchStep(world.context({ confirmed: false }), options);
    expect(outcome.exit).toBe(EXIT.refused);
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
