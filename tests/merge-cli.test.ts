import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { removeBodyFiles } from "../lib/body-file.ts";
import { HELP, main, parseArgs } from "../lib/merge/cli.ts";
import { EXIT } from "../lib/merge/types.ts";
import { graphqlError, makeWorld, type World } from "./helpers/merge-world.ts";
import { root } from "./helpers/status.ts";

afterEach(() => removeBodyFiles());

interface Run {
  readonly code: number;
  readonly out: string[];
  readonly err: string[];
}

async function run(world: World, argv: readonly string[]): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(argv, { io: world.io, cwd: "/", out: (l) => void out.push(l), err: (l) => void err.push(l) });
  return { code, out, err };
}

const REPO = ["--repo", "example-org/example-repo"] as const;

describe("arguments", () => {
  test("parses a step, a number, and the options", () => {
    const parsed = parseArgs(["watch", "#12", "--confirm", "12", "--repo", "a/b", "--json", "--interval", "30", "--timeout", "600", "--git-dir", "/x"]);
    expect(parsed).toEqual({
      ok: true,
      args: { step: "watch", number: 12, repo: "a/b", confirm: 12, json: true, gitDir: "/x", acceptRisk: false, reason: null, intervalSeconds: 30, timeoutSeconds: 600 },
    });
    const merge = parseArgs(["merge", "5", "--accept-risk"]);
    expect(merge.ok && merge.args.acceptRisk).toBe(true);
    const dequeue = parseArgs(["dequeue", "5", "--reason", "manual"]);
    expect(dequeue.ok && dequeue.args.reason).toBe("manual");
  });

  test.each([
    [[]],
    [["merge"]],
    [["7"]],
    [["bogus", "7"]],
    [["merge", "abc"]],
    [["merge", "0"]],
    [["merge", "7", "8"]],
    [["merge", "7", "--confirm"]],
    [["merge", "7", "--confirm", "abc"]],
    [["merge", "7", "--force"]],
    [["merge", "7", "--admin"]],
    [["merge", "7", "--policy", "x.toml"]],
    [["watch", "7", "--interval", "1"]],
    [["watch", "7", "--interval", "99999"]],
    [["watch", "7", "--timeout", "0"]],
    [["dequeue", "7", "--reason", "because"]],
  ] as const)("rejects %j", (argv) => {
    expect(parseArgs(argv).ok).toBe(false);
  });
});

describe("command line", () => {
  test("--help and -h exit 0 and list every exit code", async () => {
    for (const flag of ["--help", "-h"]) {
      const result = await run(makeWorld(), [flag]);
      expect(result.code).toBe(0);
      expect(result.out.join("\n")).toBe(HELP);
    }
    expect((await run(makeWorld(), ["merge", "7", "--help"])).code).toBe(0);
    for (const code of ["0   ", "10  ", "20  ", "3   ", "2   ", "1   "]) {
      expect(HELP).toContain(`\n  ${code}`);
    }
  });

  test("a usage error exits 2 and reads nothing", async () => {
    const world = makeWorld();
    for (const argv of [[], ["merge"], ["merge", "7", "--bogus"], ["bogus", "7"]]) {
      expect((await run(world, argv)).code).toBe(EXIT.usage);
    }
    expect(world.calls).toEqual([]);
  });

  test("a --confirm that differs from the PR number is refused before any read", async () => {
    const world = makeWorld();
    const result = await run(world, ["merge", "7", "--confirm", "8", ...REPO]);
    expect(result.code).toBe(EXIT.refused);
    expect(result.err.join("\n")).toContain("does not equal");
    expect(world.calls).toEqual([]);
    expect(world.mutations).toEqual([]);
  });

  test.each(["ready", "merge", "dequeue", "watch"] as const)("%s without --confirm writes nothing and exits 3", async (step) => {
    const world = makeWorld();
    world.pr = { isDraft: step === "ready" };
    if (step === "dequeue" || step === "watch") world.queue({});
    const result = await run(world, [step, "7", ...REPO]);
    expect(result.code).toBe(EXIT.refused);
    expect(result.out.join("\n")).toContain("plan:");
    expect(world.mutations).toEqual([]);
    expect(world.merges).toEqual([]);
    expect(world.comments).toEqual([]);
    expect(world.sleeps).toEqual([]);
  });

  test("merge with --confirm enters the queue and exits 10", async () => {
    const world = makeWorld();
    const result = await run(world, ["merge", "7", "--confirm", "7", ...REPO]);
    expect(result.code).toBe(EXIT.waiting);
    expect(result.out.at(-1)).toContain("result: queued (exit 10)");
    expect(world.mutations).toHaveLength(1);
  });

  test("a direct merge exits 0", async () => {
    const world = makeWorld({ hasQueue: false });
    expect((await run(world, ["merge", "7", "--confirm", "7", ...REPO])).code).toBe(EXIT.done);
  });

  test("a blocked PR exits 20", async () => {
    const world = makeWorld();
    world.pr = { isDraft: true };
    expect((await run(world, ["merge", "7", "--confirm", "7", ...REPO])).code).toBe(EXIT.blocked);
  });

  test("--json prints one object with the events and the verdict", async () => {
    const world = makeWorld();
    const result = await run(world, ["merge", "7", "--confirm", "7", "--json", ...REPO]);
    expect(result.out).toHaveLength(1);
    const parsed: unknown = JSON.parse(result.out[0] ?? "");
    expect(parsed).toMatchObject({ schema: 1, step: "merge", number: 7, exit: 10, outcome: "queued", repo: "example-org/example-repo" });
    expect(parsed).toHaveProperty("verdict.state");
    expect(parsed).toHaveProperty("events");
  });

  test("an invalid policy exits 2 and writes nothing", async () => {
    const world = makeWorld({ policyToml: "schema = 2\n" });
    const result = await run(world, ["merge", "7", "--confirm", "7", ...REPO]);
    expect(result.code).toBe(EXIT.usage);
    expect(world.mutations).toEqual([]);
  });

  test("an unknown repository exits 2", async () => {
    const result = await run(makeWorld(), ["merge", "7", "--confirm", "7"]);
    expect(result.code).toBe(EXIT.usage);
    expect(result.err.join("\n")).toContain("cannot find the repository");
  });

  test("a crash exits 1 with one line on stderr", async () => {
    const world = makeWorld();
    const out: string[] = [];
    const err: string[] = [];
    const boom = { ...world.io, mutate: async () => Promise.reject(new Error("boom")) };
    const code = await main(["merge", "7", "--confirm", "7", ...REPO], { io: boom, cwd: "/", out: (l) => void out.push(l), err: (l) => void err.push(l) });
    expect(code).toBe(1);
    expect(err).toEqual(["merge.ts failed: boom"]);
  });

  test("the comment file of a dequeue is removed at the end", async () => {
    const world = makeWorld();
    world.queue({});
    let path = "";
    const io = {
      ...world.io,
      runGh: async (args: readonly string[]) => {
        const at = args.indexOf("--body-file");
        if (at >= 0) path = args[at + 1] ?? "";
        return world.io.runGh(args);
      },
    };
    const code = await main(["dequeue", "7", "--confirm", "7", ...REPO], { io, cwd: "/", out: () => undefined, err: () => undefined });
    expect(code).toBe(EXIT.done);
    expect(path).not.toBe("");
    expect(existsSync(path)).toBe(false);
  });

  test("every documented exit code is one of 0, 10, 20, 3, 2", async () => {
    const seen = new Set<number>();
    const scenarios: readonly (readonly [(w: World) => void, readonly string[]])[] = [
      [() => undefined, ["merge", "7", "--confirm", "7"]],
      [() => undefined, ["merge", "7"]],
      [(w) => void (w.pr = { isDraft: true }), ["merge", "7", "--confirm", "7"]],
      [(w) => void w.queue({}), ["dequeue", "7", "--confirm", "7"]],
      [() => undefined, ["merge", "7", "--bogus"]],
      [(w) => void (w.policyToml = "schema = 9"), ["merge", "7", "--confirm", "7"]],
    ];
    for (const [setup, argv] of scenarios) {
      const world = makeWorld();
      setup(world);
      seen.add((await run(world, [...argv, ...REPO])).code);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 2, 3, 10, 20]);
  });
});

describe("safety", () => {
  test("no gh call of a full run uses a forbidden flag, and each merge pins the head", async () => {
    const world = makeWorld({ hasQueue: false });
    await run(world, ["merge", "7", "--confirm", "7", ...REPO]);
    const queued = makeWorld({ policyToml: '[merge]\njump = "labelled"\njump_labels = ["queue:jump"]\n' });
    queued.queue({});
    queued.pr = { ...queued.pr, mergeable: "CONFLICTING" };
    await run(queued, ["dequeue", "7", "--confirm", "7", ...REPO]);
    for (const call of [...world.calls, ...queued.calls]) {
      for (const token of call) {
        expect(["--admin", "--delete-branch", "-d", "--force", "--auto"]).not.toContain(token);
      }
    }
    for (const merge of world.merges) {
      expect(merge.some((t) => /^[0-9a-f]{40}$/.test(t))).toBe(true);
      expect(merge).toContain("--match-head-commit");
    }
  });

  test("the only mutations are enqueue, dequeue, and mark ready, and each argv is a constant document", async () => {
    const kinds = new Set<string>();
    const worlds: World[] = [];
    const a = makeWorld();
    await run(a, ["merge", "7", "--confirm", "7", ...REPO]);
    worlds.push(a);
    const b = makeWorld();
    b.queue({});
    b.pr = { ...b.pr, mergeable: "CONFLICTING" };
    await run(b, ["dequeue", "7", "--confirm", "7", ...REPO]);
    worlds.push(b);
    const c = makeWorld();
    c.pr = { isDraft: true };
    await run(c, ["ready", "7", "--confirm", "7", ...REPO]);
    worlds.push(c);
    for (const world of worlds) {
      for (const op of world.mutations) kinds.add(op.kind);
      for (const argv of world.mutationArgv) {
        expect(argv.slice(0, 2)).toEqual(["api", "graphql"]);
        expect(argv.filter((t) => t.startsWith("query=")).every((t) => /^query=mutation\(/.test(t))).toBe(true);
      }
    }
    expect([...kinds].sort()).toEqual(["dequeuePullRequest", "enqueuePullRequest", "markPullRequestReadyForReview"]);
  });

  test("an enqueue always carries expectedHeadOid", async () => {
    const world = makeWorld();
    await run(world, ["merge", "7", "--confirm", "7", ...REPO]);
    for (const argv of world.mutationArgv) {
      expect(argv.some((t) => /^expectedHeadOid=[0-9a-f]{40}$/.test(t))).toBe(true);
    }
  });

  test("the library code names no forbidden form and spawns nothing itself", () => {
    const dir = join(root, "lib", "merge");
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const text = readFileSync(join(dir, name), "utf8");
      expect(text).not.toMatch(/["'`]--(admin|delete-branch|force|auto)\b/);
      expect(text).not.toMatch(/Bun\.spawn|child_process|node:child|\bexec(Sync)?\(|\bspawn(Sync)?\(/);
      expect(text).not.toMatch(/\bmutation[ (]/);
      expect(text).not.toMatch(/"push"/);
    }
  });

  test("a refused jump leaves exactly one enqueue call in the argv log", async () => {
    const world = makeWorld({ policyToml: '[merge]\njump = "labelled"\njump_labels = ["queue:jump"]\n' });
    world.pr = { labels: { totalCount: 2, nodes: [{ name: "ci:auto" }, { name: "queue:jump" }] } };
    world.mutationReply.enqueuePullRequest = () => graphqlError("no jump");
    const result = await run(world, ["merge", "7", "--confirm", "7", ...REPO]);
    expect(result.code).toBe(EXIT.blocked);
    expect(world.mutationArgv.filter((a) => a.some((t) => t.includes("enqueuePullRequest")))).toHaveLength(1);
    expect(world.mutationArgv[0]).toContain("jump=true");
  });
});
