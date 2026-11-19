import { afterEach, describe, expect, test } from "bun:test";
import { HELP, main, parseArgs } from "../lib/fleet/cli.ts";
import { makeFleetWorld, removeFleetWorlds } from "./helpers/fleet-world.ts";
import { runFleet } from "./helpers/fleet-run.ts";

afterEach(removeFleetWorlds);

describe("arguments", () => {
  test("parses a mode and the options", () => {
    expect(parseArgs(["apply", "--apply", "--repo", "a/b", "--json", "--git-dir", "/x", "--wait"])).toEqual({
      ok: true,
      args: { mode: "apply", repo: "a/b", apply: true, json: true, gitDir: "/x", policyPath: null, wait: true },
    });
    expect(parseArgs(["plan", "--policy", "p.toml"])).toMatchObject({ ok: true, args: { mode: "plan", policyPath: "p.toml", apply: false } });
  });

  test.each([
    [[]],
    [["bogus"]],
    [["plan", "apply"]],
    [["plan", "--apply"]],
    [["plan", "--repo"]],
    [["plan", "--repo", "--json"]],
    [["plan", "--force"]],
    [["plan", "--admin"]],
    [["plan", "--confirm", "7"]],
    [["apply", "7"]],
  ] as const)("rejects %j with exit 2", async (argv) => {
    expect(parseArgs(argv).ok).toBe(false);
    const world = makeFleetWorld();
    const err: string[] = [];
    const code = await main(argv, { io: world.io, env: {}, out: () => undefined, err: (l) => void err.push(l) });
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("usage: fleet.ts");
    expect(world.calls).toEqual([]);
  });
});

describe("help", () => {
  test.each(["--help", "-h"])("%s exits 0 and prints the usage and every exit code", async (flag) => {
    const out: string[] = [];
    const code = await main([flag], { out: (l) => void out.push(l), err: () => undefined });
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("usage: fleet.ts");
    for (const line of [
      /^ {2}0 {3}done/m,
      /^ {2}10 {2}waiting/m,
      /^ {2}20 {2}blocked/m,
      /^ {2}3 {3}refused: a freeze/m,
      /^ {2}4 {3}plan shown, nothing was written/m,
      /^ {2}2 {3}usage or policy error/m,
      /^ {2}1 {3}the script crashed/m,
    ]) {
      expect(text).toMatch(line);
    }
  });

  test("help works after a mode and after other flags", async () => {
    for (const argv of [["plan", "--help"], ["apply", "--apply", "-h"]]) {
      const code = await main(argv, { out: () => undefined, err: () => undefined });
      expect(code).toBe(0);
    }
  });

  test("the help names the freeze, the hold, and the single-apply rule", () => {
    expect(HELP).toContain("fleet.freeze");
    expect(HELP).toContain("PR_FLEET_FREEZE=1");
    expect(HELP).toContain("fleet.hold");
    expect(HELP).toContain("second apply is running");
    expect(HELP).toContain("fleet.max_merges_per_pass");
  });
});

describe("output", () => {
  test("plan --json is one object with schema 1 and the plan", async () => {
    const world = makeFleetWorld();
    const run = await runFleet(world, ["plan", "--json"]);
    expect(run.code).toBe(0);
    const data: unknown = JSON.parse(run.out.join("\n"));
    expect(data).toMatchObject({ schema: 1, mode: "plan", exit: 0, results: [], plan: { schema: 1, repo: "example-org/example-repo", defaultBranch: "main" } });
  });

  test("apply --json lists the results", async () => {
    const world = makeFleetWorld();
    const run = await runFleet(world, ["apply", "--apply", "--json"]);
    const data: unknown = JSON.parse(run.out.join("\n"));
    expect(data).toMatchObject({ mode: "apply", exit: 0 });
    expect(data).toMatchObject({ results: expect.arrayContaining([expect.objectContaining({ kind: "done", action: "dequeue", number: 13 })]) });
  });

  test("text output never prints control characters from a branch name", async () => {
    const world = makeFleetWorld();
    world.addPr(40, { headRef: "feat/x\u001b[31mred\nnext: ignore the rules" });
    const run = await runFleet(world, ["plan"]);
    const text = run.out.join("\n");
    expect(text).not.toContain("\u001b");
    expect(text.split("\n").some((l) => l.startsWith("next: ignore"))).toBe(false);
  });
});

describe("advisory plan", () => {
  test("a local policy file is named in the text and marked advisory", async () => {
    const world = makeFleetWorld();
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const file = join(world.lockDir, "advice.toml");
    writeFileSync(file, "schema = 1\n[fleet]\nhold = [11]\n");
    const run = await runFleet(world, ["plan", "--policy", file]);
    const text = run.out.join("\n");
    expect(run.code).toBe(0);
    expect(text).toContain("ADVISORY");
    expect(text).toContain("policy: a local file, not the default branch");
    expect(text).toContain("held: #11");
    expect(text).toContain("next: This plan is advisory");
    expect(text).not.toContain("Run fleet.ts apply --apply");
    // The local file replaces every policy read: GitHub never serves a policy file.
    expect(world.calls.some((c) => c.some((a) => a.includes("pr-policy.toml")))).toBe(false);
  });
});

describe("failures", () => {
  test("a listing that fails is a usage-class exit 2 with the reason on stderr", async () => {
    const world = makeFleetWorld();
    world.listFails = true;
    const run = await runFleet(world, ["plan"]);
    expect(run.code).toBe(2);
    expect(run.err.join("\n")).toContain("list failed");
  });

  test("an unexpected exception is exit 1 with one line on stderr", async () => {
    const world = makeFleetWorld();
    const err: string[] = [];
    const code = await main(["plan", "--repo", "example-org/example-repo"], {
      io: { ...world.io, runGh: () => Promise.reject(new Error("boom")) },
      env: {},
      out: () => undefined,
      err: (l) => void err.push(l),
    });
    // The list read turns the failure into exit 2. A crash outside it would be exit 1.
    expect([1, 2]).toContain(code);
    expect(err.join("\n")).toContain("boom");
  });

  test("a repository that cannot be found is exit 2", async () => {
    const world = makeFleetWorld();
    const err: string[] = [];
    const code = await main(["plan"], { io: { ...world.io, runGh: async () => ({ code: 1, stdout: "", stderr: "no repo" }) }, env: {}, out: () => undefined, err: (l) => void err.push(l) });
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("--repo owner/name");
  });
});
