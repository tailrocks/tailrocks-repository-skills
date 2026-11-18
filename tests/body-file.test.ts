import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { isBodyFilePath, removeBodyFiles, writeBodyFile } from "../lib/body-file.ts";

afterAll(() => removeBodyFiles());

describe("body file helper", () => {
  test("writes the text to a private file in the OS temp dir", () => {
    const path = writeBodyFile("hello\n");
    expect(readFileSync(path, "utf8")).toBe("hello\n");
    expect(dirname(dirname(path))).toBe(tmpdir().replace(/\/$/, ""));
    expect(lstatSync(path).mode & 0o777).toBe(0o600);
    expect(lstatSync(dirname(path)).mode & 0o777).toBe(0o700);
    expect(isBodyFilePath(path)).toBe(true);
  });

  test("each call makes a new file in the same directory", () => {
    const a = writeBodyFile("a");
    const b = writeBodyFile("b");
    expect(a).not.toBe(b);
    expect(dirname(a)).toBe(dirname(b));
  });

  test("a path that the helper did not make is not accepted", () => {
    const path = writeBodyFile("x");
    for (const other of ["", "/etc/passwd", `${path}x`, `${dirname(path)}/other.md`, `${dirname(path)}/../x`, `${dirname(path)}/body-1.md/../body-1.md`, "body-1.md"]) {
      expect(isBodyFilePath(other)).toBe(false);
    }
  });

  test("an empty, NUL, or oversize body is refused", () => {
    expect(() => writeBodyFile("")).toThrow(RangeError);
    expect(() => writeBodyFile("a\0b")).toThrow(RangeError);
    expect(() => writeBodyFile("x".repeat(262_145))).toThrow(RangeError);
  });

  test("removal deletes the exact directory and ends acceptance", () => {
    const path = writeBodyFile("x");
    removeBodyFiles();
    expect(existsSync(path)).toBe(false);
    expect(isBodyFilePath(path)).toBe(false);
    // A later write starts a new directory.
    const again = writeBodyFile("y");
    expect(isBodyFilePath(again)).toBe(true);
  });
});
