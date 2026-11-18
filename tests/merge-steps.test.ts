import { afterEach, describe, expect, test } from "bun:test";
import { removeBodyFiles } from "../lib/body-file.ts";
import { dequeueStep } from "../lib/merge/dequeue.ts";
import { mergeStep } from "../lib/merge/merge.ts";
import { readyStep } from "../lib/merge/ready.ts";
import { EXIT } from "../lib/merge/types.ts";
import { ctxRun, thread } from "./helpers/fake-gh.ts";
import { graphqlError, makeWorld, removeWorlds, type World } from "./helpers/merge-world.ts";
import { builtinPolicy, HEAD, sha } from "./helpers/status.ts";

afterEach(() => {
  removeBodyFiles();
  removeWorlds();
});

const openThread = { reviewThreads: { totalCount: 1, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [thread(1)] } };
const pending = {
  latestCommit: {
    nodes: [
      {
        commit: {
          id: "C_node_1",
          oid: HEAD,
          statusCheckRollup: {
            contexts: {
              totalCount: 1,
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [ctxRun("Required", { isRequired: true, status: "IN_PROGRESS", conclusion: null })],
            },
          },
        },
      },
    ],
  },
};
const jumpPolicy = '[merge]\njump = "labelled"\njump_labels = ["queue:jump"]\n';
const labels = (...names: string[]) => ({ labels: { totalCount: names.length, nodes: names.map((name) => ({ name })) } });

function nothingWritten(world: World): void {
  expect(world.mutations).toEqual([]);
  expect(world.merges).toEqual([]);
  expect(world.comments).toEqual([]);
}

describe("merge: the queue route", () => {
  test("enqueues the exact head after two reads, then reads again", async () => {
    const world = makeWorld();
    const seen: number[] = [];
    world.beforeMutation = () => void seen.push(world.gathers);
    const outcome = await mergeStep(world.context(), { acceptRisk: false });
    expect(outcome.exit).toBe(EXIT.waiting);
    expect(outcome.outcome).toBe("queued");
    expect(seen).toEqual([2]);
    expect(world.gathers).toBe(3);
    expect(world.mutations).toHaveLength(1);
    expect(world.mutations[0]).toEqual({ kind: "enqueuePullRequest", pullRequestId: "PR_node_1", expectedHeadOid: HEAD, jump: false });
    const argv = world.mutationArgv[0] ?? [];
    expect(argv).toContain(`expectedHeadOid=${HEAD}`);
    expect(argv).toContain("jump=false");
    expect(world.merges).toEqual([]);
    expect(outcome.next).toContain("watch 7");
  });

  test("a base-branch policy file is accepted; the default policy too", async () => {
    const withFile = makeWorld({ policyToml: "schema = 1\n" });
    const a = await mergeStep(withFile.context(), { acceptRisk: false });
    expect(a.verdict?.policySource).toBe("base-branch");
    expect(a.outcome).toBe("queued");
    const without = makeWorld();
    const b = await mergeStep(without.context(), { acceptRisk: false });
    expect(b.verdict?.policySource).toBe("default");
  });

  test("the queue merging instantly gives merged", async () => {
    const world = makeWorld();
    world.mutationReply.enqueuePullRequest = () => {
      world.prState = "MERGED";
      return { code: 0, stdout: JSON.stringify({ data: {} }), stderr: "" };
    };
    const outcome = await mergeStep(world.context(), { acceptRisk: false });
    expect(outcome.exit).toBe(EXIT.done);
    expect(outcome.outcome).toBe("merged");
    expect(outcome.mergeCommit).toBe(world.mergeCommit);
  });

  test("an enqueue that leaves the PR out of the queue is blocked", async () => {
    const world = makeWorld();
    world.mutationReply.enqueuePullRequest = () => ({ code: 0, stdout: JSON.stringify({ data: {} }), stderr: "" });
    const outcome = await mergeStep(world.context(), { acceptRisk: false });
    expect(outcome.exit).toBe(EXIT.blocked);
    expect(world.lines.join("\n")).toContain("not in the queue");
  });

  test("GitHub refusing a normal enqueue is blocked", async () => {
    const world = makeWorld();
    world.mutationReply.enqueuePullRequest = () => graphqlError("Pull request is not mergeable");
    const outcome = await mergeStep(world.context(), { acceptRisk: false });
    expect(outcome.exit).toBe(EXIT.blocked);
    expect(world.lines.join("\n")).toContain("GitHub refused to enqueue: Pull request is not mergeable");
    expect(world.mutations).toHaveLength(1);
  });
});

describe("merge: jump", () => {
  test("a jump needs the policy and a jump label", async () => {
    const world = makeWorld({ policyToml: jumpPolicy });
    world.pr = labels("ci:auto", "queue:jump");
    const outcome = await mergeStep(world.context(), { acceptRisk: false });
    expect(outcome.outcome).toBe("queued");
    expect(world.mutations).toEqual([{ kind: "enqueuePullRequest", pullRequestId: "PR_node_1", expectedHeadOid: HEAD, jump: true }]);
    expect(world.mutationArgv[0]).toContain("jump=true");
  });

  test("jump = never with a jump label on the PR gives a normal enqueue and a note", async () => {
    const world = makeWorld({ policyToml: '[merge]\njump = "never"\njump_labels = ["queue:jump"]\n' });
    world.pr = labels("ci:auto", "queue:jump");
    await mergeStep(world.context(), { acceptRisk: false });
    expect(world.mutations).toEqual([{ kind: "enqueuePullRequest", pullRequestId: "PR_node_1", expectedHeadOid: HEAD, jump: false }]);
    expect(world.mutationArgv[0]).toContain("jump=false");
    expect(world.lines.join("\n")).toContain('has the jump label "queue:jump", but the policy has merge.jump = "never"');
  });

  test("the policy with a jump and no label gives a normal enqueue", async () => {
    const world = makeWorld({ policyToml: jumpPolicy });
    await mergeStep(world.context(), { acceptRisk: false });
    expect(world.mutations[0]).toMatchObject({ jump: false });
  });

  test("a refused jump is BLOCKED and never retried without the jump", async () => {
    const world = makeWorld({ policyToml: jumpPolicy });
    world.pr = labels("ci:auto", "queue:jump");
    world.mutationReply.enqueuePullRequest = () => graphqlError("Jump is not allowed for this pull request");
    const outcome = await mergeStep(world.context(), { acceptRisk: false });
    expect(outcome.exit).toBe(EXIT.blocked);
    expect(outcome.outcome).toBe("blocked");
    expect(world.mutations).toHaveLength(1);
    expect(world.mutations[0]).toMatchObject({ jump: true });
    expect(outcome.next).toContain("no retry");
    expect(world.lines.join("\n")).toContain("jump refused by GitHub");
  });
});

describe("merge: the direct route", () => {
  const direct = () => makeWorld({ hasQueue: false });

  test("squash with the head pinned, and nothing else", async () => {
    const world = direct();
    const outcome = await mergeStep(world.context(), { acceptRisk: false });
    expect(outcome.exit).toBe(EXIT.done);
    expect(outcome.outcome).toBe("merged");
    expect(outcome.mergeCommit).toBe(world.mergeCommit);
    expect(world.merges).toEqual([["pr", "merge", "7", "--repo", "example-org/example-repo", "--squash", "--match-head-commit", HEAD]]);
    expect(world.mutations).toEqual([]);
  });

  test("the method comes from the policy and must be allowed by the rules", async () => {
    const world = makeWorld({ hasQueue: false, policyToml: '[merge]\nmethod = "rebase"\n', allowedMethods: ["rebase"] });
    await mergeStep(world.context(), { acceptRisk: false });
    expect(world.merges[0]).toContain("--rebase");
    const blocked = makeWorld({ hasQueue: false, policyToml: '[merge]\nmethod = "rebase"\n', allowedMethods: ["squash"] });
    const outcome = await mergeStep(blocked.context(), { acceptRisk: false });
    expect(outcome.exit).toBe(EXIT.blocked);
    nothingWritten(blocked);
  });

  test("a failed merge command is blocked", async () => {
    const world = direct();
    world.mergeFails = "Head branch was modified. Review and try the merge again.";
    const outcome = await mergeStep(world.context(), { acceptRisk: false });
    expect(outcome.exit).toBe(EXIT.blocked);
    expect(world.lines.join("\n")).toContain("Head branch was modified");
  });

  test("an accepted merge that is not merged yet gives waiting", async () => {
    const world = direct();
    const original = world.io.runGh;
    let merged = false;
    const io = {
      ...world.io,
      runGh: async (args: readonly string[]) => {
        if (args[0] === "pr" && args[1] === "merge") {
          merged = true;
          world.merges.push([...args]);
          return { code: 0, stdout: "", stderr: "" };
        }
        if (args[0] === "pr" && args[1] === "view" && merged) {
          return { code: 0, stdout: JSON.stringify({ state: "OPEN", mergeCommit: null, headRefOid: HEAD }), stderr: "" };
        }
        return original(args);
      },
    };
    const outcome = await mergeStep(world.context({ io }), { acceptRisk: false });
    expect(outcome.exit).toBe(EXIT.waiting);
    expect(world.sleeps).toEqual([2000, 2000]);
  });
});

describe("merge: gates before any write", () => {
  test("a BLOCKED verdict stops with exit 20 and reads no diff", async () => {
    const world = makeWorld();
    world.pr = openThread;
    const outcome = await mergeStep(world.context(), { acceptRisk: false });
    expect(outcome.exit).toBe(EXIT.blocked);
    expect(outcome.verdict?.state).toBe("BLOCKED");
    nothingWritten(world);
    expect(world.calls.some((c) => c[1] === "diff")).toBe(false);
  });

  test("a WAITING verdict stops with exit 10", async () => {
    const world = makeWorld();
    world.pr = pending;
    const outcome = await mergeStep(world.context(), { acceptRisk: false });
    expect(outcome.exit).toBe(EXIT.waiting);
    nothingWritten(world);
  });

  test("a PR that sits in the queue is WAITING; blocked in the queue is BLOCKED with a dequeue", async () => {
    const queued = makeWorld();
    queued.queue({});
    expect((await mergeStep(queued.context(), { acceptRisk: false })).exit).toBe(EXIT.waiting);
    nothingWritten(queued);
    const stuck = makeWorld();
    stuck.queue({});
    stuck.pr = { ...stuck.pr, ...openThread };
    const outcome = await mergeStep(stuck.context(), { acceptRisk: false });
    expect(outcome.exit).toBe(EXIT.blocked);
    expect(outcome.verdict?.findings.map((f) => f.code)).toContain("queued_while_blocked");
    expect(outcome.next).toContain("pr-merge dequeue");
    nothingWritten(stuck);
  });

  test("a merged PR is nothing to do", async () => {
    const world = makeWorld();
    world.prState = "MERGED";
    const outcome = await mergeStep(world.context(), { acceptRisk: false });
    expect(outcome.exit).toBe(EXIT.done);
    expect(outcome.outcome).toBe("nothing_to_do");
    expect(outcome.mergeCommit).toBe(world.mergeCommit);
    nothingWritten(world);
  });

  test("a fork PR is refused with exit 3", async () => {
    const world = makeWorld();
    world.pr = { isCrossRepository: true, headRepository: { nameWithOwner: "fork-user/example-repo" } };
    const outcome = await mergeStep(world.context(), { acceptRisk: false });
    expect(outcome.exit).toBe(EXIT.refused);
    nothingWritten(world);
  });

  test("a verdict from a local policy is refused with exit 3", async () => {
    const world = makeWorld();
    const outcome = await mergeStep(world.context({ localPolicy: builtinPolicy() }), { acceptRisk: false });
    expect(outcome.exit).toBe(EXIT.refused);
    expect(outcome.verdict?.policySource).toBe("local");
    nothingWritten(world);
  });

  test("without --confirm the step prints its plan and writes nothing", async () => {
    const world = makeWorld();
    const outcome = await mergeStep(world.context({ confirmed: false }), { acceptRisk: false });
    expect(outcome.exit).toBe(EXIT.plan);
    expect(outcome.outcome).toBe("plan");
    expect(world.lines.join("\n")).toContain("route: enqueue");
    expect(world.lines.join("\n")).toContain("--confirm 7");
    nothingWritten(world);
    expect(world.gathers).toBe(1);
  });

  test("the head moving between the plan and the write stops the write", async () => {
    const world = makeWorld();
    world.script = (gather, w) => {
      if (gather === 2) w.head = sha("f");
    };
    const outcome = await mergeStep(world.context(), { acceptRisk: false });
    expect(outcome.exit).toBe(EXIT.blocked);
    expect(world.lines.join("\n")).toContain("the head moved from aaaaaaa to fffffff");
    nothingWritten(world);
  });

  test("a verdict that turns BLOCKED between the plan and the write stops the write", async () => {
    const world = makeWorld();
    world.script = (gather, w) => {
      if (gather === 2) w.pr = openThread;
    };
    const outcome = await mergeStep(world.context(), { acceptRisk: false });
    expect(outcome.exit).toBe(EXIT.blocked);
    expect(world.lines.join("\n")).toContain("no longer READY");
    nothingWritten(world);
  });
});

describe("merge: the route is checked again before the write", () => {
  test("a jump label that appears between the plan and the write stops the write", async () => {
    const world = makeWorld({ policyToml: jumpPolicy });
    world.script = (gather, w) => {
      if (gather === 2) w.pr = labels("ci:auto", "queue:jump");
    };
    const outcome = await mergeStep(world.context(), { acceptRisk: false });
    expect(outcome.exit).toBe(EXIT.blocked);
    expect(world.lines.join("\n")).toContain("the route changed between the plan and the write");
    nothingWritten(world);
  });

  test("a queue method that changes between the plan and the write stops the write", async () => {
    const world = makeWorld();
    world.script = (gather, w) => {
      if (gather === 2) w.queueMethod = "MERGE";
    };
    const outcome = await mergeStep(world.context(), { acceptRisk: false });
    expect(outcome.exit).toBe(EXIT.blocked);
    expect(world.lines.join("\n")).toContain("the route changed between the plan and the write");
    nothingWritten(world);
  });

  test("a queue that disappears between the plan and the write stops the write", async () => {
    const world = makeWorld();
    world.script = (gather, w) => {
      if (gather === 2) w.hasQueue = false;
    };
    const outcome = await mergeStep(world.context(), { acceptRisk: false });
    expect(outcome.exit).toBe(EXIT.blocked);
    nothingWritten(world);
  });
});

describe("merge: high-risk paths", () => {
  test("a rename out of .github is high risk, by the old path", async () => {
    const world = makeWorld({ files: [{ filename: "ci-old/gate.yml", previous_filename: ".github/workflows/gate.yml" }] });
    const outcome = await mergeStep(world.context(), { acceptRisk: false });
    expect(outcome.exit).toBe(EXIT.refused);
    expect(world.lines.join("\n")).toContain("high-risk path: .github/workflows/gate.yml");
    nothingWritten(world);
  });

  test("a rename into .github is high risk, by the new path", async () => {
    const world = makeWorld({ files: [{ filename: ".github/workflows/gate.yml", previous_filename: "ci-old/gate.yml" }] });
    expect((await mergeStep(world.context(), { acceptRisk: false })).exit).toBe(EXIT.refused);
    nothingWritten(world);
  });

  test("the policy globs replace the default list", async () => {
    const custom = makeWorld({ policyToml: '[merge]\nhigh_risk_paths = ["infra/**"]\n', files: ["infra/prod.tf"] });
    expect((await mergeStep(custom.context(), { acceptRisk: false })).exit).toBe(EXIT.refused);
    const ignored = makeWorld({ policyToml: '[merge]\nhigh_risk_paths = ["infra/**"]\n', files: [".github/workflows/ci.yml"] });
    expect((await mergeStep(ignored.context(), { acceptRisk: false })).outcome).toBe("queued");
    const off = makeWorld({ policyToml: "[merge]\nhigh_risk_paths = []\n", files: [".github/workflows/ci.yml"] });
    expect((await mergeStep(off.context(), { acceptRisk: false })).outcome).toBe("queued");
  });

  test("a list of 3000 files is incomplete and counts as high risk", async () => {
    const world = makeWorld({ files: Array.from({ length: 3000 }, (_, i) => `src/f${i}.rs`) });
    const outcome = await mergeStep(world.context(), { acceptRisk: false });
    expect(outcome.exit).toBe(EXIT.refused);
    expect(world.lines.join("\n")).toContain("changed files are unknown");
  });

  test("a change in .github needs --accept-risk", async () => {
    const world = makeWorld({ files: ["src/a.rs", ".github/workflows/ci.yml"] });
    const refused = await mergeStep(world.context(), { acceptRisk: false });
    expect(refused.exit).toBe(EXIT.refused);
    expect(world.lines.join("\n")).toContain("high-risk path: .github/workflows/ci.yml");
    nothingWritten(world);
    const accepted = await mergeStep(world.context(), { acceptRisk: true });
    expect(accepted.outcome).toBe("queued");
    expect(world.mutations).toHaveLength(1);
  });

  test("a diff that cannot be listed counts as high risk", async () => {
    const world = makeWorld({ files: "fail" });
    const refused = await mergeStep(world.context(), { acceptRisk: false });
    expect(refused.exit).toBe(EXIT.refused);
    expect(world.lines.join("\n")).toContain("changed files are unknown");
    nothingWritten(world);
  });
});

describe("merge: queue configuration", () => {
  test.each([
    ["the queue merges with another method", { queueMethod: "MERGE" }, "the queue merges with merge"],
    ["the queue rule names no method", { queueMethod: null }, "not confirmed"],
    ["the queue has no readable rule", { queueMethod: "none" }, "not confirmed"],
  ] as const)("%s", async (_name, patch, text) => {
    const world = makeWorld(patch);
    const outcome = await mergeStep(world.context(), { acceptRisk: false });
    expect(outcome.exit).toBe(EXIT.blocked);
    expect(world.lines.join("\n")).toContain(text);
    nothingWritten(world);
  });

  test("merge.queue = required without a queue, and never with a queue, are blocked", async () => {
    const required = makeWorld({ hasQueue: false, policyToml: '[merge]\nqueue = "required"\n' });
    expect((await mergeStep(required.context(), { acceptRisk: false })).exit).toBe(EXIT.blocked);
    nothingWritten(required);
    const never = makeWorld({ policyToml: '[merge]\nqueue = "never"\n' });
    expect((await mergeStep(never.context(), { acceptRisk: false })).exit).toBe(EXIT.blocked);
    nothingWritten(never);
  });

  test("merge.method must equal the queue method", async () => {
    const world = makeWorld({ policyToml: '[merge]\nmethod = "merge"\n' });
    const outcome = await mergeStep(world.context(), { acceptRisk: false });
    expect(outcome.exit).toBe(EXIT.blocked);
    expect(world.lines.join("\n")).toContain('the queue merges with squash, but the policy has merge.method = "merge"');
  });
});

describe("ready", () => {
  const draft = (extra: Record<string, unknown> = {}) => {
    const world = makeWorld();
    world.pr = { isDraft: true, ...extra };
    return world;
  };

  test("marks a draft ready when draft is the only blocker", async () => {
    const world = draft();
    const outcome = await readyStep(world.context());
    expect(outcome.exit).toBe(EXIT.done);
    expect(outcome.outcome).toBe("ready");
    expect(world.mutations).toEqual([{ kind: "markPullRequestReadyForReview", pullRequestId: "PR_node_1" }]);
    expect(world.gathers).toBe(3);
  });

  test("another blocker stops it with exit 20", async () => {
    const world = draft(openThread);
    const outcome = await readyStep(world.context());
    expect(outcome.exit).toBe(EXIT.blocked);
    expect(world.lines.join("\n")).toContain("other blockers remain: threads_unresolved");
    nothingWritten(world);
  });

  test("a running check stops it with exit 10", async () => {
    const world = draft(pending);
    const outcome = await readyStep(world.context());
    expect(outcome.exit).toBe(EXIT.waiting);
    nothingWritten(world);
  });

  test('ready_when = "manual" is refused with exit 3', async () => {
    const world = makeWorld({ policyToml: '[draft]\nready_when = "manual"\n' });
    world.pr = { isDraft: true };
    const outcome = await readyStep(world.context());
    expect(outcome.exit).toBe(EXIT.refused);
    nothingWritten(world);
  });

  test('ready_when = "immediately" needs no other gate', async () => {
    const world = makeWorld({ policyToml: '[draft]\nready_when = "immediately"\n' });
    world.pr = { isDraft: true, ...openThread };
    const outcome = await readyStep(world.context());
    expect(outcome.outcome).toBe("ready");
    expect(world.mutations).toHaveLength(1);
  });

  test("a PR that is not a draft is nothing to do", async () => {
    const world = makeWorld();
    const outcome = await readyStep(world.context());
    expect(outcome.exit).toBe(EXIT.done);
    expect(outcome.outcome).toBe("nothing_to_do");
    nothingWritten(world);
  });

  test("without --confirm it prints the plan", async () => {
    const world = draft();
    const outcome = await readyStep(world.context({ confirmed: false }));
    expect(outcome.exit).toBe(EXIT.plan);
    expect(outcome.outcome).toBe("plan");
    nothingWritten(world);
  });

  test("a head change between the reads stops the write", async () => {
    const world = draft();
    world.script = (gather, w) => {
      if (gather === 2) w.head = sha("f");
    };
    const outcome = await readyStep(world.context());
    expect(outcome.exit).toBe(EXIT.blocked);
    nothingWritten(world);
  });

  test("a blocker that appears between the plan and the write stops the write", async () => {
    const world = draft();
    world.script = (gather, w) => {
      if (gather === 2) w.pr = { ...w.pr, ...openThread };
    };
    const outcome = await readyStep(world.context());
    expect(outcome.exit).toBe(EXIT.blocked);
    expect(outcome.outcome).toBe("blocked");
    nothingWritten(world);
  });

  test("a check that starts between the plan and the write gives waiting, not blocked", async () => {
    const world = draft();
    world.script = (gather, w) => {
      if (gather === 2) w.pr = { ...w.pr, ...pending };
    };
    const outcome = await readyStep(world.context());
    expect(outcome.exit).toBe(EXIT.waiting);
    expect(outcome.outcome).toBe("waiting");
    nothingWritten(world);
  });

  test("a PR that someone marked ready between the reads needs no write", async () => {
    const world = draft();
    world.script = (gather, w) => {
      if (gather === 2) w.pr = { ...w.pr, isDraft: false };
    };
    const outcome = await readyStep(world.context());
    expect(outcome.exit).toBe(EXIT.done);
    expect(outcome.outcome).toBe("nothing_to_do");
    nothingWritten(world);
  });

  test("a policy that turns manual between the reads stops the write", async () => {
    const world = draft();
    world.script = (gather, w) => {
      if (gather === 2) {
        w.policyToml = '[draft]\nready_when = "manual"\n';
        w.defaultSha = sha("d");
      }
    };
    const outcome = await readyStep(world.context());
    expect(outcome.exit).toBe(EXIT.refused);
    expect(outcome.outcome).toBe("refused");
    nothingWritten(world);
  });

  test("a refusal by GitHub is blocked", async () => {
    const world = draft();
    world.mutationReply.markPullRequestReadyForReview = () => graphqlError("Resource not accessible");
    const outcome = await readyStep(world.context());
    expect(outcome.exit).toBe(EXIT.blocked);
  });
});

describe("dequeue", () => {
  const queuedBlocked = () => {
    const world = makeWorld();
    world.queue({});
    world.pr = { ...world.pr, ...openThread };
    return world;
  };

  test("removes the entry and posts a generic reason comment", async () => {
    const world = queuedBlocked();
    const outcome = await dequeueStep(world.context(), null);
    expect(outcome.exit).toBe(EXIT.done);
    expect(outcome.outcome).toBe("dequeued");
    expect(world.mutations).toEqual([{ kind: "dequeuePullRequest", entryId: "MQE_1" }]);
    expect(world.comments).toHaveLength(1);
    const comment = world.comments[0] ?? "";
    expect(comment).toContain("Removed from the merge queue by an automated step.");
    expect(comment).toContain("Reason: the PR has open blockers");
    expect(comment).toContain("Open findings: threads_unresolved.");
    expect(comment).not.toContain("P1 finding");
    const commentCall = world.calls.find((c) => c[1] === "comment") ?? [];
    expect(commentCall.slice(0, 5)).toEqual(["pr", "comment", "7", "--repo", "example-org/example-repo"]);
  });

  test("a reason from the user wins", async () => {
    const world = queuedBlocked();
    await dequeueStep(world.context(), "manual");
    expect(world.comments[0]).toContain("Reason: a person asked for the removal.");
  });

  test("an UNMERGEABLE entry gets the unmergeable reason", async () => {
    const world = makeWorld();
    world.queue({ state: "UNMERGEABLE" });
    await dequeueStep(world.context(), null);
    expect(world.comments[0]).toContain("UNMERGEABLE");
  });

  test("a PR that is not queued is nothing to do", async () => {
    const world = makeWorld();
    const outcome = await dequeueStep(world.context(), null);
    expect(outcome.exit).toBe(EXIT.done);
    expect(outcome.outcome).toBe("nothing_to_do");
    nothingWritten(world);
  });

  test("without --confirm it prints the plan", async () => {
    const world = queuedBlocked();
    const outcome = await dequeueStep(world.context({ confirmed: false }), null);
    expect(outcome.exit).toBe(EXIT.plan);
    expect(outcome.outcome).toBe("plan");
    nothingWritten(world);
  });

  test("a head change between the reads stops it", async () => {
    const world = queuedBlocked();
    world.script = (gather, w) => {
      if (gather === 2) w.head = sha("f");
    };
    const outcome = await dequeueStep(world.context(), null);
    expect(outcome.exit).toBe(EXIT.blocked);
    nothingWritten(world);
  });

  test("a changed queue entry stops it", async () => {
    const world = queuedBlocked();
    world.script = (gather, w) => {
      if (gather === 2) w.queue({ id: "MQE_2" });
    };
    const outcome = await dequeueStep(world.context(), null);
    expect(outcome.exit).toBe(EXIT.blocked);
    nothingWritten(world);
  });

  test("a refusal by GitHub gives exit 20 and no comment", async () => {
    const world = queuedBlocked();
    world.mutationReply.dequeuePullRequest = () => graphqlError("Not allowed");
    const outcome = await dequeueStep(world.context(), null);
    expect(outcome.exit).toBe(EXIT.blocked);
    expect(world.comments).toEqual([]);
  });

  test("a failed comment is a warning, not a failure", async () => {
    const world = queuedBlocked();
    world.commentFails = true;
    const outcome = await dequeueStep(world.context(), null);
    expect(outcome.exit).toBe(EXIT.done);
    expect(world.lines.join("\n")).toContain("the reason comment failed");
  });

  test("an entry that stays in the queue is blocked", async () => {
    const world = queuedBlocked();
    world.mutationReply.dequeuePullRequest = () => ({ code: 0, stdout: JSON.stringify({ data: {} }), stderr: "" });
    const outcome = await dequeueStep(world.context(), null);
    expect(outcome.exit).toBe(EXIT.blocked);
    expect(world.lines.join("\n")).toContain("still in the queue");
  });
});
