import { describe, expect, test } from "bun:test";
import { assertBun, checkBunVersion } from "../lib/version.ts";

describe("bun version guard", () => {
  test("accepts the pinned minor and newer", () => {
    expect(checkBunVersion("1.4.0").ok).toBe(true);
    expect(checkBunVersion("1.4.4").ok).toBe(true);
    expect(checkBunVersion("1.5.0").ok).toBe(true);
    expect(checkBunVersion("2.0.0").ok).toBe(true);
    expect(checkBunVersion("1.4.5-canary.1").ok).toBe(true);
  });

  test("refuses older versions with a clear message", () => {
    for (const version of ["1.3.9", "1.0.0", "0.9.9"]) {
      const result = checkBunVersion(version);
      expect(result.ok ? "" : result.message).toContain("Bun 1.4 or newer");
    }
  });

  test("refuses an unreadable version", () => {
    expect(checkBunVersion("latest").ok).toBe(false);
    expect(checkBunVersion("").ok).toBe(false);
  });

  test("assertBun throws on old versions and passes on the running one", () => {
    expect(() => assertBun("1.2.0")).toThrow(/too old/);
    expect(() => assertBun()).not.toThrow();
  });
});
