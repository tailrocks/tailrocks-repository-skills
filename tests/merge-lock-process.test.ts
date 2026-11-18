import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireWatchLock, lockPath, processStartTime } from "../lib/merge/lock.ts";
import { parseRepoSlug } from "../lib/types.ts";

const child = join(import.meta.dir, "helpers", "watch-child.ts");
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const repo = (() => {
  const parsed = parseRepoSlug("example-org/example-repo");
  if (!parsed.ok) throw new Error("slug");
  return parsed.value;
})();

function lockDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pr-merge-proc-"));
  dirs.push(dir);
  return dir;
}

/** Start the watch child and wait until it holds the lock and polls. */
async function startWatcher(dir: string, json = false) {
  const proc = Bun.spawn({ cmd: [process.execPath, child, dir, ...(json ? ["json"] : [])], stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const reader = proc.stdout.getReader();
  let seen = "";
  while (!seen.includes("ready")) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error(`the child ended early: ${seen}`);
    seen += new TextDecoder().decode(chunk.value);
  }
  /** The rest of the output, read after the process ended. */
  const rest = async (): Promise<string> => {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return seen;
      seen += new TextDecoder().decode(chunk.value);
    }
  };
  return { proc, rest };
}

function tryLock(dir: string, pid: number) {
  return acquireWatchLock({
    dir,
    repo,
    number: 7,
    timeoutSeconds: 600,
    now: () => Date.now(),
    isAlive: (p) => {
      try {
        process.kill(p, 0);
        return true;
      } catch {
        return false;
      }
    },
    startOf: processStartTime,
    pid,
  });
}

describe("a watcher that is stopped by a signal", () => {
  test.each(["SIGTERM", "SIGINT", "SIGHUP"] as const)("%s removes the lock, exits 10, and the next watch gets the lock", async (signal) => {
    const dir = lockDir();
    const watcher = await startWatcher(dir);
    expect(existsSync(lockPath(dir, repo, 7))).toBe(true);
    watcher.proc.kill(signal);
    expect(await watcher.proc.exited).toBe(10);
    expect(await watcher.rest()).toContain(`stopped by ${signal}`);
    expect(existsSync(lockPath(dir, repo, 7))).toBe(false);
    const next = tryLock(dir, process.pid);
    expect(next.ok).toBe(true);
    if (next.ok) next.release();
  });

  test("with --json a stop signal prints one JSON object that says the watch was stopped", async () => {
    const dir = lockDir();
    const watcher = await startWatcher(dir, true);
    watcher.proc.kill("SIGTERM");
    expect(await watcher.proc.exited).toBe(10);
    const text = (await watcher.rest()).replace(/^ready\s*/, "");
    const parsed: unknown = JSON.parse(text);
    expect(parsed).toMatchObject({ schema: 1, step: "watch", number: 7, exit: 10, outcome: "stopped" });
    expect(text).toContain("stopped by SIGTERM");
    expect(existsSync(lockPath(dir, repo, 7))).toBe(false);
  });

  test("a watcher that is killed without a signal handler leaves a lock of a dead process, and the next watch takes it at once", async () => {
    const dir = lockDir();
    const watcher = await startWatcher(dir);
    watcher.proc.kill("SIGKILL");
    await watcher.proc.exited;
    expect(existsSync(lockPath(dir, repo, 7))).toBe(true);
    const next = tryLock(dir, process.pid);
    expect(next.ok).toBe(true);
    if (next.ok) next.release();
  });

  test("a live watcher keeps its lock against a second watcher", async () => {
    const dir = lockDir();
    const watcher = await startWatcher(dir);
    expect(tryLock(dir, process.pid).ok).toBe(false);
    watcher.proc.kill("SIGTERM");
    await watcher.proc.exited;
  });
});

describe("many processes over one stale lock", () => {
  test("exactly one process wins", async () => {
    const dir = lockDir();
    // A lock of a process that does not exist, written long ago.
    writeFileSync(lockPath(dir, repo, 7), JSON.stringify({ pid: 2_147_483_000, startedAt: 1, timeoutSeconds: 600 }));
    const racer = join(import.meta.dir, "helpers", "lock-racer.ts");
    const procs = Array.from({ length: 8 }, () => Bun.spawn({ cmd: [process.execPath, racer, dir], stdout: "pipe", stderr: "pipe", stdin: "ignore" }));
    const results = await Promise.all(procs.map(async (p) => (await new Response(p.stdout).text()).trim()));
    await Promise.all(procs.map((p) => p.exited));
    expect(results.filter((r) => r === "WON")).toHaveLength(1);
    expect(results.filter((r) => r === "LOST")).toHaveLength(7);
  });
});
