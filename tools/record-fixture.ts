// Record one live pull request as an anonymized status fixture.
//
//   bun run tools/record-fixture.ts <owner/name> <pr> <fixture-name>
//       --git-dir <clone> [--policy <file>] [--keep-login <login>]... [--expected]
//
// The repository is an argument only. It never appears in a committed file.
// Reads are GET and GraphQL queries. The tool writes tests/fixtures/status/<name>.json.
// With --expected it also writes <name>.expected.json from the current evaluator.
// Review that file by hand: it is the claim that the tests check.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { newGatherCache } from "../lib/github/gather.ts";
import { loadPolicy } from "../lib/policy/load.ts";
import { evaluate } from "../lib/status/evaluate.ts";
import { statusFor } from "../lib/status/run.ts";
import { parseRepoSlug } from "../lib/types.ts";
import { anonymize } from "./anonymize-snapshot.ts";

const root = join(import.meta.dir, "..");
const DEFAULT_POLICY = join(root, "examples", "comment-verdict-merge-queue.toml");

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

const args = process.argv.slice(2);
const positional: string[] = [];
const keep: string[] = [];
let gitDir: string | undefined;
let policyPath = DEFAULT_POLICY;
let expected = false;
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i] ?? "";
  if (arg === "--keep-login") {
    keep.push(args[(i += 1)] ?? fail("--keep-login needs a value"));
  } else if (arg === "--git-dir") {
    gitDir = args[(i += 1)] ?? fail("--git-dir needs a value");
  } else if (arg === "--policy") {
    policyPath = args[(i += 1)] ?? fail("--policy needs a value");
  } else if (arg === "--expected") {
    expected = true;
  } else {
    positional.push(arg);
  }
}
const [repoArg, prArg, name] = positional;
const repo = parseRepoSlug(repoArg ?? "");
if (!repo.ok || prArg === undefined || !/^\d+$/.test(prArg) || name === undefined || !/^[a-z0-9-]+$/.test(name)) {
  fail("usage: record-fixture.ts <owner/name> <pr> <fixture-name> [--git-dir path] [--policy file] [--keep-login login] [--expected]");
}
const loaded = loadPolicy({ text: await readFile(policyPath, "utf8"), source: "local" });
if (!loaded.ok) {
  fail(`invalid policy: ${loaded.errors.map((e) => e.message).join("; ")}`);
}

const result = await statusFor(repo.value, Number(prArg), {
  cwd: "/",
  ...(gitDir === undefined ? {} : { gitDir }),
  localPolicy: { policy: loaded.policy },
  cache: newGatherCache(),
  policies: new Map(),
  fetchedBases: new Set(),
  gitQueue: { tail: Promise.resolve() },
});
if (result.kind !== "verdict" || result.snapshot === null) {
  fail("could not read the pull request");
}
const { snapshot, leaks } = anonymize(result.snapshot, { keepLogins: keep, policy: loaded.policy });
if (leaks.length > 0) {
  fail(`the anonymized snapshot still holds ${leaks.length} real name(s); add a rule to tools/anonymize-snapshot.ts`);
}
const dir = join(root, "tests", "fixtures", "status");
await writeFile(join(dir, `${name}.json`), `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`wrote tests/fixtures/status/${name}.json`);
if (expected) {
  const verdict = evaluate(snapshot, loaded.policy, "local");
  const codes = [...new Set(verdict.findings.map((f) => f.code))].sort();
  await writeFile(join(dir, `${name}.expected.json`), `${JSON.stringify({ state: verdict.state, codes }, null, 2)}\n`);
  console.log(`wrote ${name}.expected.json: ${verdict.state} ${codes.join(",")}`);
}
