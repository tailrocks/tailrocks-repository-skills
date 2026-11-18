// Copy the shared library into each script-backed skill, so that every skill
// directory is self-contained (several agents load one skill directory alone).
//
//   bun run tools/vendor-lib.ts          write the copies
//   bun run tools/vendor-lib.ts --check  list differences, exit 1 when any exist
//
// Layout: lib/ -> skills/<id>/scripts/lib/ and schemas/ -> skills/<id>/scripts/schemas/.
// The relative import "../../schemas/..." in lib/policy resolves in both trees.
// A skill is script-backed when skills/<id>/scripts/ holds at least one .ts file.

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

export interface Mapping {
  readonly source: string;
  readonly destination: string;
}

export interface Difference {
  readonly path: string;
  readonly kind: "missing" | "different" | "extra";
}

const SOURCES = ["lib", "schemas"] as const;

async function listFiles(directory: string): Promise<readonly string[]> {
  if (!existsSync(directory)) {
    return [];
  }
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
    .sort();
}

/** Skill directories that need a vendored copy. */
export async function scriptBackedSkills(root: string): Promise<readonly string[]> {
  const skillsDir = join(root, "skills");
  if (!existsSync(skillsDir)) {
    return [];
  }
  const found: string[] = [];
  for (const entry of await readdir(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const scripts = join(skillsDir, entry.name, "scripts");
    const direct = existsSync(scripts) ? await readdir(scripts, { withFileTypes: true }) : [];
    if (direct.some((file) => file.isFile() && file.name.endsWith(".ts"))) {
      found.push(entry.name);
    }
  }
  return found.sort();
}

/** Skills that already hold a vendored copy, script-backed or not. */
async function skillsWithCopy(root: string): Promise<readonly string[]> {
  const skillsDir = join(root, "skills");
  if (!existsSync(skillsDir)) {
    return [];
  }
  const entries = await readdir(skillsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && existsSync(join(skillsDir, e.name, "scripts", "lib")))
    .map((e) => e.name);
}

export async function mappingsFor(root: string): Promise<readonly Mapping[]> {
  const skills = [...new Set([...(await scriptBackedSkills(root)), ...(await skillsWithCopy(root))])].sort();
  return skills.flatMap((id) =>
    SOURCES.map((name) => ({
      source: join(root, name),
      destination: join(root, "skills", id, "scripts", name),
    })),
  );
}

export async function diffMapping(mapping: Mapping): Promise<readonly Difference[]> {
  const [sourceFiles, copyFiles] = await Promise.all([listFiles(mapping.source), listFiles(mapping.destination)]);
  const differences: Difference[] = [];
  for (const file of sourceFiles) {
    const copy = join(mapping.destination, file);
    if (!existsSync(copy)) {
      differences.push({ path: copy, kind: "missing" });
    } else {
      const [a, b] = await Promise.all([readFile(join(mapping.source, file)), readFile(copy)]);
      if (!a.equals(b)) {
        differences.push({ path: copy, kind: "different" });
      }
    }
  }
  const wanted = new Set(sourceFiles);
  for (const file of copyFiles) {
    if (!wanted.has(file)) {
      differences.push({ path: join(mapping.destination, file), kind: "extra" });
    }
  }
  return differences;
}

export async function findDifferences(root: string): Promise<readonly Difference[]> {
  const all: Difference[] = [];
  for (const mapping of await mappingsFor(root)) {
    all.push(...(await diffMapping(mapping)));
  }
  return all;
}

/** Make each copy equal to its source. Deletes only the exact extra files, then empty directories. */
export async function writeCopies(root: string): Promise<number> {
  let changed = 0;
  for (const mapping of await mappingsFor(root)) {
    for (const difference of await diffMapping(mapping)) {
      changed += 1;
      if (difference.kind === "extra") {
        await unlink(difference.path);
        let parent = dirname(difference.path);
        while (parent !== mapping.destination && (await readdir(parent)).length === 0) {
          await rmdir(parent);
          parent = dirname(parent);
        }
      } else {
        const sourcePath = join(mapping.source, relative(mapping.destination, difference.path));
        await mkdir(dirname(difference.path), { recursive: true });
        await writeFile(difference.path, await readFile(sourcePath));
      }
    }
  }
  return changed;
}

if (import.meta.main) {
  const root = join(import.meta.dir, "..");
  if (process.argv.includes("--check")) {
    const differences = await findDifferences(root);
    for (const d of differences) {
      console.error(`${d.kind}: ${relative(root, d.path)}`);
    }
    if (differences.length > 0) {
      console.error("Run: bun run vendor");
      process.exit(1);
    }
    console.log("vendored copies match lib/ and schemas/");
  } else {
    const changed = await writeCopies(root);
    console.log(`vendored: ${changed} file change${changed === 1 ? "" : "s"}`);
  }
}
