// Entry point of tailrocks-pr-refresh. Run: bun run <skill-dir>/scripts/refresh.ts <mode> <pr> [options]
import { main } from "./lib/refresh/cli.ts";

process.exit(await main(process.argv.slice(2)));
