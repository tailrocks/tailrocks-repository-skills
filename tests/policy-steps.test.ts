import { describe, expect, test } from "bun:test";
import { inventoryApplies, inventoryFix, inventoryMisses, runPrepushSteps, signoffRequired, tailLines, TAIL_LINES } from "../lib/policy-steps.ts";
import type { PolicyInventory, PolicyPrepushStep } from "../lib/policy/types.ts";
import { builtinPolicy, policyFromText } from "./helpers/status.ts";

const signed = "feat: x\n\nSigned-off-by: Dev A <dev-a@example.invalid>\n";
const unsigned = "feat: x\n";

describe("signoffRequired", () => {
  test("an unsigned commit needs a sign-off, a signed one does not", () => {
    const policy = builtinPolicy();
    expect(signoffRequired(policy, unsigned, false)).toBe(true);
    expect(signoffRequired(policy, signed, false)).toBe(false);
  });

  test("a bot author is exempt only when the policy says exempt", () => {
    const exempt = policyFromText('schema = 1\n[dco]\nbot_authors = ["dependency-bot[bot]"]\nbot_commits = "exempt"\n');
    const rewrite = policyFromText('schema = 1\n[dco]\nbot_authors = ["dependency-bot[bot]"]\nbot_commits = "rewrite"\n');
    expect(signoffRequired(exempt, unsigned, true)).toBe(false);
    expect(signoffRequired(exempt, unsigned, false)).toBe(true);
    expect(signoffRequired(rewrite, unsigned, true)).toBe(true);
  });

  test("dco.required = false never needs a sign-off", () => {
    expect(signoffRequired(policyFromText("schema = 1\n[dco]\nrequired = false\n"), unsigned, false)).toBe(false);
  });
});

const inventory: PolicyInventory = {
  name: "sources",
  file: "inv.txt",
  added: ["src/**"],
  exclude: ["src/**/tests/**"],
  update: [],
  group_depth: 2,
};

describe("inventories", () => {
  test("a file of a listed group that the inventory misses is reported", () => {
    expect(inventoryMisses(inventory, ["src/core/one.ts", "src/core/two.ts", "src/core/tests/t.ts", "src/other/x.ts"], "src/core/one.ts\n")).toEqual(["src/core/two.ts"]);
  });

  test("an inventory applies only when an added file is covered and not excluded", () => {
    expect(inventoryApplies(inventory, ["src/core/one.ts"])).toBe(true);
    expect(inventoryApplies(inventory, ["src/core/tests/t.ts", "README.md"])).toBe(false);
  });

  test("the fix names the update command when the policy has one", () => {
    expect(inventoryFix(inventory, "then run again")).toBe("add them to inv.txt, then run again");
    expect(inventoryFix({ ...inventory, update: ["make", "inv"] }, "then run again")).toBe("add them to inv.txt (the policy update command is: make inv), then run again");
  });
});

function step(name: string, whenChanged: readonly string[] = []): PolicyPrepushStep {
  return { name, run: ["true"], cwd: ".", when_changed: whenChanged };
}

describe("runPrepushSteps", () => {
  test("runs every step in order, and a step with when_changed only when a changed file matches", async () => {
    const seen: string[] = [];
    const outcome = await runPrepushSteps([step("a"), step("b", ["docs/**"]), step("c", ["src/**"])], ["src/x.ts"], async (s) => {
      seen.push(s.name);
      return { code: 0, output: "" };
    });
    expect(seen).toEqual(["a", "c"]);
    expect(outcome).toEqual({ ran: ["a", "c"], failure: null });
  });

  test("the first failure stops the run, is counted as run, and carries the exit code and the output tail", async () => {
    const output = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const outcome = await runPrepushSteps([step("a"), step("b"), step("c")], [], async (s) => (s.name === "b" ? { code: 3, output } : { code: 0, output: "" }));
    expect(outcome.ran).toEqual(["a", "b"]);
    expect(outcome.failure?.step.name).toBe("b");
    expect(outcome.failure?.code).toBe(3);
    expect(outcome.failure?.tail).toHaveLength(TAIL_LINES);
    expect(outcome.failure?.tail.at(-1)).toBe("line 29");
  });

  test("tailLines drops empty lines", () => {
    expect(tailLines("a\n\n  \nb\n", 5)).toEqual(["a", "b"]);
  });
});
