import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { refreshPortFor, refreshResultOf } from "../lib/fleet/refresh-port.ts";
import type { RefreshResult } from "../lib/fleet/types.ts";
import { blocked, done } from "../lib/refresh/outcome.ts";
import { parseSha, type Sha } from "../lib/types.ts";
import { fakeGithub, policyToml, REPO, sandbox, testDeps, type Sandbox } from "./helpers/refresh-env.ts";

// Each test makes several git repositories; give it room.
setDefaultTimeout(60_000);

const made: Sandbox[] = [];
afterEach(() => {
  for (const sb of made.splice(0)) {
    sb.cleanup();
  }
});

function box(): Sandbox {
  const sb = sandbox();
  made.push(sb);
  return sb;
}

function sha(text: string): Sha {
  const parsed = parseSha(text.trim());
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

/** A PR branch with one pushed commit, and a base that moved on. */
function behind(sb: Sandbox, files: Record<string, string> = { "docs/base.md": "base\n" }): Sha {
  const head = sb.commit({ "a.txt": "one\n" }, "feat: one");
  sb.git(["push", "origin", "feat/topic"]);
  const other = sb.other();
  sb.commit(files, "chore: base moves", { cwd: other });
  sb.git(["push", "origin", "main"], other);
  return sha(head);
}

function portFor(sb: Sandbox, policy: string | null = policyToml()) {
  const gh = fakeGithub(sb, { policy });
  const { deps, gitCalls } = testDeps(sb, gh);
  return { port: refreshPortFor(REPO, deps), gh, gitCalls };
}

const pushes = (calls: readonly string[][]): string[][] => calls.filter((c) => c[0] === "push");

describe("the fleet refresh port runs pr-refresh sync", () => {
  test("a behind PR gets one base merge and one plain push, and the result is ok", async () => {
    const sb = box();
    const head = behind(sb);
    const { port, gitCalls } = portFor(sb);
    const result = await port.sync(7, head);
    expect(result.ok).toBe(true);
    expect(result.note).toContain("pushed");
    expect(sb.remoteRev("refs/heads/feat/topic")).not.toBe(head);
    const sent = pushes(gitCalls);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.some((a) => a.startsWith("--force") || a.startsWith("+"))).toBe(false);
  });

  test("an up-to-date PR is a done refresh that pushes nothing", async () => {
    const sb = box();
    const head = sha(sb.commit({ "a.txt": "one\n" }, "feat: one"));
    sb.git(["push", "origin", "feat/topic"]);
    const { port, gitCalls } = portFor(sb);
    const result = await port.sync(7, head);
    expect(result.ok).toBe(true);
    expect(pushes(gitCalls)).toEqual([]);
  });

  test("a head that moved since the plan stops the refresh and writes nothing", async () => {
    const sb = box();
    const head = behind(sb);
    const { port, gitCalls } = portFor(sb);
    const result = await port.sync(7, sha("d".repeat(40)));
    expect(result.ok).toBe(false);
    expect(result.ok === false ? result.next : "").toBe("Run the plan again.");
    expect(result.note).toContain("the head moved");
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(head);
    expect(pushes(gitCalls)).toEqual([]);
  });

  test("a conflict that the policy cannot regenerate stops the action, with the outcome code and its next line", async () => {
    const sb = box();
    sb.commit({ "README.md": "# branch\n" }, "feat: edit readme");
    sb.git(["push", "origin", "feat/topic"]);
    const head = sha(sb.remoteRev("refs/heads/feat/topic"));
    const other = sb.other();
    sb.commit({ "README.md": "# base\n" }, "chore: base moves", { cwd: other });
    sb.git(["push", "origin", "main"], other);
    const { port, gitCalls } = portFor(sb);
    const result = await port.sync(7, head);
    expect(result.ok).toBe(false);
    expect(result.note).toContain("(conflict)");
    expect(result.ok === false ? result.next : "").toContain("--keep-worktree");
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(head);
    expect(pushes(gitCalls)).toEqual([]);
  });

  test("a missing sign-off stops the action. The port never runs dco-fix and never force-pushes", async () => {
    const sb = box();
    const head = sha(sb.commit({ "a.txt": "one\n" }, "feat: unsigned", { signoff: false }));
    sb.git(["push", "origin", "feat/topic"]);
    const other = sb.other();
    sb.commit({ "docs/base.md": "base\n" }, "chore: base moves", { cwd: other });
    sb.git(["push", "origin", "main"], other);
    const { port, gitCalls, gh } = portFor(sb);
    const result = await port.sync(7, head);
    expect(result.ok).toBe(false);
    expect(result.note).toContain("(dco_missing)");
    expect(result.ok === false ? result.next : "").toContain("pr-refresh dco-fix");
    expect(sb.remoteRev("refs/heads/feat/topic")).toBe(head);
    expect(pushes(gitCalls)).toEqual([]);
    expect(gitCalls.some((c) => c[0] === "commit-tree")).toBe(false);
    expect(gh.comments).toEqual([]);
  });

  test("an invalid policy or a closed PR is a stopped action with the code of the outcome", async () => {
    const sb = box();
    const head = behind(sb);
    const closed = fakeGithub(sb, { policy: policyToml(), state: { state: "CLOSED" } });
    const { deps } = testDeps(sb, closed);
    const result = await refreshPortFor(REPO, deps).sync(7, head);
    expect(result.ok).toBe(false);
    expect(result.note).toContain("pr_not_open");
  });
});

describe("refreshResultOf reads the outcome object, not an exit code", () => {
  test("DONE is ok, also when nothing was pushed", () => {
    expect(refreshResultOf(done("the branch already contains the base; nothing to merge or push", [], { pushed: false }))).toEqual({
      ok: true,
      note: "the branch already contains the base; nothing to merge or push",
    });
  });

  test("BLOCKED is a stopped action. The note holds the code, the headline, and the first detail; next is the outcome next", () => {
    const result: RefreshResult = refreshResultOf(blocked("conflict", "the merge conflicts", "run sync with --keep-worktree", ["conflict: README.md"]));
    expect(result).toEqual({
      ok: false,
      note: "pr-refresh sync stopped (conflict): the merge conflicts (conflict: README.md)",
      next: "run sync with --keep-worktree",
    });
  });

  test("the state decides, whatever the exit field says", () => {
    const lying = { ...blocked("push_rejected", "the push was rejected", "run the mode again"), exit: 0 as const };
    expect(refreshResultOf(lying).ok).toBe(false);
    const fine = { ...done("pushed"), exit: 20 as const };
    expect(refreshResultOf(fine).ok).toBe(true);
  });
});
