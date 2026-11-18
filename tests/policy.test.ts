import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fetchBasePolicy } from "../lib/policy/fetch.ts";
import { defaultPolicy, formatPolicyErrors, loadPolicy } from "../lib/policy/load.ts";
import type { PolicyResult } from "../lib/policy/types.ts";
import { parseRepoSlug, parseSha } from "../lib/types.ts";

const examples = join(import.meta.dir, "..", "examples");

function errorsOf(text: string): readonly string[] {
  const result = loadPolicy({ text, source: "local" });
  if (result.ok) {
    throw new Error("expected the policy to fail");
  }
  return result.errors.map((e) => `${e.pointer}: ${e.message}`);
}

function policyOf(result: PolicyResult) {
  if (!result.ok) {
    throw new Error(formatPolicyErrors(result.errors));
  }
  return result.policy;
}

describe("loadPolicy", () => {
  test("schema = 1 gives the documented defaults", () => {
    const result = loadPolicy({ text: "schema = 1\n", source: "base-branch" });
    expect(result.ok && result.source).toBe("base-branch");
    const policy = policyOf(result);
    expect(policy.branches.protected).toEqual(["main"]);
    expect(policy.checks.flaky_reruns).toBe(1);
    expect(policy.review.source).toBe("github-approval");
    expect(policy.review.flags).toBe("im");
    expect(policy.review.max_carry_merges).toBe(3);
    expect(policy.dco.required).toBe(true);
    expect(policy.merge.method).toBe("squash");
    expect(policy.draft.create_as_draft).toBe(true);
    expect(policy.ci.congestion_queue_length).toBe(5);
    expect(policy.issues.done_when).toBe("warn");
    expect(policy.pr_body.sections).toEqual(["Why", "What", "Proof", "Done when"]);
    expect(policy.prepush).toEqual([]);
    expect(policy.fleet).toEqual({ freeze: false, hold: [] });
  });

  test("defaultPolicy equals the minimal file", () => {
    const fromFile = policyOf(loadPolicy({ text: "schema = 1\n", source: "local" }));
    expect(policyOf(defaultPolicy())).toEqual(fromFile);
  });

  test("applies per-item defaults to array tables", () => {
    const policy = policyOf(
      loadPolicy({
        text: 'schema = 1\n[[prepush]]\nname = "fmt"\nrun = ["cargo", "fmt"]\n[[inventories]]\nname = "i"\nfile = "x.txt"\n',
        source: "local",
      }),
    );
    expect(policy.prepush).toEqual([{ name: "fmt", run: ["cargo", "fmt"], cwd: ".", when_changed: [] }]);
    expect(policy.inventories[0]?.group_depth).toBe(2);
  });

  test("both examples load", async () => {
    for (const name of ["minimal.toml", "comment-verdict-merge-queue.toml"]) {
      const text = await Bun.file(join(examples, name)).text();
      const result = loadPolicy({ text, source: "local" });
      expect(result.ok ? "ok" : formatPolicyErrors(result.errors)).toBe("ok");
    }
  });

  test("the merge-queue example holds the documented process", async () => {
    const text = await Bun.file(join(examples, "comment-verdict-merge-queue.toml")).text();
    const policy = policyOf(loadPolicy({ text, source: "local" }));
    expect(policy.review.source).toBe("comment-verdict");
    expect(policy.review.carry_over).toBe("clean-base-merge");
    expect(policy.review.max_carry_merges).toBe(3);
    expect(policy.checks.required).toEqual(["Required", "Required verdict"]);
    expect(policy.threads.bots).toContain("chatgpt-codex-connector");
    expect(policy.dco.bot_authors).toEqual(["renovate[bot]", "dependabot[bot]"]);
    expect(policy.labels).toEqual({ pr_ci: "label", run_once: "ci:run", run_always: "ci:auto" });
    expect(policy.ci).toEqual({ congestion_queue_length: 5, max_refreshes: 2, max_refreshes_congested: 0 });
    expect(policy.prepush.map((s) => s.name)).toEqual(["fmt", "clippy"]);
    const approve = new RegExp(policy.review.approve_pattern, policy.review.flags);
    expect(approve.test("Verdict: approve")).toBe(true);
    expect(approve.test("Verdict: changes needed")).toBe(false);
    const changes = new RegExp(policy.review.changes_pattern, policy.review.flags);
    expect(changes.test("Verdict: changes needed")).toBe(true);
  });

  test("a missing schema key is an error with a pointer", () => {
    expect(errorsOf("[branches]\n")).toEqual(["/schema: is required"]);
  });

  test("a wrong schema version is an error", () => {
    expect(errorsOf("schema = 2\n")).toEqual(["/schema: must equal 1"]);
  });

  test("a typo in a key fails closed", () => {
    expect(errorsOf("schema = 1\n[review]\ncarryover = 'none'\n")).toEqual(["/review/carryover: is not a known key"]);
    expect(errorsOf("schema = 1\n[mrege]\n")).toEqual(["/mrege: is not a known key"]);
    expect(errorsOf("schema = 1\n[[prepush]]\nname = 'a'\nrun = ['x']\nwhen_change = []\n")).toEqual([
      "/prepush/0/when_change: is not a known key",
    ]);
  });

  test("a wrong enum value is an error", () => {
    const errors = errorsOf("schema = 1\n[merge]\nmethod = 'fast-forward'\n");
    expect(errors).toEqual(['/merge/method: must be one of "squash", "merge", "rebase"']);
  });

  test("a wrong type is an error", () => {
    expect(errorsOf("schema = 1\n[ci]\nmax_refreshes = '2'\n")).toEqual(["/ci/max_refreshes: must be of type integer"]);
    expect(errorsOf("schema = 1\n[fleet]\nhold = [1, 1]\n")).toEqual(["/fleet/hold/1: must not repeat an earlier item"]);
  });

  test("a regex that does not compile is an error", () => {
    const errors = errorsOf("schema = 1\n[review]\nblocking_pattern = '('\n");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("/review/blocking_pattern: does not compile as a regular expression");
    expect(errorsOf("schema = 1\n[threads]\nfix_pattern = '[a'\n")[0]).toContain("/threads/fix_pattern");
    expect(errorsOf("schema = 1\n[branches]\nname_pattern = '(?i)x'\n")[0]).toContain("/branches/name_pattern");
  });

  test("regex flags are limited to safe ones", () => {
    expect(errorsOf("schema = 1\n[review]\nflags = 'g'\n")).toEqual(["/review/flags: must match pattern ^[imsu]*$"]);
  });

  test("comment-verdict needs both verdict patterns", () => {
    expect(errorsOf("schema = 1\n[review]\nsource = 'comment-verdict'\n")).toEqual([
      '/review/approve_pattern: is required when review.source is "comment-verdict"',
      '/review/changes_pattern: is required when review.source is "comment-verdict"',
    ]);
  });

  test("carry-over needs comment-verdict", () => {
    expect(errorsOf("schema = 1\n[review]\ncarry_over = 'clean-base-merge'\n")).toHaveLength(1);
  });

  test("label CI and labelled jump need their labels", () => {
    expect(errorsOf("schema = 1\n[labels]\npr_ci = 'label'\n")).toHaveLength(1);
    expect(errorsOf("schema = 1\n[merge]\njump = 'labelled'\n")).toHaveLength(1);
  });

  test("names are unique and cwd stays inside the repository", () => {
    const duplicate = "schema = 1\n[[gates]]\nname='a'\nkind='label-absent'\nvalue='x'\n[[gates]]\nname='a'\nkind='label-absent'\nvalue='y'\n";
    expect(errorsOf(duplicate)).toEqual(['/gates/1/name: duplicate name "a"']);
    expect(errorsOf("schema = 1\n[[prepush]]\nname='a'\nrun=['x']\ncwd='../x'\n")).toHaveLength(1);
    expect(errorsOf("schema = 1\n[[prepush]]\nname='a'\nrun=['x']\ncwd='/etc'\n")).toHaveLength(1);
  });

  test("required keys of array tables", () => {
    expect(errorsOf("schema = 1\n[[regenerate]]\nname='a'\nrun=['x']\n")).toEqual(["/regenerate/0/outputs: is required"]);
    expect(errorsOf("schema = 1\n[[prepush]]\nname='a'\nrun=[]\n")).toEqual(["/prepush/0/run: must have at least 1 item"]);
  });

  test("TOML syntax errors and dates are reported, not thrown", () => {
    expect(errorsOf("schema = ")[0]).toContain("TOML syntax error");
    expect(errorsOf("schema = 1\nwhen = 2026-01-01\n")[0]).toContain("JSON cannot express");
  });

  test("reports several errors at once", () => {
    const errors = errorsOf("schema = 1\n[merge]\nmethod = 'x'\n[ci]\nbogus = 1\n");
    expect(errors).toHaveLength(2);
  });
});

describe("fetchBasePolicy", () => {
  const repo = parseRepoSlug("example-org/example-repo");
  const sha = parseSha("a".repeat(40));
  if (!repo.ok || !sha.ok) {
    throw new Error("bad fixture");
  }

  test("calls gh api with the raw accept header, pinned to the base sha", async () => {
    let seen: readonly string[] = [];
    const result = await fetchBasePolicy(repo.value, sha.value, {
      cwd: ".",
      runGh: async (args) => {
        seen = args;
        return { code: 0, stdout: "schema = 1\n[merge]\nmethod = 'merge'\n", stderr: "" };
      },
    });
    expect(result.ok && result.source).toBe("base-branch");
    expect(policyOf(result).merge.method).toBe("merge");
    expect(seen).toEqual([
      "api",
      "-H",
      "Accept: application/vnd.github.raw+json",
      `repos/example-org/example-repo/contents/.config/pr-policy.toml?ref=${"a".repeat(40)}`,
    ]);
  });

  test("404 gives the defaults with source default", async () => {
    const result = await fetchBasePolicy(repo.value, sha.value, {
      cwd: ".",
      runGh: async () => ({ code: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" }),
    });
    expect(result.ok && result.source).toBe("default");
    expect(policyOf(result)).toEqual(policyOf(defaultPolicy()));
  });

  test("other gh errors are reported", async () => {
    const result = await fetchBasePolicy(repo.value, sha.value, {
      cwd: ".",
      runGh: async () => ({ code: 1, stdout: "", stderr: "gh: Bad credentials (HTTP 401)" }),
    });
    expect(result.ok).toBe(false);
  });

  test("an invalid policy on the base branch is an error, not a default", async () => {
    const result = await fetchBasePolicy(repo.value, sha.value, {
      cwd: ".",
      runGh: async () => ({ code: 0, stdout: "schema = 1\nbogus = 1\n", stderr: "" }),
    });
    expect(result.ok).toBe(false);
  });

  test("the fetch command passes the gh allow-list", async () => {
    const { checkGh } = await import("../lib/safety.ts");
    const guard = checkGh([
      "api",
      "-H",
      "Accept: application/vnd.github.raw+json",
      `repos/${repo.value}/contents/.config/pr-policy.toml?ref=${sha.value}`,
    ]);
    expect(guard.allowed).toBe(true);
  });
});
