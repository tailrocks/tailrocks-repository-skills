// Entry point of tailrocks-pr-fleet. Run: bun run <skill-dir>/scripts/fleet.ts <plan|apply>
// Run with --help for the usage and the exit codes.
import { main } from "./lib/fleet/cli.ts";

process.exit(await main(process.argv.slice(2)));
