// One of several processes that take a lock at the same time. Prints WON or LOST.
//   bun tests/helpers/lock-racer.ts <lock-dir>
import { acquireWatchLock, processExists, processStartTime } from "../../lib/merge/lock.ts";
import { parseRepoSlug } from "../../lib/types.ts";

const repo = parseRepoSlug("example-org/example-repo");
if (!repo.ok) throw new Error("slug");
const result = acquireWatchLock({
  dir: process.argv[2] ?? "",
  repo: repo.value,
  number: 7,
  timeoutSeconds: 600,
  now: () => Date.now(),
  isAlive: processExists,
  startOf: processStartTime,
  pid: process.pid,
});
console.log(result.ok ? "WON" : "LOST");
if (result.ok) {
  // Keep the lock until every racer has decided.
  await Bun.sleep(1500);
  result.release();
}
