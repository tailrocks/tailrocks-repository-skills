// Entry point of tailrocks-pr-create.
// Run: bun run <skill-dir>/scripts/create.ts plan|open [options]. Run with --help for the usage and the exit codes.
import { runMain } from "./lib/create/cli.ts";

process.exit(await runMain(process.argv.slice(2)));
