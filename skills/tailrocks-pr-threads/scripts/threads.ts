// Entry point of tailrocks-pr-threads.
// Run: bun run <skill-dir>/scripts/threads.ts <pr-number> plan|apply [--decisions file.json]
import { main } from "./lib/threads/cli.ts";

process.exit(await main(process.argv.slice(2)));
