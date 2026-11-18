// Exit codes of create.ts. Each code has one meaning. The same table is in SKILL.md.

export const EXIT = {
  /** plan: the plan is clean. open: the PR is open and finished. */
  done: 0,
  /** Usage error, invalid policy, or Bun too old. */
  usage: 2,
  /** Refused or stopped, and nothing was written. A failed read ends here too. */
  refused: 3,
  /** plan: the agent must act. open: part of the work was written. */
  act: 20,
} as const;

export const EXIT_TABLE = `exit codes:
  0   done: the plan is clean, or the PR is open and finished
  10  never returned by this script
  20  plan: you must act (see the blockers). open: part was written (read the output)
  3   refused or stopped, and nothing was written (read the output)
  2   usage error, invalid policy, or Bun too old
  any other code: the script crashed. Stop and report the output.`;
