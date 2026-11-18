import { afterEach, describe, expect, test } from "bun:test";
import { configFor, evaluateFresh } from "../lib/merge/evaluate.ts";
import { statusFor } from "../lib/status/run.ts";
import { readThreadState } from "../lib/threads/state.ts";
import { makeWorld, removeWorlds } from "./helpers/merge-world.ts";
import { REPO, World } from "./helpers/threads-world.ts";
import { BASE, sha } from "./helpers/status.ts";

afterEach(removeWorlds);

// A stacked PR: its base is the branch of a parent PR, at a commit that is not the default branch tip.
const PARENT = sha("d");
const STACKED = { baseRefName: "topic-base", baseRefOid: PARENT };
const LOOSE = 'schema = 1\n[branches]\nbases = ["topic-base"]\n';
const STRICT = "schema = 1\n";

function refOf(args: readonly string[]): string | null {
  const endpoint = args.find((a) => a.includes("pr-policy.toml"));
  return endpoint === undefined ? null : (/[?&]ref=([0-9a-f]+)/.exec(endpoint)?.[1] ?? "");
}

/** A runner that serves the loose policy at the parent commit and the strict one at the default commit. */
function byRef(inner: (args: readonly string[]) => Promise<{ code: number; stdout: string; stderr: string }>, seen: string[]) {
  return async (args: readonly string[]) => {
    const ref = refOf(args);
    if (ref === null) {
      return inner(args);
    }
    seen.push(ref);
    return { code: 0, stdout: ref === PARENT ? LOOSE : STRICT, stderr: "" };
  };
}

describe("the policy comes from the default branch, never from a stacked parent", () => {
  test("pr-status ignores the looser policy on the parent branch", async () => {
    const world = makeWorld();
    world.pr = STACKED;
    const ctx = world.context();
    const seen: string[] = [];
    const config = configFor({ ...ctx, io: { ...world.io, runGh: byRef(world.io.runGh, seen) } });
    const result = await statusFor(ctx.repo, 7, config);
    expect(result.kind).toBe("verdict");
    if (result.kind !== "verdict") return;
    expect(result.verdict.findings.map((f) => f.code)).toContain("wrong_base");
    expect(result.verdict.state).toBe("BLOCKED");
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((r) => r === BASE)).toBe(true);
  });

  test("pr-merge reads the same default-branch policy and refuses the stacked PR", async () => {
    const world = makeWorld();
    world.pr = STACKED;
    const ctx = world.context();
    const seen: string[] = [];
    const runGh = byRef(world.io.runGh, seen);
    const fresh = await evaluateFresh({ ...ctx, io: { ...world.io, runGh } });
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    expect(fresh.evaluated.verdict.findings.map((f) => f.code)).toContain("wrong_base");
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((r) => r === BASE)).toBe(true);
  });

  test("pr-threads reads the policy at the default branch commit", async () => {
    const w = new World([{ id: "T1", comments: [{ author: "review-bot", body: "P1: x" }] }]);
    w.prPatch = STACKED;
    const seen: string[] = [];
    const result = await readThreadState(REPO, 7, { cwd: "/", runGh: byRef(w.gh().run, seen), sleep: async () => undefined });
    expect(result.ok).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((r) => r === BASE)).toBe(true);
  });
});
