// Generic-name guard (design section 3): no shipped file may name an owner,
// organization, or repository. The words are built from fragments so that this
// file does not match itself.

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");

const WORDS = [["tail", "rocks"], ["vel", "nor"], ["don", "beave"], ["chain", "argos"]].map((p) => p.join(""));
const PATTERN = new RegExp(WORDS.join("|"), "i");

const SCANNED = ["skills", "lib", "schemas", "examples", "tests"] as const;

function walk(directory: string): readonly string[] {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

/** Directory names under skills/ that are skill ids. Skill ids carry the plugin prefix. */
function skillIds(): readonly string[] {
  const dir = join(root, "skills");
  return existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    : [];
}

/**
 * Prose-only skills from before the script-backed set. Their ids and display
 * names carry the plugin prefix, and one link names an organization. The
 * replacement PRs delete or rewrite them. Scanning of a skill starts when it
 * gets a scripts/ directory.
 */
function isLegacySkillFile(path: string): boolean {
  const parts = relative(join(root, "skills"), path).split("/");
  const [id] = parts;
  return parts.length > 1 && id !== undefined && !existsSync(join(root, "skills", id, "scripts"));
}

function findings(): readonly string[] {
  const ids = skillIds();
  const idPattern = ids.length > 0 ? new RegExp(ids.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g") : null;
  const hits: string[] = [];
  for (const area of SCANNED) {
    for (const path of walk(join(root, area))) {
      if (area === "skills" && isLegacySkillFile(path)) {
        continue;
      }
      let text = readFileSync(path, "utf8");
      let name = relative(root, path);
      if (area === "skills" && idPattern !== null) {
        // A skill id is a package identifier, not a repository name.
        text = text.replace(idPattern, "SKILL_ID");
        name = name.replace(idPattern, "SKILL_ID");
      }
      const lines = text.split("\n");
      lines.forEach((line, index) => {
        if (PATTERN.test(line)) {
          hits.push(`${name}:${index + 1}`);
        }
      });
      if (PATTERN.test(name)) {
        hits.push(`${name} (path)`);
      }
    }
  }
  return hits;
}

describe("generic names", () => {
  test("no scanned file names an owner, organization, or repository", () => {
    expect(findings()).toEqual([]);
  });

  test("the scan sees the directories it claims to scan", () => {
    for (const area of ["lib", "schemas", "examples", "tests"]) {
      expect(walk(join(root, area)).length).toBeGreaterThan(0);
    }
  });

  test("the pattern matches in any letter case and in a larger word", () => {
    for (const word of WORDS) {
      expect(PATTERN.test(word.toUpperCase())).toBe(true);
      expect(PATTERN.test(`x-${word}-y`)).toBe(true);
    }
  });
});
