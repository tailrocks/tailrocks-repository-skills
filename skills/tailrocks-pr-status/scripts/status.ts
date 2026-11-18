// Entry point of tailrocks-pr-status. Run: bun run <skill-dir>/scripts/status.ts <PR | --all>
import { main } from "./lib/status/cli.ts";

process.exit(await main(process.argv.slice(2)));
