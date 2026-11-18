import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, parseArgs } from "../lib/threads/cli.ts";
import { AGENT, FIX_COMMIT, REPO, World, type ThreadSpec } from "./helpers/threads-world.ts";

const noSleep = async (): Promise<void> => undefined;
const tmp = mkdtempSync(join(tmpdir(), "threads-cli-"));
afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const SPECS: readonly ThreadSpec[] = [
  { id: "T-fix", comments: [{ author: "review-bot", body: "P1: this drops data" }] },
  { id: "T-defer", comments: [{ author: "review-bot", body: "P3: naming" }] },
  { id: "T-question", comments: [{ author: "reviewer-1", body: "Why not use a map?" }] },
];

async function run(argv: readonly string[], w: World): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, {
    cwd: "/",
    runGh: w.gh().run,
    mutate: w.mutate,
    sleep: noSleep,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

function decisionsFile(decisions: readonly unknown[]): string {
  const path = join(tmp, `d-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify({ schema: 1, decisions }));
  return path;
}

const base = ["7", "--repo", REPO];

describe("parseArgs", () => {
  test("reads a plan and an apply", () => {
    expect(parseArgs(["7", "plan"]).ok).toBe(true);
    const apply = parseArgs(["#7", "apply", "--decisions", "d.json", "--json", "--git-dir", "/x"]);
    expect(apply.ok && apply.args).toMatchObject({ number: 7, mode: "apply", decisions: "d.json", json: true, gitDir: "/x" });
  });
  for (const bad of [[], ["7"], ["plan"], ["7", "apply"], ["7", "plan", "--decisions", "d.json"], ["7", "plan", "--nope"], ["7", "plan", "--repo"]]) {
    test(`refuses ${JSON.stringify(bad)}`, () => {
      expect(parseArgs(bad).ok).toBe(false);
    });
  }
});

describe("plan", () => {
  test("lists every unresolved thread with its class; exit 20 while the agent must act", async () => {
    const r = await run([...base, "plan"], new World(SPECS));
    expect(r.code).toBe(20);
    expect(r.out).toContain("3 unresolved review threads");
    expect(r.out).toContain("T-fix [fix] bot review-bot");
    expect(r.out).toContain("T-defer [defer]");
    expect(r.out).toContain("T-question [human-question] person reviewer-1");
    expect(r.out).toContain("src/a.rs:");
  });

  test("--json prints a stable object", async () => {
    const r = await run([...base, "plan", "--json"], new World(SPECS));
    const json: unknown = JSON.parse(r.out);
    expect(json).toMatchObject({ schema: 1, mode: "plan", repo: REPO, number: 7, agent: AGENT, exit: 20 });
    expect(JSON.stringify(json)).toContain('"class":"human-question"');
  });

  test("exit 10 when only people can act, 0 when no thread is open", async () => {
    const waiting = new World([{ id: "T-q", comments: [{ author: "reviewer-1", body: "Why?" }, { author: AGENT, body: "Because." }] }]);
    expect((await run([...base, "plan"], waiting)).code).toBe(10);
    const none = new World([{ id: "T-r", resolved: true, comments: [{ author: "review-bot", body: "P3: x" }] }]);
    const r = await run([...base, "plan"], none);
    expect(r.code).toBe(0);
    expect(r.out).toContain("0 unresolved");
  });

  test("plan writes nothing", async () => {
    const w = new World(SPECS);
    await run([...base, "plan"], w);
    expect(w.ops).toEqual([]);
  });

  test("a comment cannot inject terminal control characters into the output", async () => {
    const w = new World([{ id: "T-e", comments: [{ author: "review-bot", body: "P3: \u001b[31mred\u001b]0;title\u0007 text" }] }]);
    const r = await run([...base, "plan"], w);
    expect(r.out).not.toContain("\u001b");
    expect(r.out).not.toContain("\u0007");
    expect(r.out).toContain("red");
  });

  test("a policy error is exit 2; a failed read is exit 20", async () => {
    const bad = new World(SPECS);
    bad.policy = "schema = 1\n[nope]\n";
    expect((await run([...base, "plan"], bad)).code).toBe(2);
    const w = new World(SPECS);
    const out: string[] = [];
    const code = await main([...base, "plan"], {
      cwd: "/",
      runGh: async () => ({ code: 1, stdout: "", stderr: "gh: boom" }),
      sleep: noSleep,
      out: (l) => out.push(l),
      err: (l) => out.push(l),
    });
    expect(code).toBe(20);
    expect(w.ops).toEqual([]);
  });
});

describe("apply", () => {
  test("applies a decisions file; exit 10 when only a person's question remains", async () => {
    const w = new World(SPECS);
    w.commits = [FIX_COMMIT];
    const path = decisionsFile([
      { id: "T-fix", action: "fix", reply: "Done.", fixCommit: FIX_COMMIT },
      { id: "T-defer", action: "defer" },
      { id: "T-question", action: "reply-only", reply: "Because X." },
    ]);
    const r = await run([...base, "apply", "--decisions", path], w);
    expect(r.code).toBe(10);
    expect(r.out).toContain("applied 3 decisions");
    expect(r.out).toContain("remaining unresolved: 1");
    expect(w.threads.map((t) => t.resolved)).toEqual([true, true, false]);
  });

  test("exit 0 when nothing remains", async () => {
    const w = new World([SPECS[1] as ThreadSpec]);
    const path = decisionsFile([{ id: "T-defer", action: "defer" }]);
    const r = await run([...base, "apply", "--decisions", path, "--json"], w);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ refused: false, aborted: null, remaining: [], exit: 0 });
  });

  test("exit 20 and no write when a decision is refused", async () => {
    const w = new World(SPECS);
    const path = decisionsFile([{ id: "T-fix", action: "defer" }]);
    const r = await run([...base, "apply", "--decisions", path], w);
    expect(r.code).toBe(20);
    expect(r.out).toContain("REFUSED");
    expect(w.ops).toEqual([]);
  });

  test("exit 2 for an unreadable or invalid decisions file", async () => {
    const w = new World(SPECS);
    expect((await run([...base, "apply", "--decisions", join(tmp, "missing.json")], w)).code).toBe(2);
    const bad = join(tmp, "bad.json");
    writeFileSync(bad, "{}");
    const r = await run([...base, "apply", "--decisions", bad], w);
    expect(r.code).toBe(2);
    expect(r.err).toContain("invalid decisions file");
    expect(w.ops).toEqual([]);
  });
});
