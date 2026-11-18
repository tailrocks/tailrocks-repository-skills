// The policy steps that follow a base merge: regenerate outputs, check
// inventories, scan sign-offs, run pre-push steps. Commands are argument
// arrays from the base-branch policy. No command passes through a shell.

import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { matchesAnyGlob } from "../glob.ts";
import type { Policy, PolicyInventory, PolicyPrepushStep, PolicyRegenerateStep } from "../policy/types.ts";
import { run, scrub } from "../proc.ts";
import { hasSignoff, sameLogin } from "../status/text.ts";
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

/** Files changed by the PR against the base, plus files changed since the old head. */
export async function changedFiles(repo: Repo, base: Sha, oldHead: Sha): Promise<readonly string[]> {
  const names = new Set<string>();
  for (const from of [base, oldHead]) {
    for (const name of splitNul(await must(repo, ["diff", "--name-only", "-z", from, "HEAD"]))) {
      names.add(name);
    }
  }
  return [...names].sort();
}

export function matchesWhenChanged(globs: readonly string[], changed: readonly string[]): boolean {
  return changed.some((file) => matchesAnyGlob(globs, file));
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

/** Files in the work tree that are modified or untracked and match the entry's output globs. */
export async function changedOutputs(repo: Repo, entry: PolicyRegenerateStep): Promise<readonly string[]> {
  const listing = await must(repo, ["ls-files", "-z", "--modified", "--others", "--exclude-standard"]);
  return splitNul(listing).filter((file) => matchesAnyGlob(entry.outputs, file) && existsSync(join(repo.cwd, file)));
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
  /** Paths to stage: the conflicted outputs and any other changed output. */
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
  const changed = await changedOutputs(repo, entry);
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

const PATH_TOKEN = /[A-Za-z0-9_.@+/-]+/g;

/** Added files that an inventory must name and does not. Pure. */
export function inventoryMisses(inventory: PolicyInventory, added: readonly string[], text: string): readonly string[] {
  const tokens = new Set(text.match(PATH_TOKEN) ?? []);
  const listed = [...tokens];
  const misses: string[] = [];
  for (const file of added) {
    if (file === inventory.file || !matchesAnyGlob(inventory.added, file) || matchesAnyGlob(inventory.exclude, file)) {
      continue;
    }
    if (tokens.has(file)) {
      continue;
    }
    const segments = file.split("/");
    const group = segments.slice(0, Math.min(inventory.group_depth, segments.length - 1)).join("/");
    // Enforced only for groups that the inventory already lists.
    if (group !== "" && listed.some((token) => token.startsWith(`${group}/`))) {
      misses.push(file);
    }
  }
  return misses;
}

export async function checkInventories(repo: Repo, policy: Policy, base: Sha): Promise<readonly StepProblem[]> {
  if (policy.inventories.length === 0) {
    return [];
  }
  const added = splitNul(await must(repo, ["diff", "--name-only", "-z", "--diff-filter=A", base, "HEAD"]));
  const problems: StepProblem[] = [];
  for (const inventory of policy.inventories) {
    const file = join(repo.cwd, inventory.file);
    if (!existsSync(file)) {
      if (added.some((f) => matchesAnyGlob(inventory.added, f) && !matchesAnyGlob(inventory.exclude, f))) {
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
        next:
          inventory.update.length > 0
            ? `add them to ${inventory.file} (the policy update command is: ${inventory.update.join(" ")}), then run the mode again`
            : `add them to ${inventory.file}, then run the mode again`,
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
    if (hasSignoff(message)) {
      continue;
    }
    const login = snapshot.commits.find((c) => c.oid === sha)?.authorLogin ?? null;
    const exempt =
      policy.dco.bot_commits === "exempt" && login !== null && policy.dco.bot_authors.some((bot) => sameLogin(bot, login));
    if (!exempt) {
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
  for (const step of steps) {
    if (step.when_changed.length > 0 && !matchesWhenChanged(step.when_changed, changed)) {
      continue;
    }
    const result = await runPolicyCommand(step.run, repo.cwd, step.cwd);
    if (!result.ok) {
      return {
        code: "prepush_failed",
        headline: `pre-push step "${step.name}" failed; nothing was pushed`,
        next: `fix the cause of the failure of "${step.name}", then run the mode again`,
        details: result.tail,
      };
    }
  }
  return null;
}
