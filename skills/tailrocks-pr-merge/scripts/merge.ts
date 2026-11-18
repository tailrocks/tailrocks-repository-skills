// Entry point of tailrocks-pr-merge. Run: bun run <skill-dir>/scripts/merge.ts <step> <PR> --confirm <PR>
// Run with --help for the usage and the exit codes.
import { main } from "./lib/merge/cli.ts";

process.exit(await main(process.argv.slice(2)));
