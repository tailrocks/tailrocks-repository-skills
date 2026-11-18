// A real process that runs the real watch step on a fake GitHub, with real
// signals, a real pid, and a real clock. Tests start it and stop it.
//   bun tests/helpers/watch-child.ts <lock-dir>
import { processExists, processStartTime } from "../../lib/merge/lock.ts";
import { onStopSignal } from "../../lib/merge/signals.ts";
import { watchStep } from "../../lib/merge/watch.ts";
import { makeWorld } from "./merge-world.ts";

const lockDir = process.argv[2] ?? "";
const world = makeWorld();
world.queue({});
const io = { ...world.io, lockDir, pid: process.pid, isAlive: processExists, startOf: processStartTime, onStopSignal, exit: (code: number) => process.exit(code), sleep: (ms: number) => Bun.sleep(ms), now: () => Date.now() };
const outcome = await watchStep(
  { ...world.context(), io, say: (line: string) => console.log(line) },
  { intervalSeconds: 180, timeoutSeconds: 600 },
);
process.exit(outcome.exit);
