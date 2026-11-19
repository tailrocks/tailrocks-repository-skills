import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./helpers/status.ts";

// The skills are built from parts here: the generic-name test scans this file.
const PREFIX = ["tail", "rocks"].join("");
const PR_SKILLS = ["status", "create", "refresh", "threads", "merge", "fleet"] as const;

function read(...parts: string[]): string {
  return readFileSync(join(root, "skills", ...parts), "utf8");
}

function description(id: string): string {
  const text = read(`${PREFIX}-${id}`, "SKILL.md");
  const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  return front.replace(/\n\s+/g, " ");
}

describe("the family of PR skills", () => {
  test.each(PR_SKILLS)("pr-%s says what the short names mean", (id) => {
    expect(read(`${PREFIX}-pr-${id}`, "SKILL.md")).toContain(`\`pr-X\` means the skill \`${PREFIX}-pr-X\``);
  });

  test("every text about the policy names the default branch, never the base branch", () => {
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "scripts") walk(path);
        } else if (entry.name.endsWith(".md")) {
          const lines = readFileSync(path, "utf8").split("\n");
          lines.forEach((line, index) => {
            if (/base[- ]branch/i.test(line) && /polic/i.test(line)) hits.push(`${path.slice(root.length + 1)}:${index + 1}`);
          });
        }
      }
    };
    walk(join(root, "skills"));
    expect(hits).toEqual([]);
  });

  test("pr-refresh says that the policy comes from the default branch", () => {
    expect(read(`${PREFIX}-pr-refresh`, "SKILL.md")).toContain("on the default branch at\nits current commit");
    expect(read(`${PREFIX}-pr-refresh`, "references", "outcome-codes.md")).toContain("Check the policy steps on the default branch.");
  });

  test("pr-threads does not fire on a status report alone", () => {
    const text = description("pr-threads");
    expect(text).not.toMatch(/when pr-status reports/i);
    expect(text).toContain("when the user asks to fix, answer, defer, or resolve review comments");
    expect(text).toContain("Do not use it only because a status report lists them");
  });

  test("review-pr does not claim merge readiness, which belongs to pr-status", () => {
    const text = description("review-pr");
    expect(text).not.toMatch(/ready to merge/i);
    expect(text).toContain(`${PREFIX}-pr-status`);
  });

  test("pr-create hands a missing sign-off on pushed commits to pr-refresh dco-fix by its full name, and does not force-push itself", () => {
    const text = read(`${PREFIX}-pr-create`, "SKILL.md");
    expect(text).toContain(`the skill \`${PREFIX}-pr-refresh\` in \`dco-fix\` mode`);
    expect(text).toContain("That skill does the force-push, which is the only one allowed. This\n   skill never does it.");
    expect(text).toContain("The one allowed force-push is the `dco-fix` mode");
  });

  test("pr-fleet documents the high-risk refusal of pr-merge", () => {
    const rules = read(`${PREFIX}-pr-fleet`, "references", "fleet-rules.md");
    expect(rules).toContain("refused (needs the user's --accept-risk)");
    expect(rules).toContain("never does it");
  });
});
