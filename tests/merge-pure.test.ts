import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { dequeueComment, deriveReason, hasChangesNeeded } from "../lib/merge/dequeue.ts";
import { parseMutationReply, readChangedFiles, readQueueMethod } from "../lib/merge/github.ts";
import { readyGate } from "../lib/merge/ready.ts";
import { classifyRisk } from "../lib/merge/risk.ts";
import { describeRoute, jumpDecision } from "../lib/merge/route.ts";
import type { Evaluated } from "../lib/merge/types.ts";
import { EXIT } from "../lib/merge/types.ts";
import { classifyWatch } from "../lib/merge/watch.ts";
import type { Policy } from "../lib/policy/types.ts";
import { evaluate } from "../lib/status/evaluate.ts";
import { parseSnapshot } from "../lib/status/snapshot-io.ts";
import type { PrSnapshot } from "../lib/status/types.ts";
import { parseRepoSlug } from "../lib/types.ts";
import { builtinPolicy, examplePolicy, green, root, verdictReview } from "./helpers/status.ts";

function evaluated(snapshot: PrSnapshot, policy: Policy = examplePolicy()): Evaluated {
  return { snapshot, policy, verdict: evaluate(snapshot, policy, "default-branch") };
}

function fixture(name: string): PrSnapshot {
  return parseSnapshot(readFileSync(join(root, "tests", "fixtures", "status", `${name}.json`), "utf8"));
}

const repo = (() => {
  const parsed = parseRepoSlug("example-org/example-repo");
  if (!parsed.ok) throw new Error("slug");
  return parsed.value;
})();

describe("recorded fixtures through the watcher and dequeue logic", () => {
  test("a queued PR with an unresolved thread keeps queued and is dequeued for the blocked reason", () => {
    const e = evaluated(fixture("queued-with-unresolved-thread"));
    expect(e.verdict.findings.map((f) => f.code)).toContain("queued_while_blocked");
    const view = classifyWatch(e);
    expect(view.kind).toBe("queued");
    if (view.kind === "queued") {
      expect(view.line).toContain("threads_unresolved");
      expect(view.line).not.toContain("queued_while_blocked");
    }
    expect(deriveReason(e)).toBe("blocked");
    const comment = dequeueComment("blocked", e);
    expect(comment).toContain("threads_unresolved");
    expect(comment).not.toContain("queued_while_blocked");
  });

  test("an ejected PR is not queued, and the removal reason is in the snapshot", () => {
    const e = evaluated(fixture("ejected-merge-conflict"));
    expect(classifyWatch(e).kind).toBe("not_queued");
    expect(e.snapshot.lastQueueRemoval?.reason).toBeTruthy();
    expect(e.verdict.findings.map((f) => f.code)).toContain("queue_ejected");
  });

  test("a changes-needed verdict that arrives while queued gives a dequeue", () => {
    const base = fixture("queued-with-unresolved-thread");
    const snapshot: PrSnapshot = {
      ...base,
      reviews: [...base.reviews, verdictReview("user-b", "Verdict: changes needed\n\nFix the parser.", base.headSha, "2099-01-01T00:00:00Z")],
    };
    const e = evaluated(snapshot);
    expect(hasChangesNeeded(e)).toBe(true);
    expect(classifyWatch(e).kind).toBe("dequeue");
    expect(deriveReason(e)).toBe("changes-needed");
  });

  test("every recorded fixture classifies without a throw", () => {
    const dir = join(root, "tests", "fixtures", "status");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".expected.json"))) {
      const e = evaluated(parseSnapshot(readFileSync(join(dir, file), "utf8")));
      expect(["merged", "closed", "dequeue", "stuck", "queued", "not_queued"]).toContain(classifyWatch(e).kind);
    }
  });

  test("an UNMERGEABLE entry is stuck and gets the unmergeable reason", () => {
    const base = green();
    const e = evaluated({ ...base, queueEntry: { id: "MQE_1", position: 1, state: "UNMERGEABLE", jump: false, enqueuedAt: "2026-01-01T00:00:00Z" } });
    expect(classifyWatch(e).kind).toBe("stuck");
    expect(deriveReason(e)).toBe("unmergeable");
  });

  test("merged and closed states are final", () => {
    expect(classifyWatch(evaluated({ ...green(), state: "MERGED" })).kind).toBe("merged");
    expect(classifyWatch(evaluated({ ...green(), state: "CLOSED" })).kind).toBe("closed");
  });

  test("a PR that is not blocked and not queued has the manual reason", () => {
    expect(deriveReason(evaluated(green()))).toBe("manual");
  });
});

describe("readyGate", () => {
  const draft = (patch: Partial<PrSnapshot> = {}) => evaluated(green({ isDraft: true, ...patch }));

  test("draft as the only blocker is allowed", () => {
    expect(readyGate(draft()).allowed).toBe(true);
  });

  test("another blocker is blocked, a wait is waiting", () => {
    const blocked = readyGate(draft({ mergeable: "CONFLICTING" }));
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.exit).toBe(EXIT.blocked);
    const waiting = readyGate(draft({ mergeable: "UNKNOWN" }));
    expect(waiting.allowed).toBe(false);
    if (!waiting.allowed) expect(waiting.exit).toBe(EXIT.waiting);
  });

  test("manual is refused and immediately is allowed", () => {
    const policy = examplePolicy();
    const manual = readyGate({ ...draft(), policy: { ...policy, draft: { ...policy.draft, ready_when: "manual" } } });
    expect(manual.allowed).toBe(false);
    if (!manual.allowed) expect(manual.exit).toBe(EXIT.refused);
    const immediate = readyGate({ ...draft({ mergeable: "CONFLICTING" }), policy: { ...policy, draft: { ...policy.draft, ready_when: "immediately" } } });
    expect(immediate.allowed).toBe(true);
  });
});

describe("high-risk paths", () => {
  const globs = builtinPolicy().merge.high_risk_paths;

  test.each([".github/workflows/ci.yml", "release/1.2/notes.md", "services/api/auth/login.ts", "db/migrations/0001_init.sql", "crates/x/release/plan.toml"])(
    "%s is high risk",
    (file) => {
      expect(classifyRisk({ known: true, files: ["src/lib.rs", file] }, globs).level).toBe("high");
    },
  );

  test.each(["src/lib.rs", "docs/readme.md", "src/author.ts", "src/github/client.ts"])("%s is not high risk", (file) => {
    expect(classifyRisk({ known: true, files: [file] }, globs)).toEqual({ level: "none" });
  });

  test("an unknown change list is high risk", () => {
    const risk = classifyRisk({ known: false, reason: "too large" }, globs);
    expect(risk.level).toBe("high");
    if (risk.level === "high") expect(risk.reason).toContain("too large");
  });

  test("the policy default names the four generic areas", () => {
    expect(globs.some((g) => g.startsWith(".github"))).toBe(true);
    expect(globs.some((g) => g.includes("release"))).toBe(true);
    expect(globs.some((g) => g.includes("auth"))).toBe(true);
    expect(globs.some((g) => g.includes("migrat"))).toBe(true);
  });

  test("the globs of the policy replace the default; an empty list turns the check off", () => {
    expect(classifyRisk({ known: true, files: ["infra/prod.tf"] }, ["infra/**"]).level).toBe("high");
    expect(classifyRisk({ known: true, files: [".github/ci.yml"] }, ["infra/**"]).level).toBe("none");
    expect(classifyRisk({ known: true, files: [".github/ci.yml"] }, []).level).toBe("none");
  });
});

describe("jump and route text", () => {
  const policy: Policy = { ...builtinPolicy(), merge: { ...builtinPolicy().merge, jump: "labelled", jump_labels: ["queue:jump", "queue:urgent"] } };

  test("jump needs the policy and a label", () => {
    expect(jumpDecision(policy, green({ labels: ["queue:urgent"] }))).toEqual({ jump: true, label: "queue:urgent", note: null });
    expect(jumpDecision(policy, green({ labels: ["other"] }))).toEqual({ jump: false, label: null, note: null });
    const never = jumpDecision(builtinPolicy(), green({ labels: ["queue:jump"] }));
    expect(never.jump).toBe(false);
  });

  test("describeRoute names each route", () => {
    expect(describeRoute({ kind: "direct", method: "squash" })).toBe("merge directly with squash");
    expect(describeRoute({ kind: "queue", method: "squash", jump: true, jumpLabel: "queue:jump" })).toContain("jump");
    expect(describeRoute({ kind: "blocked", reason: "x" })).toBe("no route: x");
  });
});

describe("GitHub readers", () => {
  const run = (code: number, stdout: string, stderr = "") => async () => ({ code, stdout, stderr });

  test("parseMutationReply reads errors from stdout, then the exit code", () => {
    expect(parseMutationReply({ code: 0, stdout: '{"data":{}}', stderr: "" })).toEqual({ ok: true });
    expect(parseMutationReply({ code: 1, stdout: '{"errors":[{"message":"Nope"}]}', stderr: "gh: Nope" })).toEqual({ ok: false, message: "Nope" });
    expect(parseMutationReply({ code: 1, stdout: "", stderr: "gh: HTTP 502\nmore" })).toEqual({ ok: false, message: "gh: HTTP 502" });
    expect(parseMutationReply({ code: 0, stdout: '{"errors":[{"message":"late"}]}', stderr: "" }).ok).toBe(false);
  });

  test("a long error message is cut to one short line", () => {
    const reply = parseMutationReply({ code: 1, stdout: JSON.stringify({ errors: [{ message: `a\n${"b".repeat(500)}` }] }), stderr: "" });
    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.message.length).toBeLessThanOrEqual(300);
      expect(reply.message).not.toContain("\n");
    }
  });

  test("readQueueMethod reads the merge queue rule", async () => {
    const rules = (...parameters: unknown[]) => JSON.stringify(parameters.map((p) => ({ type: "merge_queue", parameters: p })));
    expect(await readQueueMethod(run(0, rules({ merge_method: "SQUASH" })), repo, "main")).toEqual({ known: true, method: "squash" });
    expect(await readQueueMethod(run(0, rules({ merge_method: "REBASE" })), repo, "main")).toEqual({ known: true, method: "rebase" });
    expect((await readQueueMethod(run(0, rules({})), repo, "main")).known).toBe(false);
    expect((await readQueueMethod(run(0, rules({ merge_method: "SQUASH" }, { merge_method: "MERGE" })), repo, "main")).known).toBe(false);
    expect((await readQueueMethod(run(0, "[]"), repo, "main")).known).toBe(false);
    expect((await readQueueMethod(run(0, "not json"), repo, "main")).known).toBe(false);
    expect((await readQueueMethod(run(1, "", "boom"), repo, "main")).known).toBe(false);
  });

  test("readChangedFiles gives the new and the old path of each file", async () => {
    const page = JSON.stringify([{ filename: "ci-old/gate.yml", previous_filename: ".github/workflows/gate.yml" }, { filename: "src/a.rs" }]);
    expect(await readChangedFiles(run(0, page), repo, 7)).toEqual({ known: true, files: ["ci-old/gate.yml", ".github/workflows/gate.yml", "src/a.rs"] });
  });

  test("readChangedFiles follows pages and gives up at 3000 files", async () => {
    const pages: string[] = [];
    const fullPage = (n: number) => JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ filename: `f${n}-${i}` })));
    const reader = async (args: readonly string[]) => {
      pages.push(args[3] ?? "");
      const page = Number(/[?&]page=(\d+)/.exec(args[3] ?? "")?.[1]);
      return { code: 0, stdout: page === 3 ? JSON.stringify([{ filename: "last" }]) : fullPage(page), stderr: "" };
    };
    const found = await readChangedFiles(reader, repo, 7);
    expect(found.known && found.files.length).toBe(201);
    expect(pages).toHaveLength(3);
    const endless = await readChangedFiles(async () => ({ code: 0, stdout: fullPage(1), stderr: "" }), repo, 7);
    expect(endless.known).toBe(false);
  });

  test("readChangedFiles reports a failed or unreadable page as unknown", async () => {
    expect(await readChangedFiles(run(1, "", "gh: Server Error\nx"), repo, 7)).toEqual({ known: false, reason: "gh: Server Error" });
    expect((await readChangedFiles(run(0, "not json"), repo, 7)).known).toBe(false);
    expect((await readChangedFiles(run(0, JSON.stringify([{ nope: 1 }])), repo, 7)).known).toBe(false);
  });
});
