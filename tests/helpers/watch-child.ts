// A real process that runs the real command line (`main`) with the watch step on a
// fake GitHub, with real signals, a real pid, and a real clock. Tests start it and stop it.
//   bun tests/helpers/watch-child.ts <lock-dir> [json]
// It prints one line, "ready", when the watch is polling.
import { main } from "../../lib/merge/cli.ts";
import { processExists, processStartTime } from "../../lib/merge/lock.ts";
import { onStopSignal } from "../../lib/merge/signals.ts";
import { makeWorld } from "./merge-world.ts";

const lockDir = process.argv[2] ?? "";
const json = process.argv[3] === "json";
const world = makeWorld();
world.queue({});
let announced = false;
const io = {
  ...world.io,
  lockDir,
  pid: process.pid,
  isAlive: processExists,
  startOf: processStartTime,
  onStopSignal,
  exit: (code: number) => process.exit(code),
  sleep: (ms: number) => {
    if (!announced) {
      announced = true;
      console.log("ready");
    }
    return Bun.sleep(ms);
  },
  now: () => Date.now(),
};
const argv = ["watch", "7", "--confirm", "7", "--repo", "example-org/example-repo", "--interval", "180", "--timeout", "600", ...(json ? ["--json"] : [])];
process.exit(await main(argv, { io, out: (line) => console.log(line) }));
