import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { findDifferences, writeCopies } from "../tools/vendor-lib.ts";

const root = join(import.meta.dir, "..");

describe("vendored library copies", () => {
  test("every skills/*/scripts/lib copy equals lib/ (vacuous while no skill has scripts)", async () => {
    const differences = await findDifferences(root);
    const lines = differences.map((d) => `${d.kind}: ${relative(root, d.path)}`);
    expect(lines).toEqual([]);
  });
});

describe("vendor tool", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) {
      rmSync(dir, { recursive: true });
    }
  });

  function fixture(): string {
    const dir = mkdtempSync(join(tmpdir(), "vendor-test-"));
    made.push(dir);
    mkdirSync(join(dir, "lib", "policy"), { recursive: true });
    mkdirSync(join(dir, "schemas"));
    writeFileSync(join(dir, "lib", "a.ts"), "export const a = 1;\n");
    writeFileSync(join(dir, "lib", "policy", "b.ts"), "export const b = 2;\n");
    writeFileSync(join(dir, "schemas", "s.json"), "{}\n");
    mkdirSync(join(dir, "skills", "one", "scripts"), { recursive: true });
    writeFileSync(join(dir, "skills", "one", "scripts", "main.ts"), "// entry\n");
    mkdirSync(join(dir, "skills", "prose-only"), { recursive: true });
    writeFileSync(join(dir, "skills", "prose-only", "SKILL.md"), "x\n");
    return dir;
  }

  test("a script-backed skill without a copy is reported as missing", async () => {
    const dir = fixture();
    const differences = await findDifferences(dir);
    expect(differences.map((d) => d.kind)).toEqual(["missing", "missing", "missing"]);
    expect(differences.every((d) => d.path.includes(join("skills", "one")))).toBe(true);
  });

  test("a prose-only skill is left alone", async () => {
    const dir = fixture();
    await writeCopies(dir);
    expect(await findDifferences(dir)).toEqual([]);
    expect(() => readFileSync(join(dir, "skills", "prose-only", "scripts", "lib", "a.ts"))).toThrow();
  });

  test("writeCopies creates the copies, and a drifted copy is detected and repaired", async () => {
    const dir = fixture();
    expect(await writeCopies(dir)).toBe(3);
    const copy = join(dir, "skills", "one", "scripts", "lib", "policy", "b.ts");
    expect(readFileSync(copy, "utf8")).toBe("export const b = 2;\n");
    expect(readFileSync(join(dir, "skills", "one", "scripts", "schemas", "s.json"), "utf8")).toBe("{}\n");

    writeFileSync(copy, "export const b = 99;\n");
    expect((await findDifferences(dir)).map((d) => d.kind)).toEqual(["different"]);
    expect(await writeCopies(dir)).toBe(1);
    expect(await findDifferences(dir)).toEqual([]);
  });

  test("an extra file in a copy is detected and removed by exact path", async () => {
    const dir = fixture();
    await writeCopies(dir);
    const extraDir = join(dir, "skills", "one", "scripts", "lib", "old");
    mkdirSync(extraDir);
    writeFileSync(join(extraDir, "stale.ts"), "x\n");
    expect((await findDifferences(dir)).map((d) => d.kind)).toEqual(["extra"]);
    await writeCopies(dir);
    expect(await findDifferences(dir)).toEqual([]);
    expect(() => readFileSync(join(extraDir, "stale.ts"))).toThrow();
  });

  test("a changed source file shows up in every skill copy", async () => {
    const dir = fixture();
    mkdirSync(join(dir, "skills", "two", "scripts"), { recursive: true });
    writeFileSync(join(dir, "skills", "two", "scripts", "main.ts"), "// entry\n");
    await writeCopies(dir);
    writeFileSync(join(dir, "lib", "a.ts"), "export const a = 5;\n");
    const differences = await findDifferences(dir);
    expect(differences).toHaveLength(2);
  });
});
