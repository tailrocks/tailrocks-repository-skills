import { describe, expect, test } from "bun:test";
import { isPushableBranch, parseArgs } from "../lib/create/args.ts";
import {
  bodyChecks,
  buildSkeleton,
  decideLink,
  finalBody,
  parseIssueBoxes,
  requiredHeadings,
  stripAuthoringComments,
  templatePlaceholders,
  unmappedBoxes,
} from "../lib/create/body.ts";
import { branchProblem, inventoryMisses, remoteRepoSlug, unsignedCommits, type CommitInfo } from "../lib/create/checks.ts";
import { EXIT, EXIT_TABLE } from "../lib/create/exit.ts";
import { secretLineNumbers } from "../lib/proc.ts";
import { HELP, main } from "../lib/create/cli.ts";
import type { Policy } from "../lib/policy/types.ts";
import { sha } from "./helpers/status.ts";
import { builtinPolicy, examplePolicy, policyFromText } from "./helpers/status.ts";

const HEAD = "a".repeat(40);

function ok(...argv: string[]) {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  return parsed.args;
}

function bad(...argv: string[]): string {
  const parsed = parseArgs(argv);
  return parsed.ok ? "ok" : parsed.message;
}

describe("arguments", () => {
  test("plan and open parse; open needs the expected head", () => {
    expect(ok("plan").mode).toBe("plan");
    expect(ok("plan", "--issue", "#12", "--label", "a", "--label", "b", "--part-of", "--run-ci").labels).toEqual(["a", "b"]);
    expect(ok("plan", "--issue", "#12").issue).toBe(12);
    expect(bad("open")).toContain("--expect-head");
    expect(bad("signoff")).toContain("--expect-head");
    expect(ok("signoff", "--expect-head", HEAD).mode).toBe("signoff");
    expect(bad("plan", "--allow-unsigned-pushed")).toContain("unknown argument");
    expect(ok("open", "--expect-head", HEAD).expectHead).toBe(HEAD);
    expect(bad("plan", "--expect-head", HEAD)).toContain("plan takes no");
  });

  test("bad input is a usage error", () => {
    expect(bad()).toContain("give a mode");
    expect(bad("plan", "open")).toContain("one mode");
    expect(bad("plan", "--nope")).toContain("unknown argument");
    expect(bad("plan", "--issue", "x")).toContain("issue number");
    expect(bad("plan", "--issue", "0")).toContain("issue number");
    expect(bad("plan", "--expect-head", "abc")).toContain("40-character");
    expect(bad("plan", "--branch")).toContain("needs a value");
    expect(bad("plan", "--branch", "--json")).toContain("needs a value");
    expect(bad("plan", "--branch", "a..b")).toContain("plain branch name");
    expect(bad("plan", "--base", "-x")).toContain("plain branch name");
    expect(bad("plan", "--repo", "nope")).toContain("owner/name");
    expect(bad("plan", "--remote", "a b")).toContain("plain remote name");
    expect(bad("plan", "--label", "a,b")).toContain("without commas");
    expect(bad("plan", "--title", "a", "--title", "b")).toContain("twice");
  });

  test("the branch check is the push guard", () => {
    expect(isPushableBranch("feat/x-1.2")).toBe(true);
    for (const name of ["", "a..b", "a//b", "-x", "a b", "x.lock", "a/", "a@{1}", "+x", "a:b"]) {
      expect(isPushableBranch(name)).toBe(false);
    }
  });

  test("--help and -h exit 0 and print the exit table", async () => {
    for (const flag of ["--help", "-h"]) {
      const lines: string[] = [];
      const code = await main([flag], { out: (l) => lines.push(l) });
      expect(code).toBe(0);
      expect(lines.join("\n")).toBe(HELP);
    }
    expect(HELP).toContain(EXIT_TABLE);
    expect(EXIT).toEqual({ done: 0, usage: 2, refused: 3, changed: 4, act: 20 });
  });

  test("a usage error exits 2 and names the usage", async () => {
    const lines: string[] = [];
    const code = await main(["open"], { err: (l) => lines.push(l) });
    expect(code).toBe(2);
    expect(lines.join("\n")).toContain("usage: create.ts");
  });
});

describe("branch and remote checks", () => {
  const policy = builtinPolicy();
  test("the default and protected branches, and the name pattern", () => {
    expect(branchProblem("main", policy, "main")?.code).toBe("on_protected_branch");
    expect(branchProblem("release/1.x", examplePolicy(), "main")?.code).toBe("on_protected_branch");
    expect(branchProblem("work", policy, "main")?.code).toBe("branch_name");
    expect(branchProblem("fix/a-bug", policy, "main")).toBeNull();
  });

  test("remote URLs", () => {
    expect(remoteRepoSlug("https://github.com/example-org/example-repo.git")).toBe("example-org/example-repo");
    expect(remoteRepoSlug("https://user:token@github.com/example-org/example-repo")).toBe("example-org/example-repo");
    expect(remoteRepoSlug("git@github.com:example-org/example-repo.git")).toBe("example-org/example-repo");
    expect(remoteRepoSlug("ssh://git@host.example.invalid:2222/example-org/example-repo.git")).toBe("example-org/example-repo");
    expect(remoteRepoSlug("/tmp/work/remote.git")).toBeNull();
    expect(remoteRepoSlug("file:///tmp/remote.git")).toBeNull();
    expect(remoteRepoSlug("../remote.git")).toBeNull();
  });
});

describe("sign-off scan", () => {
  const commit = (message: string, name = "Dev A", email = "dev-a@example.invalid"): CommitInfo => ({ sha: sha("1"), authorName: name, authorEmail: email, subject: message.split("\n")[0] ?? "", message });
  const signed = "feat: x\n\nSigned-off-by: Dev A <dev-a@example.invalid>";
  const botPolicy = (mode: string): Policy => policyFromText(`schema = 1\n[dco]\nbot_authors = ["dependency-bot[bot]"]\nbot_commits = "${mode}"\n`);

  test("signed commits pass and unsigned commits are listed", () => {
    expect(unsignedCommits([commit(signed), commit("feat: y")], builtinPolicy()).map((c) => c.subject)).toEqual(["feat: y"]);
  });

  test("a bot is found by name or by noreply address, and exempt only in exempt mode", () => {
    const byName = commit("chore: bump", "dependency-bot[bot]");
    const byMail = commit("chore: bump", "Dependency Bot", "49+dependency-bot[bot]@users.noreply.example.invalid");
    expect(unsignedCommits([byName, byMail], botPolicy("exempt"))).toEqual([]);
    expect(unsignedCommits([byName, byMail], botPolicy("rewrite"))).toHaveLength(2);
    expect(unsignedCommits([commit("chore: bump", "Someone Else")], botPolicy("exempt"))).toHaveLength(1);
  });

  test("dco.required = false skips the scan", () => {
    expect(unsignedCommits([commit("feat: y")], policyFromText("schema = 1\n[dco]\nrequired = false\n"))).toEqual([]);
  });
});

describe("inventory check", () => {
  const inventory = { name: "i", file: "inv.txt", added: ["src/**/*.ts"], exclude: ["**/tests/**"], group_depth: 2, update: [] };
  test("a group that is listed is enforced; an unlisted group and excluded paths are not", () => {
    const text = "# sources\nsrc/core/one.ts\n";
    expect(inventoryMisses(inventory, ["src/core/two.ts", "src/other/x.ts", "src/core/tests/t.ts", "src/core/one.ts", "inv.txt"], text)).toEqual(["src/core/two.ts"]);
  });
});

describe("body text", () => {
  test("comments go, code fences stay", () => {
    expect(stripAuthoringComments("a <!-- x --> b\n```\n<!-- keep -->\n```\n")).toBe("a  b\n```\n<!-- keep -->\n```\n");
  });

  test("placeholders skip real HTML and comments", () => {
    const template = "## A\n\n<!-- <hidden> -->\n<details>x</details> <br/> <name each check> `<code>`\n";
    expect(templatePlaceholders(template)).toEqual(["<name each check>"]);
  });

  test("headings come from the template, else from the policy sections", () => {
    const policy = builtinPolicy();
    expect(requiredHeadings(null, policy)).toEqual(["Why", "What", "Proof", "Done when"]);
    expect(requiredHeadings("no headings here", policy)).toEqual(["Why", "What", "Proof", "Done when"]);
    expect(requiredHeadings("## One\n\n## Two\n", policy)).toEqual(["One", "Two"]);
  });

  test("the skeleton has one section per policy section and the issue boxes under Done when", () => {
    const text = buildSkeleton(null, builtinPolicy(), ["Box one"]);
    expect(text.split("\n").filter((l) => l.startsWith("## "))).toEqual(["## Why", "## What", "## Proof", "## Done when"]);
    expect(text).toContain("- [ ] Box one (proof: )");
    expect(buildSkeleton("## T\n\nbody\n", builtinPolicy(), [])).toBe("## T\n\nbody");
  });

  test("an empty skeleton fails the body checks, so an unfilled skeleton never posts", () => {
    const skeleton = buildSkeleton(null, builtinPolicy(), []);
    expect(bodyChecks(skeleton, ["Why", "What", "Proof", "Done when"], []).length).toBe(4);
  });

  test("a body over the limit is a problem", () => {
    const long = `## Why\n\n${"x".repeat(66_000)}\n`;
    expect(bodyChecks(long, ["Why"], [])).toEqual(["the body is longer than 65000 characters"]);
  });
});

describe("issue boxes and the link rule", () => {
  const heading = "Done when";
  const issue = "## Done when\n\n- [ ] First box\n* [ ] Second box\n- [x] Old box\n\n## Notes\n\n- [ ] Not a Done-when box\n";

  test("only the open boxes under the heading count", () => {
    expect(parseIssueBoxes(issue, heading)).toEqual({ present: true, unchecked: ["First box", "Second box"] });
    expect(parseIssueBoxes("nothing", heading)).toEqual({ present: false, unchecked: [] });
  });

  const pr = (lines: string): string => `## Done when\n\n${lines}\n`;
  const range = ["abcdef0123456789abcdef0123456789abcdef01"];
  const ctx = { issue: 5, commits: range };

  test("a box maps only to a checked line that names it and carries proof", () => {
    const boxes = ["First box", "Second box"];
    expect(unmappedBoxes(pr("- [x] First box: `bun test`\n- [x] second  BOX, see #44"), heading, boxes, ctx)).toEqual([]);
    expect(unmappedBoxes(pr("- [x] First box\n- [x] Second box abc"), heading, boxes, ctx)).toEqual(boxes);
    expect(unmappedBoxes(pr("- [ ] First box `x`\n- [x] Second box (abcdef0)"), heading, boxes, ctx)).toEqual(["First box"]);
    expect(unmappedBoxes("## Other\n\n- [x] First box `x`\n", heading, ["First box"], ctx)).toEqual(["First box"]);
  });

  test("proof: the issue's own number, a hex-looking word, and an unknown commit do not count", () => {
    const own = unmappedBoxes(pr("- [x] First box (#5)"), heading, ["First box"], ctx);
    expect(own).toEqual(["First box"]);
    expect(unmappedBoxes(pr("- [x] First box (defaced)"), heading, ["First box"], ctx)).toEqual(["First box"]);
    expect(unmappedBoxes(pr("- [x] First box (1234567)"), heading, ["First box"], ctx)).toEqual(["First box"]);
    expect(unmappedBoxes(pr("- [x] First box (abcdef0123)"), heading, ["First box"], ctx)).toEqual([]);
    expect(unmappedBoxes(pr("- [x] First box (#6)"), heading, ["First box"], ctx)).toEqual([]);
    expect(unmappedBoxes(pr("- [x] First box, see https://example.invalid/x"), heading, ["First box"], ctx)).toEqual([]);
    expect(unmappedBoxes(pr("- [x] First box [notes](docs/notes.md)"), heading, ["First box"], ctx)).toEqual(["First box"]);
  });

  test("the proof must come from outside the box text", () => {
    expect(unmappedBoxes(pr("- [x] Run `bun test`"), heading, ["Run `bun test`"], ctx)).toEqual(["Run `bun test`"]);
    expect(unmappedBoxes(pr("- [x] Run `bun test` (green: `bun test`)"), heading, ["Run `bun test`"], ctx)).toEqual([]);
  });

  const known = { readable: true, hasDoneWhen: true };

  test("the decision", () => {
    const mapped = pr("- [x] First box `a`");
    expect(decideLink(5, ["First box"], mapped, heading, false, ctx, known)).toMatchObject({ kind: "Closes", line: "Closes #5", present: false });
    expect(decideLink(5, ["First box"], mapped, heading, true, ctx, known)).toMatchObject({ kind: "Part of", reason: "--part-of was given" });
    expect(decideLink(5, ["First box", "Second box"], mapped, heading, false, ctx, known)).toMatchObject({ kind: "Part of", unmapped: ["Second box"] });
    expect(decideLink(5, [], "x", heading, false, ctx, known)).toMatchObject({ kind: "Closes", reason: "the issue has no open Done-when box" });
    expect(decideLink(5, [], `${mapped}\nCloses #5`, heading, false, ctx, known).present).toBe(true);
    expect(decideLink(5, ["First box", "Second box"], `${mapped}\nPart of #5`, heading, false, ctx, known).present).toBe(true);
    expect(decideLink(5, ["First box", "Second box"], `${mapped}\nCloses #5`, heading, false, ctx, known).present).toBe(false);
  });

  test("an issue that cannot be read, or has no Done-when section, never gets Closes", () => {
    expect(decideLink(5, [], "x", heading, false, ctx, { readable: true, hasDoneWhen: false })).toMatchObject({ kind: "Part of", reason: "the issue has no Done-when section" });
    expect(decideLink(5, [], "x", heading, false, ctx, { readable: false, hasDoneWhen: false })).toMatchObject({ kind: "Part of", reason: "the issue could not be read" });
  });

  test("the final body adds the link and the footer once", () => {
    const once = finalBody({ body: "## Why\n\n<!-- c -->\nText  \n\n\n\nMore\n", addLine: "Part of #5", footer: "Footer." });
    expect(once).toBe("## Why\n\nText\n\nMore\n\nPart of #5\n\nFooter.\n");
    expect(finalBody({ body: once, addLine: null, footer: "Footer." })).toBe(once);
    expect(finalBody({ body: "x", addLine: null, footer: "" })).toBe("x\n");
  });
});

describe("credential lines", () => {
  test("a token, a URL with credentials, and an authorization header give line numbers only", () => {
    const text = ["fine", `a ghp_${"x9".repeat(10)} b`, "ok", "https://user:pw@example.invalid/x", "Authorization: Bearer abc123", "token: not-a-secret-label-here"].join("\n");
    expect(secretLineNumbers(text)).toEqual([2, 4, 5]);
    expect(secretLineNumbers("plain\ntext")).toEqual([]);
    // Calling twice gives the same answer: no regex state leaks between calls.
    expect(secretLineNumbers(text)).toEqual([2, 4, 5]);
  });
});
