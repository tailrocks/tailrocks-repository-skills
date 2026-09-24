# Progress and decision record

Status: 0.2.0 packaging and skill boundary update is pending verification; not
released.

- Source set: `repo-merge` coordinates selected SOURCES or explicit
  `--all-work`; audit and cleanup are distinct capabilities. See
  [collection decisions](docs/research.md) and [architecture](docs/architecture.md).
- Target: `--target-branch` is the sole destination; omission means literal
  `main`. Non-main runs have no main side effects. Resume revalidates the same
  local source/target record.
- Decisions: remove/fold `tailrocks-repository-converge` into `repo-merge`;
  remove the campaign/journal/lease/receipt engine. Keep other Tailrocks
  collections at their existing ownership boundaries.
- Tests and CI: v0.1.x evidence is historical and tied to the superseded
  implementation. Current 0.2.0 outcomes remain pending until the root runs
  and records the required checks and independent verification. This delegated
  docs/packaging task did not run tests.
- Landing: no 0.2.0 landing, release, or fresh-install claim is made here.
  Actual PR review and merge must use the named lifecycle owners.
- Cleanup: this task cleaned no repositories, refs, worktrees, or user data.
  Product cleanup remains source-scoped, restore-tested, and fail-closed;
  `--cleanup=none` retains sources.

Next: root integrates the three-skill implementation, runs the required
verification, replaces pending evidence with exact receipts, and updates this
record before any release claim.
