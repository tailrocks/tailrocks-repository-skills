import { afterEach, describe, expect, test } from "bun:test";
import { configFor } from "../lib/merge/evaluate.ts";
import { statusFor } from "../lib/status/run.ts";
import { makeWorld, removeWorlds } from "./helpers/merge-world.ts";

afterEach(removeWorlds);

const policyCalls = (calls: readonly string[][]) => calls.filter((c) => c.some((a) => a.includes("pr-policy.toml"))).length;

describe("reading the policy for a verdict", () => {
  test("a failed read is an unknown state, not an invalid policy, and it is never cached", async () => {
    const world = makeWorld();
    const ctx = world.context();
    const config = configFor(ctx);
    world.policyFails = 1;
    const first = await statusFor(ctx.repo, 7, config);
    expect(first.kind).toBe("verdict");
    if (first.kind === "verdict") {
      expect(first.verdict.state).toBe("BLOCKED");
      expect(first.verdict.findings.map((f) => f.code)).toEqual(["unknown_state"]);
      expect(first.verdict.findings[0]?.detail).toContain("502");
      expect(first.snapshot).toBeNull();
    }
    const second = await statusFor(ctx.repo, 7, config);
    expect(second.kind).toBe("verdict");
    if (second.kind === "verdict") expect(second.verdict.state).toBe("READY");
    expect(policyCalls(world.calls)).toBe(2);
  });

  test("a thrown error in the runner is also a failed read", async () => {
    const world = makeWorld();
    const ctx = world.context();
    let thrown = false;
    const io = {
      ...world.io,
      runGh: async (args: readonly string[]) => {
        if (args.some((a) => a.includes("pr-policy.toml")) && !thrown) {
          thrown = true;
          throw new Error("network down");
        }
        return world.io.runGh(args);
      },
    };
    const config = configFor({ ...ctx, io });
    const first = await statusFor(ctx.repo, 7, config);
    expect(first.kind === "verdict" && first.verdict.findings[0]?.code).toBe("unknown_state");
    const second = await statusFor(ctx.repo, 7, config);
    expect(second.kind === "verdict" && second.verdict.state).toBe("READY");
  });

  test("a file that was read and is invalid is a policy error, and the answer is kept", async () => {
    const world = makeWorld({ policyToml: "schema = 9\n" });
    const ctx = world.context();
    const config = configFor(ctx);
    expect((await statusFor(ctx.repo, 7, config)).kind).toBe("policy-error");
    expect((await statusFor(ctx.repo, 7, config)).kind).toBe("policy-error");
    expect(policyCalls(world.calls)).toBe(1);
  });
});
