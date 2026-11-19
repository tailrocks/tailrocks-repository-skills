// Policy steps that pr-create and pr-refresh share: the sign-off rule, the
// inventory check, and the runner of the `[[prepush]]` steps. Each skill keeps
// its own way to read git and to run a command. The rule itself lives here once.

import { matchesAnyGlob } from "./glob.ts";
import type { Policy, PolicyInventory, PolicyPrepushStep } from "./policy/types.ts";
import { hasSignoff } from "./status/text.ts";

// ---------- Sign-off ----------

/**
 * True when the policy wants a Signed-off-by line on a commit and it has none.
 * `exemptBot` is true when the policy exempts the author of the commit as a
 * bot. Each caller decides that from what it knows (a login, or a name and an
 * email); the policy keys are read here.
 */
export function signoffRequired(policy: Policy, message: string, isBotAuthor: boolean): boolean {
  return policy.dco.required && !hasSignoff(message) && !(policy.dco.bot_commits === "exempt" && isBotAuthor);
}

// ---------- Inventories ----------

const PATH_TOKEN = /[A-Za-z0-9_.@+/-]+/g;

/**
 * Added files that an inventory must name and does not. A file is enforced only
 * when its group (the first `group_depth` path segments) is already listed.
 */
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
    if (group !== "" && listed.some((token) => token.startsWith(`${group}/`))) {
      misses.push(file);
    }
  }
  return misses;
}

/** True when the inventory covers at least one added file, so a missing inventory file matters. */
export function inventoryApplies(inventory: PolicyInventory, added: readonly string[]): boolean {
  return added.some((file) => matchesAnyGlob(inventory.added, file) && !matchesAnyGlob(inventory.exclude, file));
}

/** The next action for an inventory that misses files. `then` is what the caller does after the edit. */
export function inventoryFix(inventory: PolicyInventory, then: string): string {
  return inventory.update.length > 0
    ? `add them to ${inventory.file} (the policy update command is: ${inventory.update.join(" ")}), ${then}`
    : `add them to ${inventory.file}, ${then}`;
}

// ---------- Pre-push steps ----------

export const TAIL_LINES = 12;

/** The last non-empty lines of a command output. */
export function tailLines(text: string, count: number = TAIL_LINES): readonly string[] {
  return text.split("\n").filter((line) => line.trim() !== "").slice(-count);
}

export function whenChanged(globs: readonly string[], changed: readonly string[]): boolean {
  return changed.some((file) => matchesAnyGlob(globs, file));
}

export interface PrepushRun {
  /** The names of the steps that ran, the failed one included. */
  readonly ran: readonly string[];
  readonly failure: { readonly step: PolicyPrepushStep; readonly code: number; readonly tail: readonly string[] } | null;
}

/**
 * Run the steps in order. A step with `when_changed` runs only when a changed
 * file matches. The first failure stops the run. `runStep` is the caller's way
 * to run a command (an argument array, never a shell string) in the step's
 * directory, and it returns the exit code and the output.
 */
export async function runPrepushSteps(
  steps: readonly PolicyPrepushStep[],
  changed: readonly string[],
  runStep: (step: PolicyPrepushStep) => Promise<{ readonly code: number; readonly output: string }>,
): Promise<PrepushRun> {
  const ran: string[] = [];
  for (const step of steps) {
    if (step.when_changed.length > 0 && !whenChanged(step.when_changed, changed)) {
      continue;
    }
    const result = await runStep(step);
    ran.push(step.name);
    if (result.code !== 0) {
      return { ran, failure: { step, code: result.code, tail: tailLines(result.output) } };
    }
  }
  return { ran, failure: null };
}
