// Generic-name guard (design section 3): no shipped file may name an owner,
// organization, or repository. The words are built from fragments so that this
// file does not match itself.

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");

const WORDS = [["tail", "rocks"], ["vel", "nor"], ["don", "beave"], ["chain", "argos"]].map((p) => p.join(""));
const PATTERN = new RegExp(WORDS.join("|"), "i");

// Every shipped tree. `skills/` is scanned in full: SKILL.md, agents/, references/, and scripts/.
const SCANNED = ["skills", "tools", "lib", "schemas", "examples", "tests"] as const;

function walk(directory: string): readonly string[] {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

/**
 * The ten skill ids of release 0.5.0. A skill that is not merged yet still has its
 * id named in the kept skills and the guides, so the mask knows the whole release.
 */
const RELEASE_SKILL_IDS: readonly string[] = [
  "pr-status", "pr-create", "pr-refresh", "pr-threads", "pr-merge", "pr-fleet",
  "review-pr", "pr-template", "repository-merge", "repository-recover",
].map((id) => `${WORDS[0]}-${id}`);

/** Directory names under skills/, and the ids of the release. Each one is a skill id. */
function skillIds(): readonly string[] {
  const dir = join(root, "skills");
  const present = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
    : [];
  return [...new Set([...present, ...RELEASE_SKILL_IDS])];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The only masked tokens: the plugin name and the exact skill ids. A skill id
 * is a package identifier, and it carries the plugin prefix. Nothing else is
 * exempt: a display name, a link, or a prose mention of an organization is a hit.
 */
function maskPattern(): RegExp {
  const pluginName: unknown = JSON.parse(readFileSync(join(root, "plugin.json"), "utf8")).name;
  const tokens = [...skillIds(), ...(typeof pluginName === "string" ? [pluginName] : [])];
  // Longest first, so that a longer id is masked whole.
  const sorted = [...tokens].sort((a, b) => b.length - a.length);
  return new RegExp(`(?<![A-Za-z0-9-])(?:${sorted.map(escapeRegExp).join("|")})(?![A-Za-z0-9-])`, "g");
}

function findings(mask: RegExp = maskPattern()): readonly string[] {
  const hits: string[] = [];
  for (const area of SCANNED) {
    for (const path of walk(join(root, area))) {
      const name = relative(root, path).replace(mask, "TOKEN");
      const lines = readFileSync(path, "utf8").replace(mask, "TOKEN").split("\n");
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
    for (const area of SCANNED) {
      expect(walk(join(root, area)).length).toBeGreaterThan(0);
    }
  });

  test("every skill file is scanned: SKILL.md, agents, and references", () => {
    const files = walk(join(root, "skills")).map((path) => relative(root, path));
    expect(files.some((f) => f.endsWith("/SKILL.md"))).toBe(true);
    expect(files.some((f) => f.includes("/agents/"))).toBe(true);
    expect(files.some((f) => f.includes("/references/"))).toBe(true);
  });

  test("the mask hides only exact skill ids and the plugin name", () => {
    const [id] = skillIds();
    const mask = maskPattern();
    expect(id).toBeDefined();
    expect(`use \`${id}\` now`.replace(mask, "TOKEN")).toBe("use `TOKEN` now");
    // A prefix, a suffix, a display name, or an organization link is not masked.
    expect(PATTERN.test(`${id}-extra`.replace(mask, "TOKEN"))).toBe(true);
    expect(PATTERN.test(`${WORDS[0]}/${id}`.replace(mask, "TOKEN"))).toBe(true);
    expect(PATTERN.test(`${WORDS[0]}: Display`.replace(mask, "TOKEN"))).toBe(true);
    expect(PATTERN.test(`https://example.invalid/${WORDS[0]}/repo`.replace(mask, "TOKEN"))).toBe(true);
  });

  test("the pattern matches in any letter case and in a larger word", () => {
    for (const word of WORDS) {
      expect(PATTERN.test(word.toUpperCase())).toBe(true);
      expect(PATTERN.test(`x-${word}-y`)).toBe(true);
    }
  });
});
