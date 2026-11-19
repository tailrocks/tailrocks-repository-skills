// The policy steps that follow a base merge: regenerate outputs, check
// inventories, scan sign-offs, run pre-push steps. Commands are argument
// arrays from the base-branch policy. No command passes through a shell.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { matchesAnyGlob } from "../glob.ts";
import { inventoryApplies, inventoryFix, inventoryMisses, runPrepushSteps, signoffRequired, whenChanged } from "../policy-steps.ts";
import type { Policy, PolicyInventory, PolicyPrepushStep, PolicyRegenerateStep } from "../policy/types.ts";
import { run, scrub } from "../proc.ts";
import { sameLogin } from "../status/text.ts";
import type { PrSnapshot } from "../status/types.ts";
import type { Sha } from "../types.ts";
import { must, parseShaOrThrow, splitNul, type Repo } from "./gitx.ts";

export interface StepProblem {
  readonly code: "regenerate_failed" | "inventory_miss" | "dco_missing" | "prepush_failed";
  readonly headline: string;
  readonly next: string;
  readonly details: readonly string[];
}

// ---------- Changed files ----------

/**
 * Files changed by the PR against the base, plus files changed since the old
 * head. `--no-renames` lists both the old and the new name of a moved file.
 */
export async function changedFiles(repo: Repo, base: Sha, oldHead: Sha): Promise<readonly string[]> {
  const names = new Set<string>();
  for (const from of [base, oldHead]) {
    for (const name of splitNul(await must(repo, ["diff", "--name-only", "--no-renames", "-z", from, "HEAD"]))) {
      names.add(name);
    }
  }
  return [...names].sort();
}

export function matchesWhenChanged(globs: readonly string[], changed: readonly string[]): boolean {
  return whenChanged(globs, changed);
}

// ---------- Running a policy command ----------

export interface CommandResult {
  readonly ok: boolean;
  readonly tail: readonly string[];
}

export async function runPolicyCommand(argv: readonly string[], worktree: string, cwd: string): Promise<CommandResult> {
  const result = await run(argv, { cwd: join(worktree, cwd) });
  const text = scrub(`${result.stdout}\n${result.stderr}`);
  const tail = text.split("\n").filter((line) => line.trim() !== "").slice(-12);
  return { ok: result.code === 0, tail };
}

// ---------- Regenerate ----------

const CONFLICT_MARKER = /^(?:<{7} |>{7} )/m;
const MAX_MARKER_SCAN_BYTES = 8_000_000;

const ABSENT = "absent";

/** A content hash of one work tree file, or "absent". */
function fileState(file: string): string {
  try {
    return createHash("sha1").update(readFileSync(file)).digest("hex");
  } catch {
    return ABSENT;
  }
}

/**
 * The exact state (content hash, or "absent") of every tracked or untracked
 * path under the entry's output globs. A generator run is judged against it.
 */
export async function snapshotOutputs(repo: Repo, entry: PolicyRegenerateStep): Promise<ReadonlyMap<string, string>> {
  const listing = await must(repo, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  const states = new Map<string, string>();
  for (const path of splitNul(listing)) {
    if (matchesAnyGlob(entry.outputs, path)) {
      states.set(path, fileState(join(repo.cwd, path)));
    }
  }
  return states;
}

/** Paths under the entry's output globs whose content differs from the snapshot taken before the run. */
export async function outputsChangedSince(repo: Repo, entry: PolicyRegenerateStep, before: ReadonlyMap<string, string>): Promise<readonly string[]> {
  const after = await snapshotOutputs(repo, entry);
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((path) => (before.get(path) ?? ABSENT) !== (after.get(path) ?? ABSENT)).sort();
}

export function hasConflictMarkers(file: string): boolean {
  try {
    if (statSync(file).size > MAX_MARKER_SCAN_BYTES) {
      return false;
    }
    return CONFLICT_MARKER.test(readFileSync(file, "latin1"));
  } catch {
    return false;
  }
}

export interface RegenerateRun {
  readonly entry: PolicyRegenerateStep;
  /** Paths to stage: the conflicted outputs and the outputs that the generator changed. */
  readonly paths: readonly string[];
  readonly problem: StepProblem | null;
}

/**
 * Regenerate one entry. `conflicted` lists the unmerged output paths of the
 * entry. Each one is deleted first, so the generator must write it again; a
 * conflict marker or a missing output after the run is a failure.
 */
export async function regenerateEntry(repo: Repo, entry: PolicyRegenerateStep, conflicted: readonly string[]): Promise<RegenerateRun> {
  for (const path of conflicted) {
    rmSync(join(repo.cwd, path), { force: true });
  }
  // Only what the generator changes from this snapshot may be staged. A file that
  // was already under an output glob (a hand-made file) is never accepted.
  const before = await snapshotOutputs(repo, entry);
  const result = await runPolicyCommand(entry.run, repo.cwd, entry.cwd);
  const fail = (headline: string, details: readonly string[]): RegenerateRun => ({
    entry,
    paths: [],
    problem: {
      code: "regenerate_failed",
      headline,
      next: "fix the generator or its inputs; never hand-merge generated files",
      details,
    },
  });
  if (!result.ok) {
    return fail(`regenerate step "${entry.name}" failed`, result.tail);
  }
  const changed = await outputsChangedSince(repo, entry, before);
  const missing = conflicted.filter((path) => !existsSync(join(repo.cwd, path)));
  if (missing.length > 0) {
    return fail(`regenerate step "${entry.name}" did not write ${missing.length} conflicted output(s)`, missing);
  }
  const paths = [...new Set([...conflicted, ...changed])].sort();
  const marked = conflicted.filter((path) => hasConflictMarkers(join(repo.cwd, path)));
  if (marked.length > 0) {
    return fail(`regenerate step "${entry.name}" left conflict markers in an output`, marked);
  }
  return { entry, paths, problem: null };
}

// ---------- Inventories ----------

export async function checkInventories(repo: Repo, policy: Policy, base: Sha): Promise<readonly StepProblem[]> {
  if (policy.inventories.length === 0) {
    return [];
  }
  const added = splitNul(await must(repo, ["diff", "--name-only", "--no-renames", "-z", "--diff-filter=A", base, "HEAD"]));
  const problems: StepProblem[] = [];
  for (const inventory of policy.inventories) {
    const file = join(repo.cwd, inventory.file);
    if (!existsSync(file)) {
      if (inventoryApplies(inventory, added)) {
        problems.push({
          code: "inventory_miss",
          headline: `inventory "${inventory.name}": the file ${inventory.file} does not exist`,
          next: `create ${inventory.file} and list the added files`,
          details: [],
        });
      }
      continue;
    }
    const misses = inventoryMisses(inventory, added, readFileSync(file, "utf8"));
    if (misses.length > 0) {
      problems.push({
        code: "inventory_miss",
        headline: `inventory "${inventory.name}" does not name ${misses.length} added file(s)`,
        next: inventoryFix(inventory, "then run the mode again"),
        details: misses.slice(0, 20),
      });
    }
  }
  return problems;
}

// ---------- Sign-off scan ----------

/** Commits in base..HEAD without a trailer that the DCO policy does not exempt. */
export async function unsignedCommits(repo: Repo, policy: Policy, snapshot: PrSnapshot, base: Sha): Promise<readonly Sha[]> {
  if (!policy.dco.required) {
    return [];
  }
  const listing = await must(repo, ["rev-list", "--no-merges", "HEAD", `^${base}`]);
  const unsigned: Sha[] = [];
  for (const line of listing.split("\n").filter((l) => l.trim() !== "")) {
    const sha = parseShaOrThrow(line.trim());
    const message = await must(repo, ["log", "-1", "--format=%B", sha]);
    const login = snapshot.commits.find((c) => c.oid === sha)?.authorLogin ?? null;
    const isBot = login !== null && policy.dco.bot_authors.some((bot) => sameLogin(bot, login));
    if (signoffRequired(policy, message, isBot)) {
      unsigned.push(sha);
    }
  }
  return unsigned;
}

// ---------- Pre-push steps ----------

export async function runPrepush(
  repo: Repo,
  steps: readonly PolicyPrepushStep[],
  changed: readonly string[],
): Promise<StepProblem | null> {
  const outcome = await runPrepushSteps(steps, changed, async (step) => {
    const result = await runPolicyCommand(step.run, repo.cwd, step.cwd);
    return { code: result.ok ? 0 : 1, output: result.tail.join("\n") };
  });
  if (outcome.failure === null) {
    return null;
  }
  const { step, tail } = outcome.failure;
  return {
    code: "prepush_failed",
    headline: `pre-push step "${step.name}" failed; nothing was pushed`,
    next: `fix the cause of the failure of "${step.name}", then run the mode again`,
    details: tail,
  };
}
