import { describe, expect, test } from "bun:test";
import { run, scrub } from "../lib/proc.ts";

describe("scrub", () => {
  test("hides credentials in URLs", () => {
    expect(scrub("fatal: unable to access 'https://user:s3cret@example.invalid/x.git/'")).toBe(
      "fatal: unable to access 'https://***@example.invalid/x.git/'",
    );
    expect(scrub("remote: https://x-access-token:abc@example.invalid/r")).toBe("remote: https://***@example.invalid/r");
    expect(scrub("see https://tokenonly@example.invalid/")).toBe("see https://***@example.invalid/");
    expect(scrub("ssh://git:pw@example.invalid:22/x")).toBe("ssh://***@example.invalid:22/x");
  });

  test("keeps URLs without credentials", () => {
    expect(scrub("https://example.invalid/a@b")).toBe("https://example.invalid/a@b");
  });

  test("hides GitHub tokens", () => {
    const tokens = [
      "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8",
      "gho_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8",
      "ghs_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8",
      "ghu_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8",
      "github_pat_" + "11ABCDEFG0abcdefghijkl_mnopqrstuvwxyz0123456789",
    ];
    for (const token of tokens) {
      const out = scrub(`error with ${token} in text`);
      expect(out).toBe("error with *** in text");
      expect(out).not.toContain(token);
    }
  });

  test("hides authorization headers", () => {
    expect(scrub("Authorization: Bearer abc.def")).toBe("Authorization: Bearer ***");
    expect(scrub("authorization: token xyz")).toBe("authorization: token ***");
  });

  test("leaves ordinary text alone", () => {
    expect(scrub("ghost_town is fine, so is ghp_short")).toBe("ghost_town is fine, so is ghp_short");
  });
});

describe("run", () => {
  test("returns code, stdout, and stderr without a shell", async () => {
    const result = await run(["sh", "-c", 'printf out; printf err >&2; exit 3'], { cwd: "." });
    expect(result).toEqual({ code: 3, stdout: "out", stderr: "err" });
  });

  test("passes argv as is: no shell expansion", async () => {
    const result = await run(["echo", "$HOME", "*", "a b"], { cwd: "." });
    expect(result.stdout).toBe("$HOME * a b\n");
  });

  test("feeds stdin and env", async () => {
    const result = await run(["sh", "-c", 'cat; printf "%s" "$EXAMPLE_VALUE"'], {
      cwd: ".",
      stdin: "in:",
      env: { EXAMPLE_VALUE: "env" },
    });
    expect(result.stdout).toBe("in:env");
  });

  test("scrubs credentials from output", async () => {
    const result = await run(["sh", "-c", "echo 'https://u:p@example.invalid/x' >&2"], { cwd: "." });
    expect(result.stderr).toBe("https://***@example.invalid/x\n");
  });

  test("a missing program gives code 127, not a throw", async () => {
    const result = await run(["definitely-not-a-program-xyz"], { cwd: "." });
    expect(result.code).toBe(127);
    expect(result.stderr).toContain("failed to start");
  });

  test("an empty argv gives code 127", async () => {
    expect((await run([], { cwd: "." })).code).toBe(127);
  });
});

// Each case below is a gap that the code review reproduced against the first version.
describe("regression: credential scrubbing", () => {
  test("a password that holds @ is hidden up to the last @ before the host", () => {
    expect(scrub("https://user:p@ss@example.invalid/x.git")).toBe("https://***@example.invalid/x.git");
    expect(scrub("fatal: 'https://user:a@b@c@example.invalid:8443/x'")).toBe("fatal: 'https://***@example.invalid:8443/x'");
    expect(scrub("ssh://git@example.invalid/x")).toBe("ssh://***@example.invalid/x");
  });

  test("text after the host is not touched", () => {
    expect(scrub("https://example.invalid/path with a@b and https://u:p@h.invalid/y")).toBe(
      "https://example.invalid/path with a@b and https://***@h.invalid/y",
    );
  });

  test("a labelled classic token is hidden", () => {
    const token = "0123456789abcdef0123456789abcdef01234567";
    expect(scrub(`  - Token: ${token}`)).toBe("  - Token: ***");
    expect(scrub(`password=${token} done`)).toBe("password=*** done");
    expect(scrub(`secret: ${token}`)).not.toContain(token);
  });

  test("stdout is data: it is returned as is, and stderr is scrubbed", async () => {
    const text = "ssh://git@example.invalid/x ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8 Authorization: Bearer abc";
    const result = await run(["sh", "-c", `printf '%s' '${text}'; printf '%s' '${text}' >&2`], { cwd: "." });
    expect(result.stdout).toBe(text);
    expect(result.stderr).not.toBe(text);
    expect(result.stderr).not.toContain("ghp_");
    expect(result.stderr).toContain("ssh://***@example.invalid/x");
  });

  test("a spawn failure message is scrubbed", async () => {
    const result = await run(["https://u:p@example.invalid/not-a-program"], { cwd: "." });
    expect(result.code).toBe(127);
    expect(result.stderr).not.toContain("u:p");
  });
});
