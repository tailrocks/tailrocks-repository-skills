import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HELP } from "../lib/fleet/cli.ts";
import { root } from "./helpers/status.ts";

const dir = join(root, "skills", "tailrocks-pr-fleet");
const skill = readFileSync(join(dir, "SKILL.md"), "utf8");

function frontmatter(): { readonly keys: readonly string[]; readonly description: string } {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(skill);
  if (match === null) throw new Error("no frontmatter");
  const block = match[1] ?? "";
  const keys = [...block.matchAll(/^([a-z_-]+):/gm)].map((m) => m[1] ?? "");
  const description = /^description: >-\n((?: {2}.*\n?)+)/m.exec(block + "\n")?.[1] ?? "";
  return { keys, description: description.split("\n").map((l) => l.trim()).join(" ").trim() };
}

describe("SKILL.md", () => {
  test("frontmatter holds only name, description, and license", () => {
    expect(frontmatter().keys).toEqual(["name", "description", "license"]);
    expect(skill).toContain("name: tailrocks-pr-fleet");
  });

  test("the description has at most 1024 characters, no angle brackets, and says what it does not do", () => {
    const { description } = frontmatter();
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(1024);
    expect(description).not.toMatch(/[<>]/);
    expect(description).toMatch(/^Plans the work/);
    expect(description).toContain("never cancels a CI run");
  });

  test("the body has fewer than 200 lines and step 1 checks Bun", () => {
    expect(skill.split("\n").length).toBeLessThan(200);
    expect(skill).toMatch(/1\. Run `bun --version`/);
  });

  test("apply needs --apply, and the user confirms the action list first", () => {
    expect(skill).toContain("never authorizes `--apply`");
    expect(skill).toContain("Show the user the action list");
    expect(skill).toContain('"drain them" or "run the plan"');
    expect(skill).toContain("show the list and ask once");
  });

  test("the skill reports next lines of failed actions and does not run them", () => {
    expect(skill).toContain("Do not run the\n   `next` line of a stopped, skipped, pending, or refused action");
  });

  test("refresh actions run pr-refresh sync through its outcome, never dco-fix, and nothing is pending for lack of pr-refresh", () => {
    expect(skill).not.toContain("not available");
    expect(skill).toContain("reads the outcome of `sync` (its state and code), not an exit");
    expect(skill).toContain("never runs `pr-refresh dco-fix`");
  });

  test("an unknown exit code is reported word for word and is not retried", () => {
    expect(skill).toMatch(/^\| 1, 127, or any other code \|.*Do not retry\./m);
  });

  test("orphan runs are a report item that does not stop the run, and --wait needs the user", () => {
    expect(skill).toContain("Report orphan runs only.");
    expect(skill).not.toContain("orphan runs and stop");
    expect(skill).toContain("Add `--wait` only when the user asks for it.");
  });

  test("it points to no bypass", () => {
    expect(skill).not.toMatch(/--admin|--force|unset PR_FLEET_FREEZE|rm -rf/);
    expect(skill).toContain("Name no workaround");
  });

  test("every exit code of the help has a row in the exit code table", () => {
    for (const code of ["0", "10", "20", "4", "3", "2"]) {
      expect(skill).toMatch(new RegExp(`^\\| ${code} \\|`, "m"));
      expect(HELP).toMatch(new RegExp(`^ {2}${code} {2,3}\\S`, "m"));
    }
    expect(skill).toMatch(/^\| 1, 127, or any other code \|/m);
  });

  test("the references that the skill names exist", () => {
    for (const match of skill.matchAll(/`(references\/[a-z-]+\.md)`/g)) {
      expect(existsSync(join(dir, match[1] ?? ""))).toBe(true);
    }
    expect(readFileSync(join(dir, "references", "runtime-trust.md"), "utf8")).toBe(
      readFileSync(join(root, "skills", "tailrocks-pr-merge", "references", "runtime-trust.md"), "utf8"),
    );
  });

  test("the commands use the skill directory token and the script name", () => {
    expect(skill).toContain("bun run <skill-dir>/scripts/fleet.ts plan");
    expect(skill).toContain("bun run <skill-dir>/scripts/fleet.ts apply");
    expect(existsSync(join(dir, "scripts", "fleet.ts"))).toBe(true);
  });
});

describe("agents/openai.yaml", () => {
  const yaml = readFileSync(join(dir, "agents", "openai.yaml"), "utf8");
  const field = (name: string): string => new RegExp(`^ {2}${name}: "(.*)"$`, "m").exec(yaml)?.[1] ?? "";

  test("short_description has 25 to 64 characters", () => {
    expect(field("short_description").length).toBeGreaterThanOrEqual(25);
    expect(field("short_description").length).toBeLessThanOrEqual(64);
  });

  test("display_name is neutral and the prompt names the skill", () => {
    expect(field("display_name")).toBe("PR: Fleet");
    expect(field("default_prompt")).toContain("$tailrocks-pr-fleet");
  });

  test("implicit invocation is off", () => {
    expect(yaml).toMatch(/^ {2}allow_implicit_invocation: false$/m);
  });
});
