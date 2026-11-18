// `apply` against a stateful fake GitHub. The fake `gh` guards every read with the
// real allow-list. Mutations go through a recording runner that changes the world.

import { describe, expect, test } from "bun:test";
import { ghMutationArgv } from "../lib/safety.ts";
import { applyDecisions, type ApplyConfig, type ApplyResult } from "../lib/threads/apply.ts";
import { commitUrl } from "../lib/threads/decisions.ts";
import type { DecisionFile } from "../lib/threads/types.ts";
import { sha } from "./helpers/status.ts";
import { AGENT, FIX_COMMIT, PR_AUTHOR, REPO, World, type ThreadSpec } from "./helpers/threads-world.ts";
import { POLICY_TOML } from "./helpers/threads-world.ts";

const noSleep = async (): Promise<void> => undefined;

const SPECS: readonly ThreadSpec[] = [
  { id: "T-fix", comments: [{ author: "review-bot", body: "P1: this drops data" }] },
  { id: "T-defer", comments: [{ author: "review-bot", body: "P3: naming" }] },
  { id: "T-question", comments: [{ author: "reviewer-1", body: "Why not use a map?" }] },
  { id: "T-other", comments: [{ author: "reviewer-2", body: "Please add a doc line." }] },
];

function world(specs: readonly ThreadSpec[] = SPECS): World {
  const w = new World(specs);
  w.commits = [FIX_COMMIT];
  return w;
}

function config(w: World, patch: Partial<ApplyConfig> = {}): ApplyConfig {
  return { cwd: "/", runGh: w.gh().run, mutate: w.mutate, sleep: noSleep, ...patch };
}

function file(...decisions: DecisionFile["decisions"]): DecisionFile {
  return { expectHead: null, decisions };
}

const ALL = file(
  { id: "T-fix", action: "fix", reply: "Guarded the write.", fixCommit: FIX_COMMIT },
  { id: "T-defer", action: "defer", reply: "", fixCommit: null },
  { id: "T-question", action: "reply-only", reply: "A map loses the order.", fixCommit: null },
  { id: "T-other", action: "fix", reply: "Added the line.", fixCommit: FIX_COMMIT },
);

function written(result: ApplyResult) {
  if (result.kind !== "written") {
    throw new Error(`expected a write, got ${result.kind}: ${JSON.stringify(result)}`);
  }
  return result;
}

describe("applyDecisions", () => {
  test("replies, then resolves, in order; leaves a person's question open", async () => {
    const w = world();
    const result = written(await applyDecisions(REPO, 7, ALL, config(w)));
    expect(result.aborted).toBeNull();
    expect(w.ops.map((o) => `${o.kind}:${"threadId" in o ? o.threadId : "?"}`)).toEqual([
      "addPullRequestReviewThreadReply:T-fix",
      "resolveReviewThread:T-fix",
      "addPullRequestReviewThreadReply:T-defer",
      "resolveReviewThread:T-defer",
      "addPullRequestReviewThreadReply:T-question",
      "addPullRequestReviewThreadReply:T-other",
      "resolveReviewThread:T-other",
    ]);
    expect(w.threads.map((t) => [t.id, t.resolved])).toEqual([
      ["T-fix", true],
      ["T-defer", true],
      ["T-question", false],
      ["T-other", true],
    ]);
  });

  test("posts the exact reply texts", async () => {
    const w = world();
    await applyDecisions(REPO, 7, ALL, config(w));
    const bodies = new Map(w.threads.map((t) => [t.id, t.comments[t.comments.length - 1]?.body]));
    expect(bodies.get("T-fix")).toBe(`Guarded the write.\n\nFixed in ${commitUrl(REPO, FIX_COMMIT)}`);
    expect(bodies.get("T-defer")).toBe("Deferred under the repository's review policy: not blocking for this change.");
    expect(bodies.get("T-question")).toBe("A map loses the order.");
    expect(w.threads.find((t) => t.id === "T-fix")?.comments.at(-1)?.author).toBe(AGENT);
  });

  test("reports what remains: the person's question waits for the person", async () => {
    const w = world();
    const result = written(await applyDecisions(REPO, 7, ALL, config(w)));
    expect(result.remaining?.map((t) => [t.detail.id, t.class, t.awaiting])).toEqual([["T-question", "human-question", "human"]]);
  });

  test("uses only the reply and resolve mutations, and every one builds a fixed argv", async () => {
    const w = world();
    await applyDecisions(REPO, 7, ALL, config(w));
    expect(w.ops.length).toBeGreaterThan(0);
    for (const op of w.ops) {
      expect(["addPullRequestReviewThreadReply", "resolveReviewThread"]).toContain(op.kind);
      const argv = ghMutationArgv(op);
      expect(argv.slice(0, 2)).toEqual(["api", "graphql"]);
      expect(argv.some((a) => /^query=mutation/.test(a))).toBe(true);
    }
  });

  test("a refused decision writes nothing at all", async () => {
    const w = world();
    const result = await applyDecisions(
      REPO,
      7,
      file({ id: "T-defer", action: "defer", reply: "", fixCommit: null }, { id: "T-fix", action: "defer", reply: "", fixCommit: null }),
      config(w),
    );
    expect(result.kind).toBe("refused");
    expect(w.ops).toEqual([]);
  });

  test("refuses to resolve a person's open question", async () => {
    const w = world();
    const result = await applyDecisions(REPO, 7, file({ id: "T-question", action: "defer", reply: "Later.", fixCommit: null }), config(w));
    expect(result.kind).toBe("refused");
    expect(w.ops).toEqual([]);
    expect(w.threads.find((t) => t.id === "T-question")?.resolved).toBe(false);
  });

  test("refuses a fix commit that the PR does not hold", async () => {
    const w = world();
    const result = await applyDecisions(REPO, 7, file({ id: "T-fix", action: "fix", reply: "", fixCommit: sha("7") }), config(w));
    expect(result.kind === "refused" && result.reasons.join(" ")).toContain("not a commit of this PR");
    expect(w.ops).toEqual([]);
  });

  test("refuses when the head is not the one the decisions expect", async () => {
    const w = world();
    const result = await applyDecisions(REPO, 7, { expectHead: sha("9"), decisions: ALL.decisions }, config(w));
    expect(result.kind === "refused" && result.reasons.join(" ")).toContain("expect");
    expect(w.ops).toEqual([]);
  });

  test("refuses on a closed PR", async () => {
    const w = world();
    w.state = "CLOSED";
    const result = await applyDecisions(REPO, 7, ALL, config(w));
    expect(result.kind === "refused" && result.reasons.join(" ")).toContain("not open");
    expect(w.ops).toEqual([]);
  });

  test("refuses when the two thread reads disagree", async () => {
    const w = world();
    const fake = w.gh({
      threadDetails: () => ({
        data: { node: { reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } },
      }),
    });
    const result = await applyDecisions(REPO, 7, ALL, config(w, { runGh: fake.run }));
    expect(result.kind).toBe("refused");
    expect(w.ops).toEqual([]);
  });

  test("stops before the next write when the head moves", async () => {
    const w = world();
    w.afterMutation = (self) => {
      self.head = sha("f");
    };
    const result = written(await applyDecisions(REPO, 7, ALL, config(w)));
    expect(w.ops).toHaveLength(1);
    expect(result.aborted).toContain("the PR changed");
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]?.note).toBe("replied, not resolved");
  });

  test("stops at the first failed write", async () => {
    const w = world();
    w.failMutation = { at: 1, stderr: "gh: server error" };
    const result = written(await applyDecisions(REPO, 7, ALL, config(w)));
    expect(w.ops).toHaveLength(1);
    expect(result.aborted).toContain("reply failed");
    expect(w.threads.every((t) => !t.resolved)).toBe(true);
  });

  test("a run after a failed resolve posts no second reply", async () => {
    const w = world();
    w.failMutation = { at: 2, stderr: "gh: server error" };
    const first = written(await applyDecisions(REPO, 7, ALL, config(w)));
    expect(first.aborted).toContain("resolve failed");
    const before = w.threads.find((t) => t.id === "T-fix")?.comments.length;
    w.failMutation = null;
    const second = written(await applyDecisions(REPO, 7, ALL, config(w)));
    expect(second.aborted).toBeNull();
    expect(w.threads.find((t) => t.id === "T-fix")?.comments.length).toBe(before);
    expect(w.threads.find((t) => t.id === "T-fix")?.resolved).toBe(true);
  });

  test("a second run after success writes nothing", async () => {
    const w = world();
    await applyDecisions(REPO, 7, ALL, config(w));
    const count = w.ops.length;
    const again = written(await applyDecisions(REPO, 7, ALL, config(w)));
    expect(again.aborted).toBeNull();
    expect(w.ops).toHaveLength(count);
  });

  test("does not accept a GitHub reply that fails to confirm the resolve", async () => {
    const w = world();
    const mutate = async (op: Parameters<World["mutate"]>[0]) => {
      const r = await w.mutate(op);
      return op.kind === "resolveReviewThread" ? { ...r, stdout: JSON.stringify({ data: { resolveReviewThread: { thread: { id: op.threadId, isResolved: false } } } }) } : r;
    };
    const result = written(await applyDecisions(REPO, 7, file({ id: "T-defer", action: "defer", reply: "", fixCommit: null }), config(w, { mutate })));
    expect(result.aborted).toContain("did not confirm");
  });

  test("an invalid policy on the base branch stops the run", async () => {
    const w = world();
    w.policy = "schema = 1\n[threads]\nbogus = 1\n";
    const result = await applyDecisions(REPO, 7, ALL, config(w));
    expect(result.kind).toBe("policy");
    expect(w.ops).toEqual([]);
  });

  test("the policy is read from the base branch only", async () => {
    const w = world();
    const fake = w.gh();
    await applyDecisions(REPO, 7, ALL, config(w, { runGh: fake.run }));
    const policyCalls = fake.calls.filter((a) => a.some((x) => x.includes(".config/pr-policy.toml")));
    expect(policyCalls.length).toBeGreaterThan(0);
    for (const call of policyCalls) {
      expect(call.join(" ")).toContain(`ref=${sha("c")}`);
    }
    expect(POLICY_TOML).toContain("review-bot");
  });

  test("the PR author's own comment is not a person's question", async () => {
    const w = world([{ id: "T-self", comments: [{ author: "review-bot", body: "P3: nit" }, { author: PR_AUTHOR, body: "Is this ok?" }] }]);
    const result = written(await applyDecisions(REPO, 7, file({ id: "T-self", action: "defer", reply: "", fixCommit: null }), config(w)));
    expect(result.remaining).toEqual([]);
  });
});
