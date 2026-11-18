// `apply` against a stateful fake GitHub. The fake `gh` guards every read with the
// real allow-list. Mutations go through a recording runner that changes the world.

import { describe, expect, test } from "bun:test";
import { ghMutationArgv, type GhMutation } from "../lib/safety.ts";
import { applyDecisions, type ApplyConfig, type ApplyResult } from "../lib/threads/apply.ts";
import { commitUrl, replyMarker } from "../lib/threads/decisions.ts";
import { exitForApply, renderApplyText } from "../lib/threads/render.ts";
import { readThreads } from "../lib/threads/read.ts";
import type { Decision, DecisionFile } from "../lib/threads/types.ts";
import { sha } from "./helpers/status.ts";
import { AGENT, FIX_COMMIT, REPO, World, type ThreadSpec } from "./helpers/threads-world.ts";

const noSleep = async (): Promise<void> => undefined;

const SPECS: readonly ThreadSpec[] = [
  { id: "T-fix", comments: [{ author: "review-bot", body: "P1: this drops data" }] },
  { id: "T-defer", comments: [{ author: "review-bot", body: "P3: naming" }] },
  { id: "T-question", comments: [{ author: "reviewer-1", body: "Why not use a map?" }] },
  { id: "T-other", comments: [{ author: "reviewer-2", body: "Please add a doc line." }] },
  { id: "T-praise", comments: [{ author: "reviewer-3", body: "Nice cleanup." }] },
];

function world(specs: readonly ThreadSpec[] = SPECS): World {
  const w = new World(specs);
  w.commits = [FIX_COMMIT];
  return w;
}

function config(w: World, patch: Partial<ApplyConfig> = {}): ApplyConfig {
  return { cwd: "/", runGh: w.gh().run, mutate: w.mutate, sleep: noSleep, ...patch };
}

function d(id: string, action: Decision["action"], reply = "", fixCommit: Decision["fixCommit"] = null, confirmedNoOpenQuestion = false): Decision {
  return { id, action, reply, fixCommit, confirmedNoOpenQuestion };
}

function file(...decisions: Decision[]): DecisionFile {
  return { expectHead: null, decisions };
}

const ALL = file(
  d("T-fix", "fix", "Guarded the write.", FIX_COMMIT),
  d("T-defer", "defer"),
  d("T-question", "reply-only", "A map loses the order."),
  d("T-other", "fix", "Added the line.", FIX_COMMIT, true),
  d("T-praise", "reply-resolve", "Thanks.", null, true),
);

function written(result: ApplyResult) {
  if (result.kind !== "written") {
    throw new Error(`expected a write, got ${result.kind}: ${JSON.stringify(result)}`);
  }
  return result;
}

function refused(result: ApplyResult): string {
  if (result.kind !== "refused") {
    throw new Error(`expected a refusal, got ${result.kind}`);
  }
  return result.reasons.join(" | ");
}

function opNames(w: World): string[] {
  return w.ops.map((o) => `${o.kind}:${"threadId" in o ? o.threadId : "?"}`);
}

function lastBody(w: World, id: string): string | undefined {
  return w.threads.find((t) => t.id === id)?.comments.at(-1)?.body;
}

describe("applyDecisions", () => {
  test("replies, then resolves, in order; leaves a person's question open", async () => {
    const w = world();
    const result = written(await applyDecisions(REPO, 7, ALL, config(w)));
    expect(result.aborted).toBeNull();
    expect(opNames(w)).toEqual([
      "addPullRequestReviewThreadReply:T-fix",
      "resolveReviewThread:T-fix",
      "addPullRequestReviewThreadReply:T-defer",
      "resolveReviewThread:T-defer",
      "addPullRequestReviewThreadReply:T-question",
      "addPullRequestReviewThreadReply:T-other",
      "resolveReviewThread:T-other",
      "addPullRequestReviewThreadReply:T-praise",
      "resolveReviewThread:T-praise",
    ]);
    expect(w.threads.map((t) => [t.id, t.resolved])).toEqual([
      ["T-fix", true],
      ["T-defer", true],
      ["T-question", false],
      ["T-other", true],
      ["T-praise", true],
    ]);
  });

  test("posts the exact reply texts, each with its hidden marker", async () => {
    const w = world();
    await applyDecisions(REPO, 7, ALL, config(w));
    const fix = `Guarded the write.\n\nFixed in ${commitUrl(REPO, FIX_COMMIT)}`;
    expect(lastBody(w, "T-fix")).toBe(`${fix}\n\n${replyMarker("T-fix", fix)}`);
    const deferText = "Deferred under the repository's review policy: not blocking for this change.";
    expect(lastBody(w, "T-defer")).toBe(`${deferText}\n\n${replyMarker("T-defer", deferText)}`);
    expect(lastBody(w, "T-question")).toContain("A map loses the order.");
    expect(w.threads.find((t) => t.id === "T-fix")?.comments.at(-1)?.author).toBe(AGENT);
  });

  test("reports what remains: the person's question waits for the person", async () => {
    const w = world();
    const result = written(await applyDecisions(REPO, 7, ALL, config(w)));
    expect(result.remaining?.map((t) => [t.detail.id, t.class, t.awaiting])).toEqual([["T-question", "human-question", "human"]]);
    expect(exitForApply(result)).toBe(10);
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

  test("reply-only on a human-other thread replies and never resolves", async () => {
    const w = world();
    const result = written(await applyDecisions(REPO, 7, file(d("T-other", "reply-only", "Will do in a follow-up.")), config(w)));
    expect(opNames(w)).toEqual(["addPullRequestReviewThreadReply:T-other"]);
    expect(w.threads.find((t) => t.id === "T-other")?.resolved).toBe(false);
    expect(result.outcomes[0]?.note).toContain("left open");
  });

  test("reply-resolve ends the deadlock of a thread that asks nothing", async () => {
    const w = world();
    written(await applyDecisions(REPO, 7, file(d("T-praise", "reply-resolve", "Thanks.", null, true)), config(w)));
    expect(w.threads.find((t) => t.id === "T-praise")?.resolved).toBe(true);
  });

  test("refuses to resolve a person's thread without the confirmation, and writes nothing", async () => {
    const w = world();
    const result = await applyDecisions(REPO, 7, file(d("T-fix", "fix", "", FIX_COMMIT), d("T-other", "fix", "Done.", FIX_COMMIT)), config(w));
    expect(refused(result)).toContain("confirmedNoOpenQuestion");
    expect(w.ops).toEqual([]);
  });

  test("a refused decision writes nothing at all", async () => {
    const w = world();
    const result = await applyDecisions(REPO, 7, file(d("T-defer", "defer"), d("T-fix", "defer")), config(w));
    expect(result.kind).toBe("refused");
    expect(w.ops).toEqual([]);
    if (result.kind === "policy") throw new Error("policy");
    expect(exitForApply(result)).toBe(3);
  });

  test("refuses to resolve a person's open question", async () => {
    const w = world();
    const result = await applyDecisions(REPO, 7, file(d("T-question", "defer", "Later.", null, true)), config(w));
    expect(refused(result)).toContain("open question");
    expect(w.ops).toEqual([]);
    expect(w.threads.find((t) => t.id === "T-question")?.resolved).toBe(false);
  });

  test("refuses a fix commit that the PR does not hold", async () => {
    const w = world();
    const result = await applyDecisions(REPO, 7, file(d("T-fix", "fix", "", sha("7"))), config(w));
    expect(refused(result)).toContain("not a commit of this PR");
    expect(w.ops).toEqual([]);
  });

  test("refuses when the head is not the one the decisions expect", async () => {
    const w = world();
    const result = await applyDecisions(REPO, 7, { expectHead: sha("9"), decisions: ALL.decisions }, config(w));
    expect(refused(result)).toContain("expect");
    expect(w.ops).toEqual([]);
  });

  test("refuses on a closed PR", async () => {
    const w = world();
    w.state = "CLOSED";
    expect(refused(await applyDecisions(REPO, 7, ALL, config(w)))).toContain("not open");
    expect(w.ops).toEqual([]);
  });

  test("an invalid policy on the base branch stops the run", async () => {
    const w = world();
    w.policy = "schema = 1\n[threads]\nbogus = 1\n";
    expect((await applyDecisions(REPO, 7, ALL, config(w))).kind).toBe("policy");
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
  });
});

describe("two reads of the open threads", () => {
  test("an extra open thread in the second read is a reason to refuse, for that reason", async () => {
    const w = world();
    const extra = { id: "T-extra", resolved: false, path: "x.rs", line: 1, comments: [{ author: "reviewer-9", body: "Late." }] };
    const fake = w.gh({
      threadDetails: () => ({
        data: { node: { reviewThreads: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [...w.threads.map((t) => w.detail(t)), w.detail(extra)] } } },
      }),
    });
    const result = await applyDecisions(REPO, 7, file(d("T-defer", "defer")), config(w, { runGh: fake.run }));
    expect(refused(result)).toContain("changed while they were read");
    expect(w.ops).toEqual([]);
  });
});

describe("a person's question that GitHub holds", () => {
  test("a question in an old comment of a long thread is found, because every page is read", async () => {
    const filler = Array.from({ length: 24 }, (_, i) => ({ author: i % 2 === 0 ? AGENT : "review-bot", body: `note ${i}` }));
    const w = world([{ id: "T-long", comments: [{ author: "review-bot", body: "P3: nit" }, ...filler, { author: "reviewer-1", body: "Why is this safe?" }] }]);
    w.commentPageSize = 10;
    const result = await applyDecisions(REPO, 7, file(d("T-long", "defer", "Later.", null, true)), config(w));
    expect(refused(result)).toContain("open question");
    expect(w.ops).toEqual([]);
  });

  test("a question in the first comment of a long thread is found", async () => {
    const filler = Array.from({ length: 40 }, (_, i) => ({ author: i % 2 === 0 ? AGENT : "review-bot", body: `note ${i}` }));
    const w = world([{ id: "T-long", comments: [{ author: "reviewer-1", body: "Why is this safe?" }, ...filler] }]);
    w.commentPageSize = 7;
    expect(refused(await applyDecisions(REPO, 7, file(d("T-long", "reply-resolve", "Thanks.", null, true)), config(w)))).toContain("open question");
    expect(w.ops).toEqual([]);
  });

  test("all pages of the thread list are read", async () => {
    const w = world();
    w.threadPageSize = 2;
    const read = await readThreads(w.gh().run, "PR_node_1");
    expect(read.threads.map((t) => t.id)).toEqual(SPECS.map((s) => s.id));
    expect(read.problems).toEqual([]);
  });

  test("an account that GitHub types as a bot is not a person", async () => {
    const w = world([{ id: "T-app", comments: [{ author: "some-app", body: "P3: nit", bot: true }] }]);
    const result = written(await applyDecisions(REPO, 7, file(d("T-app", "defer")), config(w)));
    expect(result.aborted).toBeNull();
    expect(w.threads[0]?.resolved).toBe(true);
  });

  test("a thread that stays cut off is a problem that refuses the write", async () => {
    const w = world();
    const fake = w.gh({
      thread: () => ({ data: { node: { id: "T-defer", isResolved: false, isOutdated: false, path: "a", line: 1, comments: { totalCount: 500, pageInfo: { hasNextPage: true, endCursor: "1" }, nodes: [{ author: { login: "review-bot", __typename: "Bot" }, body: "P3", url: null }] } } } }),
    });
    w.commentPageSize = 1;
    w.threads = w.threads.map((t) => ({ ...t, comments: [...t.comments, ...t.comments] }));
    const read = await readThreads(fake.run, "PR_node_1");
    expect(read.problems.join(" ")).toContain("comments were read");
  });

  test("a question that arrives after the checks stops the resolve of the next thread, before its reply", async () => {
    const w = world();
    w.afterMutation = (self, op) => {
      if (op.kind === "resolveReviewThread" && op.threadId === "T-fix") {
        self.threads.find((t) => t.id === "T-defer")?.comments.push({ author: "reviewer-1", body: "Wait, why defer this?" });
      }
    };
    const result = written(await applyDecisions(REPO, 7, file(d("T-fix", "fix", "", FIX_COMMIT), d("T-defer", "defer")), config(w)));
    expect(result.aborted).toContain("asked a question");
    expect(opNames(w)).toEqual(["addPullRequestReviewThreadReply:T-fix", "resolveReviewThread:T-fix"]);
    expect(w.threads.find((t) => t.id === "T-defer")?.resolved).toBe(false);
    expect(result.notAttempted).toEqual([]);
    expect(result.outcomes.map((o) => [o.id, o.ok])).toEqual([["T-fix", true], ["T-defer", false]]);
  });

  test("a question in answer to our reply stops the resolve of the same thread", async () => {
    const w = world();
    w.afterMutation = (self, op) => {
      if (op.kind === "addPullRequestReviewThreadReply") {
        self.threads.find((t) => t.id === op.threadId)?.comments.push({ author: "reviewer-1", body: "Wait, why defer this?" });
      }
    };
    const result = written(await applyDecisions(REPO, 7, file(d("T-defer", "defer")), config(w)));
    expect(result.aborted).toContain("asked a question");
    expect(opNames(w)).toEqual(["addPullRequestReviewThreadReply:T-defer"]);
    expect(w.threads.find((t) => t.id === "T-defer")?.resolved).toBe(false);
    expect(result.outcomes[0]?.note).toBe("replied, not resolved");
    expect(exitForApply(result)).toBe(20);
  });

  test("a reply-only decision goes on when a question arrives: it never resolves", async () => {
    const w = world();
    w.afterMutation = (self) => {
      self.threads.find((t) => t.id === "T-other")?.comments.push({ author: "reviewer-2", body: "Why?" });
    };
    const result = written(await applyDecisions(REPO, 7, file(d("T-other", "reply-only", "Later.")), config(w)));
    expect(result.aborted).toBeNull();
  });
});

describe("write failures", () => {
  test("the head moves: stops before the next write", async () => {
    const w = world();
    w.afterMutation = (self) => {
      self.head = sha("f");
    };
    const result = written(await applyDecisions(REPO, 7, ALL, config(w)));
    expect(w.ops).toHaveLength(1);
    expect(result.aborted).toContain("the PR changed");
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0]?.note).toBe("replied, not resolved");
    expect(result.notAttempted).toEqual(["T-defer", "T-question", "T-other", "T-praise"]);
  });

  test("the PR closes mid-run: stops", async () => {
    const w = world();
    w.afterMutation = (self) => {
      self.state = "CLOSED";
    };
    const result = written(await applyDecisions(REPO, 7, ALL, config(w)));
    expect(w.ops).toHaveLength(1);
    expect(result.aborted).toContain("the PR changed");
  });

  test("the head moves after the last write: the run reports it", async () => {
    const w = world();
    w.afterMutation = (self, op) => {
      if (op.kind === "resolveReviewThread") {
        self.head = sha("f");
      }
    };
    const result = written(await applyDecisions(REPO, 7, file(d("T-defer", "defer")), config(w)));
    expect(result.aborted).toContain("head changed during the run");
  });

  test("stops at the first failed write and reports what was and was not written", async () => {
    const w = world();
    w.failMutation = { at: 3, stderr: "gh: server error" };
    const result = written(await applyDecisions(REPO, 7, ALL, config(w)));
    expect(result.aborted).toContain("reply failed");
    expect(result.mutations).toBe(2);
    expect(result.outcomes.map((o) => [o.id, o.ok])).toEqual([["T-fix", true], ["T-defer", false]]);
    expect(result.notAttempted).toEqual(["T-question", "T-other", "T-praise"]);
    const text = renderApplyText(result, "r#7");
    expect(text).toContain("written 1 of 5 decisions");
    expect(text).toContain("T-defer defer: FAILED: not written");
    expect(text).toContain("T-question: not attempted");
    expect(exitForApply(result)).toBe(20);
  });

  test("a failure of the first write is exit 3: nothing was written", async () => {
    const w = world();
    w.failMutation = { at: 1, stderr: "gh: server error" };
    const result = written(await applyDecisions(REPO, 7, ALL, config(w)));
    expect(result.mutations).toBe(0);
    expect(exitForApply(result)).toBe(3);
    expect(renderApplyText(result, "r#7")).toContain("written 0 of 5 decisions");
  });

  test("a mutation that throws is reported, not a crash", async () => {
    const w = world();
    let calls = 0;
    const mutate = async (op: GhMutation) => {
      calls += 1;
      if (calls === 3) {
        throw new RangeError("comment body must have 1 to 65000 characters");
      }
      return w.mutate(op);
    };
    const result = written(await applyDecisions(REPO, 7, ALL, config(w, { mutate })));
    expect(result.aborted).toContain("comment body must have");
    expect(result.outcomes.map((o) => [o.id, o.ok])).toEqual([["T-fix", true], ["T-defer", false]]);
    expect(result.remaining).not.toBeNull();
  });

  test("an empty policy defer_reply refuses the file before any write", async () => {
    const w = world();
    w.policy = 'schema = 1\n[threads]\nbots = ["review-bot"]\ndefer_reply = ""\n';
    const result = await applyDecisions(REPO, 7, file(d("T-fix", "fix", "", FIX_COMMIT), d("T-defer", "defer")), config(w));
    expect(refused(result)).toContain("defer_reply is empty");
    expect(w.ops).toEqual([]);
  });

  test("does not accept a GitHub reply that fails to confirm the resolve", async () => {
    const w = world();
    const mutate = async (op: GhMutation) => {
      const r = await w.mutate(op);
      return op.kind === "resolveReviewThread" ? { ...r, stdout: JSON.stringify({ data: { resolveReviewThread: { thread: { id: op.threadId, isResolved: false } } } }) } : r;
    };
    const result = written(await applyDecisions(REPO, 7, file(d("T-defer", "defer")), config(w, { mutate })));
    expect(result.aborted).toContain("did not confirm");
  });

  test("does not accept a reply without a comment id", async () => {
    const w = world();
    const mutate = async (op: GhMutation) => {
      const r = await w.mutate(op);
      return op.kind === "addPullRequestReviewThreadReply" ? { ...r, stdout: JSON.stringify({ data: { addPullRequestReviewThreadReply: { comment: {} } } }) } : r;
    };
    const result = written(await applyDecisions(REPO, 7, file(d("T-defer", "defer")), config(w, { mutate })));
    expect(result.aborted).toContain("did not confirm");
    expect(w.threads.find((t) => t.id === "T-defer")?.resolved).toBe(false);
  });

  test("does not accept a GitHub reply that carries errors", async () => {
    const w = world();
    const mutate = async (op: GhMutation) => {
      const r = await w.mutate(op);
      return { ...r, stdout: JSON.stringify({ ...JSON.parse(r.stdout), errors: [{ message: "nope" }] }) };
    };
    const result = written(await applyDecisions(REPO, 7, file(d("T-defer", "defer")), config(w, { mutate })));
    expect(result.aborted).toContain("GitHub reported an error");
  });
});

describe("re-run", () => {
  test("after a failed resolve a bot auto-reply does not cause a second post", async () => {
    const w = world();
    w.failMutation = { at: 2, stderr: "gh: server error" };
    w.afterMutation = (self, op) => {
      if (op.kind === "addPullRequestReviewThreadReply") {
        self.threads.find((t) => t.id === op.threadId)?.comments.push({ author: "review-bot", body: "Thanks!", bot: true });
      }
    };
    const first = written(await applyDecisions(REPO, 7, file(d("T-fix", "fix", "", FIX_COMMIT)), config(w)));
    expect(first.aborted).toContain("resolve failed");
    const before = w.threads.find((t) => t.id === "T-fix")?.comments.length;
    w.failMutation = null;
    const second = written(await applyDecisions(REPO, 7, file(d("T-fix", "fix", "", FIX_COMMIT)), config(w)));
    expect(second.aborted).toBeNull();
    expect(w.threads.find((t) => t.id === "T-fix")?.comments.length).toBe(before);
    expect(w.threads.find((t) => t.id === "T-fix")?.resolved).toBe(true);
  });

  test("the dedupe does not need `gh api user`; an unknown agent's reply looks like a person, so the decision carries a reply and the confirmation", async () => {
    const w = world();
    w.userKnown = false;
    const decision = file(d("T-defer", "defer", "Later.", null, true));
    w.failMutation = { at: 2, stderr: "gh: server error" };
    written(await applyDecisions(REPO, 7, decision, config(w)));
    const before = w.threads.find((t) => t.id === "T-defer")?.comments.length;
    w.failMutation = null;
    const second = written(await applyDecisions(REPO, 7, decision, config(w)));
    expect(second.aborted).toBeNull();
    expect(w.threads.find((t) => t.id === "T-defer")?.comments.length).toBe(before);
    expect(w.threads.find((t) => t.id === "T-defer")?.resolved).toBe(true);
  });

  test("a resolved thread whose reply is no longer last is done, and does not block the file", async () => {
    const w = world();
    w.afterMutation = (self, op) => {
      if (op.kind === "resolveReviewThread") {
        self.threads.find((t) => t.id === op.threadId)?.comments.push({ author: "review-bot", body: "Thanks!", bot: true });
      }
    };
    await applyDecisions(REPO, 7, ALL, config(w));
    const count = w.ops.length;
    const again = written(await applyDecisions(REPO, 7, ALL, config(w)));
    expect(again.aborted).toBeNull();
    expect(w.ops).toHaveLength(count);
  });

  test("a second run after success writes nothing", async () => {
    const w = world();
    await applyDecisions(REPO, 7, ALL, config(w));
    const count = w.ops.length;
    const again = written(await applyDecisions(REPO, 7, ALL, config(w)));
    expect(again.aborted).toBeNull();
    expect(w.ops).toHaveLength(count);
  });
});
