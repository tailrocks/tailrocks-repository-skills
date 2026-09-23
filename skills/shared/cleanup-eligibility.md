# Cleanup eligibility

Cleanup is scoped to the frozen campaign. Selected source selectors do not become a host-wide cleanup request. Only --all-work may select the original host-wide convergence workflow.

For each candidate, prove all of the following against the exact target:

1. The selected source is landed, intentionally represented, or explicitly resolved on the target.
2. No remaining obligation, unresolved finding, pending CI, open successor, dependent PR, cross-target destination, or revert makes it needed.
3. No other authorized target campaign still needs the branch, clone, or worktree.
4. The candidate identity still matches the recorded repository, path, ref, and OID after a final compare-and-swap style recheck.
5. Unique local state was snapshot and restore-tested successfully before deletion.

Never delete the default branch, a missing/ambiguous target, a source with unresolved work, or a source PR whose destination differs from the requested target. Preserve such a PR and use a scoped adaptation PR into the requested target when appropriate.

--cleanup=none is a hard no-delete mode. --cleanup=resolved permits deletion only after every gate and receipt passes. Failed, uncertain, or changed candidates remain and are reported.
