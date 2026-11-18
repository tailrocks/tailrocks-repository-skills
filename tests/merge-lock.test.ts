import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { removeBodyFiles } from "../lib/body-file.ts";
import { acquireWatchLock, lockPath, processExists, STALE_MARGIN_MS } from "../lib/merge/lock.ts";
import { EXIT } from "../lib/merge/types.ts";
import { watchStep } from "../lib/merge/watch.ts";
import { parseRepoSlug } from "../lib/types.ts";
import { makeWorld, removeWorlds, type World } from "./helpers/merge-world.ts";
import { root } from "./helpers/status.ts";

afterEach(() => {
  removeBodyFiles();
  removeWorlds();
});

const repo = (() => {
  const parsed = parseRepoSlug("example-org/example-repo");
  if (!parsed.ok) throw new Error("slug");
  return parsed.value;
})();

function request(world: World, patch: Partial<Parameters<typeof acquireWatchLock>[0]> = {}) {
  return {
    dir: world.lockDir,
    repo,
    number: 7,
    timeoutSeconds: 5400,
    now: world.io.now,
    isAlive: world.io.isAlive,
    startOf: world.io.startOf,
    pid: world.io.pid,
    ...patch,
  };
}

const options = { intervalSeconds: 180, timeoutSeconds: 5400 };

describe("watch lock", () => {
  test("a second watcher for the same PR is refused", () => {
    const world = makeWorld();
    const first = acquireWatchLock(request(world));
    expect(first.ok).toBe(true);
    const second = acquireWatchLock(request(world, { pid: 5555 }));
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toContain("process 4242");
    if (first.ok) first.release();
    expect(acquireWatchLock(request(world, { pid: 5555 })).ok).toBe(true);
  });

  test("another PR or another repository has its own lock", () => {
    const world = makeWorld();
    expect(acquireWatchLock(request(world)).ok).toBe(true);
    expect(acquireWatchLock(request(world, { number: 8 })).ok).toBe(true);
    const other = parseRepoSlug("example-org/other-repo");
    if (!other.ok) throw new Error("slug");
    expect(acquireWatchLock(request(world, { repo: other.value })).ok).toBe(true);
  });

  test("the lock file records the pid and is made exclusively", () => {
    const world = makeWorld();
    acquireWatchLock(request(world));
    const written: unknown = JSON.parse(readFileSync(lockPath(world.lockDir, repo, 7), "utf8"));
    expect(written).toMatchObject({ pid: 4242, timeoutSeconds: 5400 });
  });

  test("release removes only the lock of this process", () => {
    const world = makeWorld();
    const first = acquireWatchLock(request(world));
    const path = lockPath(world.lockDir, repo, 7);
    writeFileSync(path, JSON.stringify({ pid: 9999, startedAt: world.io.now(), timeoutSeconds: 5400 }));
    if (first.ok) first.release();
    expect(existsSync(path)).toBe(true);
  });

  describe("a stale lock", () => {
    const held = (world: World, patch: Record<string, unknown> = {}) =>
      writeFileSync(
        lockPath(world.lockDir, repo, 7),
        JSON.stringify({ pid: 9999, startedAt: world.io.now() - 60_000, timeoutSeconds: 5400, ...patch }),
      );
    const tooOld = (world: World) => world.io.now() - 5400 * 1000 - STALE_MARGIN_MS - 1000;

    test("is replaced at once when its process is gone, whatever its age", () => {
      const world = makeWorld();
      held(world);
      expect(acquireWatchLock(request(world)).ok).toBe(true);
      expect(JSON.parse(readFileSync(lockPath(world.lockDir, repo, 7), "utf8"))).toMatchObject({ pid: 4242 });
    });

    test("is kept when its process is alive and the lock is young", () => {
      const world = makeWorld();
      world.alivePids.add(9999);
      held(world);
      expect(acquireWatchLock(request(world)).ok).toBe(false);
    });

    test("is replaced when its process is alive but the lock is older than its time bound plus the margin", () => {
      const world = makeWorld();
      world.alivePids.add(9999);
      held(world, { startedAt: tooOld(world) });
      expect(acquireWatchLock(request(world)).ok).toBe(true);
    });

    test("uses the time bound that the owner recorded", () => {
      const world = makeWorld();
      world.alivePids.add(9999);
      held(world, { startedAt: tooOld(world), timeoutSeconds: 86_400 });
      expect(acquireWatchLock(request(world)).ok).toBe(false);
    });

    test("is replaced when the pid was reused: the recorded start time differs from the live one", () => {
      const world = makeWorld();
      world.alivePids.add(9999);
      world.starts.set(9999, "700");
      held(world, { pidStart: "100" });
      expect(acquireWatchLock(request(world)).ok).toBe(true);
    });

    test("is kept when the start time matches, or when the platform shows none", () => {
      const same = makeWorld();
      same.alivePids.add(9999);
      same.starts.set(9999, "100");
      held(same, { pidStart: "100" });
      expect(acquireWatchLock(request(same)).ok).toBe(false);
      const none = makeWorld();
      none.alivePids.add(9999);
      held(none, { pidStart: "100" });
      expect(acquireWatchLock(request(none)).ok).toBe(false);
    });

    test("an unreadable lock file is never replaced", () => {
      const world = makeWorld();
      writeFileSync(lockPath(world.lockDir, repo, 7), "not json");
      const result = acquireWatchLock(request(world));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain(lockPath(world.lockDir, repo, 7));
    });

    test("the lock records the start time of its process", () => {
      const world = makeWorld();
      world.starts.set(4242, "555");
      acquireWatchLock(request(world));
      expect(JSON.parse(readFileSync(lockPath(world.lockDir, repo, 7), "utf8"))).toMatchObject({ pid: 4242, pidStart: "555" });
    });
  });

  describe("taking a stale lock", () => {
    const stale = (world: World) => {
      world.alivePids.add(5001).add(5002);
      writeFileSync(lockPath(world.lockDir, repo, 7), JSON.stringify({ pid: 9999, startedAt: world.io.now(), timeoutSeconds: 5400 }));
    };

    test("two acquirers that both judge the lock stale: exactly one wins", () => {
      const world = makeWorld();
      stale(world);
      const box: { inner: ReturnType<typeof acquireWatchLock> | null } = { inner: null };
      // While the first acquirer decides, the second runs its whole acquisition.
      const first = acquireWatchLock(
        request(world, {
          pid: 5001,
          isAlive: (pid) => {
            if (box.inner === null && pid === 9999) {
              box.inner = acquireWatchLock(request(world, { pid: 5002 }));
            }
            return world.alivePids.has(pid);
          },
        }),
      );
      expect(box.inner).not.toBeNull();
      expect([first.ok, box.inner?.ok].filter(Boolean)).toHaveLength(1);
      const owner = JSON.parse(readFileSync(lockPath(world.lockDir, repo, 7), "utf8"));
      expect(owner.pid).toBe(first.ok ? 5001 : 5002);
    });

    test("the loser of a rename gets ENOENT and starts again; it never crashes", () => {
      const world = makeWorld();
      stale(world);
      const box: { inner: ReturnType<typeof acquireWatchLock> | null } = { inner: null };
      const outer = acquireWatchLock(
        request(world, {
          pid: 5001,
          isAlive: (pid) => {
            if (box.inner === null) box.inner = acquireWatchLock(request(world, { pid: 5002 }));
            return world.alivePids.has(pid);
          },
        }),
      );
      expect(box.inner?.ok).toBe(true);
      expect(outer.ok).toBe(false);
    });

    test("no tombstone is left behind", () => {
      const world = makeWorld();
      stale(world);
      acquireWatchLock(request(world));
      expect(readdirSync(world.lockDir)).toEqual([lockPath(world.lockDir, repo, 7).split("/").pop() ?? ""]);
    });
  });
});

describe("watch with the lock", () => {
  const queued = () => {
    const world = makeWorld();
    world.queue({});
    return world;
  };

  test("a second watcher exits 3 and polls nothing", async () => {
    const world = queued();
    acquireWatchLock(request(world, { pid: 5555 }));
    world.alivePids.add(5555);
    const outcome = await watchStep(world.context(), options);
    expect(outcome.exit).toBe(EXIT.refused);
    expect(outcome.outcome).toBe("refused");
    expect(world.sleeps).toEqual([]);
    expect(world.gathers).toBe(1);
    expect(world.lines.join("\n")).toContain("already watches PR 7");
  });

  test("the lock is removed when the watch ends", async () => {
    for (const ending of ["merged", "timeout", "ejected"] as const) {
      const world = queued();
      world.script = (gather, w) => {
        if (ending === "merged" && gather === 2) w.prState = "MERGED";
        if (ending === "ejected" && gather === 2) w.queue(null);
      };
      await watchStep(world.context(), { intervalSeconds: 180, timeoutSeconds: ending === "timeout" ? 200 : 5400 });
      expect(existsSync(lockPath(world.lockDir, repo, 7))).toBe(false);
    }
  });

  test("the lock is removed when the watch throws", async () => {
    const world = queued();
    const io = { ...world.io, sleep: async () => Promise.reject(new Error("sleep failed")) };
    await expect(watchStep(world.context({ io }), options)).rejects.toThrow("sleep failed");
    expect(readdirSync(world.lockDir)).toEqual([]);
  });

  test("a stop signal removes the lock, says why, and ends the run with exit 10", async () => {
    const world = queued();
    let handler: ((signal: "SIGTERM" | "SIGINT" | "SIGHUP") => void) | undefined;
    world.script = (gather) => {
      if (gather === 2) {
        handler = world.signalHandlers[0];
        handler?.("SIGTERM");
      }
    };
    await watchStep(world.context(), { intervalSeconds: 180, timeoutSeconds: 600 }).catch(() => undefined);
    expect(handler).toBeDefined();
    expect(world.exits).toEqual([EXIT.waiting]);
    expect(world.lines.join("\n")).toContain("stopped by SIGTERM");
    expect(existsSync(lockPath(world.lockDir, repo, 7))).toBe(false);
  });

  test("the signal handlers exist only while the watch runs", async () => {
    const world = queued();
    let during = 0;
    world.script = (gather) => {
      if (gather === 2) during = world.signalHandlers.length;
    };
    await watchStep(world.context(), { intervalSeconds: 180, timeoutSeconds: 200 });
    expect(during).toBe(1);
    expect(world.signalHandlers).toHaveLength(0);
  });

  test("a refused watcher installs no handler", async () => {
    const world = queued();
    acquireWatchLock(request(world, { pid: 5555 }));
    world.alivePids.add(5555);
    let installed = 0;
    const io = { ...world.io, onStopSignal: () => ((installed += 1), () => undefined) };
    await watchStep(world.context({ io }), options);
    expect(installed).toBe(0);
  });

  test("the plan run takes no lock", async () => {
    const world = queued();
    await watchStep(world.context({ confirmed: false }), options);
    expect(readdirSync(world.lockDir)).toEqual([]);
  });

  test("a stale lock is replaced, and the watch runs", async () => {
    const world = queued();
    writeFileSync(
      lockPath(world.lockDir, repo, 7),
      JSON.stringify({ pid: 9999, startedAt: world.io.now() - 10_000_000, timeoutSeconds: 100 }),
    );
    world.script = (gather, w) => {
      if (gather === 2) w.prState = "MERGED";
    };
    const outcome = await watchStep(world.context(), options);
    expect(outcome.outcome).toBe("merged");
  });
});

describe("process check", () => {
  test("a live process exists, and a pid that is not used does not", () => {
    expect(processExists(process.pid)).toBe(true);
    expect(processExists(2_147_483_000)).toBe(false);
  });

  test("the library sends signal 0 only and never kills", () => {
    const dir = join(root, "lib", "merge");
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const text = readFileSync(join(dir, name), "utf8");
      const kills = text.match(/\bkill\s*\(([^)]*)\)/g) ?? [];
      for (const call of kills) {
        expect(call).toMatch(/\(\s*pid\s*,\s*0\s*\)/);
      }
      expect(text).not.toMatch(/SIGKILL|pkill|killall/);
    }
  });

  test("a lock file older than the margin keeps its mtime irrelevant", () => {
    // The age comes from the recorded start time, not from the file system.
    const world = makeWorld();
    const path = lockPath(world.lockDir, repo, 7);
    writeFileSync(path, JSON.stringify({ pid: 4242, startedAt: world.io.now(), timeoutSeconds: 5400 }));
    utimesSync(path, new Date(0), new Date(0));
    expect(acquireWatchLock(request(world, { pid: 5555 })).ok).toBe(false);
  });
});
