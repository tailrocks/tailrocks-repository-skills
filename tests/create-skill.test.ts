// Structure of the pr-create skill: the files, the frontmatter, and the exit
// table that SKILL.md and the script must agree on.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EXIT } from "../lib/create/exit.ts";
import { HELP } from "../lib/create/cli.ts";

const dir = join(import.meta.dir, "..", "skills", "tailrocks-pr-create");
const skill = readFileSync(join(dir, "SKILL.md"), "utf8");

function frontmatter(): { readonly keys: readonly string[]; readonly description: string } {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(skill);
  const block = match?.[1] ?? "";
  const keys = [...block.matchAll(/^([a-z_-]+):/gm)].map((m) => m[1] ?? "");
  const description = /^description:\s*>-?\n((?:[ ]{2}.*\n?)+)/m.exec(`${block}\n`)?.[1] ?? "";
  return { keys, description: description.replace(/\s*\n\s*/g, " ").trim() };
}

describe("tailrocks-pr-create", () => {
  test("the frontmatter holds name, description, and license only", () => {
    const { keys, description } = frontmatter();
    expect(keys).toEqual(["name", "description", "license"]);
    expect(description.length).toBeGreaterThan(100);
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(description).not.toMatch(/[<>]/);
    expect(skill).toContain("name: tailrocks-pr-create\n");
  });

  test("the body is short and starts with the Bun check", () => {
    expect(skill.split("\n").length).toBeLessThan(200);
    expect(skill).toMatch(/1\. Run `bun --version`/);
  });

  test("agents/openai.yaml has a short description of 25 to 64 characters and allows implicit use", () => {
    const yaml = readFileSync(join(dir, "agents", "openai.yaml"), "utf8");
    const short = /short_description: "([^"]*)"/.exec(yaml)?.[1] ?? "";
    expect(short.length).toBeGreaterThanOrEqual(25);
    expect(short.length).toBeLessThanOrEqual(64);
    expect(yaml).toContain("allow_implicit_invocation: true");
    expect(yaml).toMatch(/display_name: "PR: Create"/);
  });

  test("the exit table of SKILL.md matches the codes of the script", () => {
    const rows = [...skill.matchAll(/^\s*\| (\d+) \|/gm)].map((m) => Number(m[1]));
    expect(rows.sort((a, b) => a - b)).toEqual([0, 2, 3, 10, 20]);
    expect(Object.values(EXIT).sort((a, b) => a - b)).toEqual([0, 2, 3, 20]);
    for (const code of [0, 2, 3, 10, 20]) {
      expect(HELP).toMatch(new RegExp(`^  ${code}\\s`, "m"));
    }
  });

  test("every reference that SKILL.md names exists, and the script entry exists", () => {
    for (const ref of [...skill.matchAll(/`(references\/[a-z-]+\.md)`/g)].map((m) => m[1] ?? "")) {
      expect(existsSync(join(dir, ref))).toBe(true);
    }
    expect(existsSync(join(dir, "scripts", "create.ts"))).toBe(true);
    expect(existsSync(join(dir, "references", "runtime-trust.md"))).toBe(true);
  });

  test("the commands use the skill-dir token and name no shell", () => {
    expect(skill).toContain("bun run <skill-dir>/scripts/create.ts");
    expect(skill).not.toMatch(/\bbash -c\b|\bsh -c\b/);
  });
});
