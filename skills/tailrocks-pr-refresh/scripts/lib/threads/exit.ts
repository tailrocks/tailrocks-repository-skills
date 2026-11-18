// Exit codes of threads.ts. Each code has one meaning. The same table is in SKILL.md.

export const EXIT = {
  /** No unresolved thread is left. */
  done: 0,
  /** Usage error, invalid decisions file, invalid policy, or Bun too old. */
  usage: 2,
  /** Refused or stopped, and nothing was written. A failed read ends here too. */
  refused: 3,
  /** Threads are open, and only people can act. */
  waiting: 10,
  /** plan: the agent must decide or act. apply: part of the decisions was written. */
  act: 20,
} as const;

export const EXIT_TABLE = `exit codes:
  0   no unresolved thread is left
  10  only people can act on the open threads
  20  plan: you must decide or act. apply: part of the decisions was written
  3   refused or stopped, and nothing was written (read the output)
  2   usage error, invalid decisions file, or invalid policy
  any other code: the script crashed. Stop and report the output.`;
