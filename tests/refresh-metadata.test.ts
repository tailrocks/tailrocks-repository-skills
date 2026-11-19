import { afterEach, describe, expect, test, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../lib/refresh/cli.ts";
import { fakeGithub, policyToml, REPO, sandbox, testDeps, type FakeOptions, type Sandbox } from "./helpers/refresh-env.ts";

// Each test makes several git repositories; give it room.
setDefaultTimeout(60_000);

const made: Sandbox[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const sb of made.splice(0)) {
    sb.cleanup();
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function box(): Sandbox {
  const sb = sandbox();
  made.push(sb);
  sb.commit({ "a.txt": "one\n" }, "feat: one");
  sb.git(["push", "origin", "feat/topic"]);
  return sb;
}

function bodyFile(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), "refresh-body-"));
  dirs.push(dir);
  const file = join(dir, "body.md");
  writeFileSync(file, text);
  return file;
}

interface Run {
  readonly code: number;
  readonly gh: ReturnType<typeof fakeGithub>;
  readonly json: { code: string; headline: string; details: string[]; data: Record<string, unknown> };
}

async function meta(sb: Sandbox, options: FakeOptions, args: readonly string[], gh = fakeGithub(sb, options)): Promise<Run> {
  const { deps } = testDeps(sb, gh);
  const lines: string[] = [];
  const code = await main(["metadata", "7", ...args, "--repo", REPO, "--json"], { cwd: sb.clone, deps, out: (l) => lines.push(l), err: (l) => lines.push(l) });
  return { code, gh, json: JSON.parse(lines.join("\n")) };
}

const FILES = [
  { filename: "a.txt", status: "added", additions: 1, deletions: 0 },
  { filename: "src/b.ts", status: "modified", additions: 4, deletions: 2 },
];

describe("the template source", () => {
  test("metadata show reads the body template at the default branch commit, not at the head of the PR", async () => {
    const sb = box();
    const run = await meta(sb, { policy: policyToml(), template: "## Why\n\n## What\n" }, ["show"]);
    expect(run.code).toBe(0);
    const reads = run.gh.calls.filter((c) => c.some((a) => a.includes("PULL_REQUEST_TEMPLATE.md")));
    expect(reads).toHaveLength(1);
    const head = sb.remoteRev("refs/heads/feat/topic");
    expect(reads[0]?.some((a) => a.endsWith(`ref=${"c".repeat(40)}`))).toBe(true);
    expect(reads[0]?.some((a) => a.endsWith(`ref=${head}`))).toBe(false);
  });

  test("a missing template says it is missing on the default branch", async () => {
    const sb = box();
    const run = await meta(sb, { policy: policyToml() }, ["show"]);
    expect(JSON.stringify(run.json)).not.toContain("on the head");
  });
});

describe("the policy source", () => {
  test("every refresh mode reads the policy at the default branch commit, not at the base of the PR", async () => {
    const sb = box();
    const run = await meta(sb, { policy: policyToml() }, ["show"]);
    expect(run.code).toBe(0);
    const reads = run.gh.calls.filter((c) => c.some((a) => a.includes("pr-policy.toml")));
    expect(reads.length).toBeGreaterThan(0);
    // The fake serves the default branch tip as "c" x 40. The base commit of the PR is the real tip of main.
    const baseTip = sb.remoteRev("refs/heads/main");
    expect(baseTip).not.toBe("c".repeat(40));
    for (const call of reads) {
      expect(call.some((a) => a.endsWith(`ref=${"c".repeat(40)}`))).toBe(true);
      expect(call.some((a) => a.endsWith(`ref=${baseTip}`))).toBe(false);
    }
  });
});

describe("metadata show", () => {
  test("prints title, body, diff stat, template, and a state id", async () => {
    const sb = box();
    const run = await meta(sb, { policy: policyToml("[pr_body]", 'sections = ["Why", "Proof"]'), files: FILES, template: "## Why\n\n## Proof\n" }, ["show"]);
    expect(run.code).toBe(0);
    const data = run.json.data;
    expect(data["title"]).toBe("feat: topic");
    expect(data["headSha"]).toBe(sb.remoteRev("refs/heads/feat/topic"));
    expect(typeof data["stateId"]).toBe("string");
    expect(data["template"]).toBe("## Why\n\n## Proof\n");
    expect(data["files"]).toHaveLength(2);
    expect(data["sectionProblems"]).toEqual(['missing section "Proof"']);
    expect(run.json.details.join("\n")).toContain("2 files, +5 -2");
  });

  test("reports a missing template", async () => {
    const sb = box();
    const run = await meta(sb, { policy: policyToml(), files: FILES }, ["show"]);
    expect(run.json.data["template"]).toBeNull();
    expect(run.json.details.join("\n")).toContain("no template");
  });
});

describe("metadata write", () => {
  async function head(sb: Sandbox, options: FakeOptions): Promise<{ head: string; state: string; gh: ReturnType<typeof fakeGithub> }> {
    const gh = fakeGithub(sb, options);
    const shown = await meta(sb, options, ["show"], gh);
    return { head: String(shown.json.data["headSha"]), state: String(shown.json.data["stateId"]), gh };
  }

  test("writes the title and body, then reads them back", async () => {
    const sb = box();
    const seen = await head(sb, { policy: policyToml() });
    const file = bodyFile("## Why\nnew text\n");
    const run = await meta(sb, {}, ["write", "--title", "feat: better title", "--body-file", file, "--expect-head", seen.head, "--expect-state", seen.state], seen.gh);
    expect(run.code).toBe(0);
    expect(run.json.data["changed"]).toEqual(["title", "body"]);
    expect(seen.gh.edits).toHaveLength(1);
    expect(seen.gh.edits[0]?.slice(0, 5)).toEqual(["pr", "edit", "7", "--repo", REPO]);
    expect(seen.gh.state.title).toBe("feat: better title");
    expect(seen.gh.state.body).toBe("## Why\nnew text\n");
    // The body goes through a library-made file, not through the path that the caller gave.
    expect(seen.gh.edits[0]?.[seen.gh.edits[0].indexOf("--body-file") + 1]).not.toBe(file);
  });

  test("an unchanged title and body issue no edit", async () => {
    const sb = box();
    const seen = await head(sb, { policy: policyToml() });
    const file = bodyFile("## Why\nbecause\n");
    const run = await meta(sb, {}, ["write", "--title", "feat: topic", "--body-file", file, "--expect-head", seen.head, "--expect-state", seen.state], seen.gh);
    expect(run.code).toBe(0);
    expect(run.json.data["written"]).toBe(false);
    expect(seen.gh.edits).toEqual([]);
  });

  test("a new head since show aborts without an edit", async () => {
    const sb = box();
    const seen = await head(sb, { policy: policyToml() });
    const other = sb.other();
    sb.git(["checkout", "-b", "feat/topic", "origin/feat/topic"], other);
    sb.commit({ "z.txt": "z\n" }, "feat: more", { cwd: other });
    sb.git(["push", "origin", "feat/topic"], other);
    const run = await meta(sb, {}, ["write", "--title", "feat: new", "--expect-head", seen.head, "--expect-state", seen.state], seen.gh);
    expect(run.code).toBe(20);
    expect(run.json.code).toBe("drift");
    expect(seen.gh.edits).toEqual([]);
  });

  test("a changed body since show aborts without an edit", async () => {
    const sb = box();
    const seen = await head(sb, { policy: policyToml() });
    seen.gh.state.body = "edited by someone else\n";
    const run = await meta(sb, {}, ["write", "--title", "feat: new", "--expect-head", seen.head, "--expect-state", seen.state], seen.gh);
    expect(run.code).toBe(20);
    expect(run.json.code).toBe("drift");
    expect(seen.gh.edits).toEqual([]);
  });

  test("a body that holds a token is refused, and so is a title", async () => {
    const sb = box();
    const seen = await head(sb, { policy: policyToml() });
    const file = bodyFile("hosts:\n  oauth_token: gho_0123456789abcdefghijABCDEFGHIJ\n");
    const run = await meta(sb, {}, ["write", "--body-file", file, "--expect-head", seen.head, "--expect-state", seen.state], seen.gh);
    expect(run.code).toBe(20);
    expect(run.json.code).toBe("credential_in_text");
    expect(seen.gh.edits).toEqual([]);
    const title = await meta(sb, {}, ["write", "--title", "see https://user:hunter2@example.com/x", "--expect-head", seen.head, "--expect-state", seen.state], seen.gh);
    expect(title.json.code).toBe("credential_in_text");
    expect(seen.gh.edits).toEqual([]);
  });

  test("a lost edit is reported as an uncertain outcome", async () => {
    const sb = box();
    const options = { policy: policyToml(), dropEdits: true };
    const seen = await head(sb, options);
    const file = bodyFile("## Why\nnew text\n");
    const run = await meta(sb, {}, ["write", "--title", "feat: new title", "--body-file", file, "--expect-head", seen.head, "--expect-state", seen.state], seen.gh);
    expect(run.code).toBe(20);
    expect(run.json.code).toBe("uncertain_outcome");
    expect(seen.gh.edits).toHaveLength(1);
  });

  test("a closed PR is not edited", async () => {
    const sb = box();
    const seen = await head(sb, { policy: policyToml() });
    seen.gh.state.state = "CLOSED";
    const run = await meta(sb, {}, ["write", "--title", "feat: new", "--expect-head", seen.head, "--expect-state", seen.state], seen.gh);
    expect(run.json.code).toBe("pr_not_open");
    expect(seen.gh.edits).toEqual([]);
  });

  test("a title with a line break is refused by the guard", async () => {
    const sb = box();
    const seen = await head(sb, { policy: policyToml() });
    const run = await meta(sb, {}, ["write", "--title", "feat: a\nb", "--expect-head", seen.head, "--expect-state", seen.state], seen.gh);
    expect(run.code).toBe(20);
    expect(seen.gh.edits).toEqual([]);
  });

  test("writes nothing for a body file that is a link", async () => {
    const sb = box();
    const seen = await head(sb, { policy: policyToml() });
    const dir = mkdtempSync(join(tmpdir(), "refresh-body-"));
    dirs.push(dir);
    writeFileSync(join(dir, "real.md"), "text\n");
    Bun.spawnSync(["ln", "-s", join(dir, "real.md"), join(dir, "link.md")]);
    const run = await meta(sb, {}, ["write", "--body-file", join(dir, "link.md"), "--expect-head", seen.head, "--expect-state", seen.state], seen.gh);
    expect(run.code).toBe(20);
    expect(run.json.code).toBe("invalid_text");
    expect(seen.gh.edits).toEqual([]);
  });
});
