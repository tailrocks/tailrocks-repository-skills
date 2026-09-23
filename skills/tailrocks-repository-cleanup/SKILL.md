---
name: tailrocks-repository-cleanup
description: >-
  Use for an explicit scoped cleanup request after repository convergence.
  Prove exact target-relative resolution, cross-target obligations, dependency
  safety, and restore-tested local-state preservation before deleting eligible
  branches, clones, or worktrees.
argument-hint: "[SOURCES] [--target-branch TARGET] [--cleanup resolved|none] [--resume ID]"
disable-model-invocation: true
license: Apache-2.0
user-invocable: true
---

# Repository cleanup

Cleanup is a destructive workflow. It is eligible only when explicitly
requested through cleanup=resolved or routed from a default repo-merge run
whose request selected cleanup=resolved. cleanup=none is a hard no-delete
decision. Audit-only never reaches this skill.

Read:

- ../shared/selector-contract.md
- ../shared/target-and-receipts.md
- ../shared/cleanup-eligibility.md
- ../shared/recovery.md

## Procedure

1. Load the external campaign. Require the same repository, exact target
   branch, target scope, frozen source selectors, and cleanup mode. A target
   mismatch starts no cleanup.
2. Treat selected source selectors as the cleanup scope. Do not scan or delete
   unrelated branches, clones, or worktrees. Only --all-work authorizes the
   original host-wide convergence scope.
3. Recheck the exact destination and source refs/OIDs. Confirm the source is
   landed, intentionally represented, or explicitly resolved on that target.
   Compare target behavior, not source age or main.
4. Inspect open PRs, declared bases, successors, dependents, unresolved
   review/CI obligations, reverts, and other target campaigns. A source PR
   targeting another branch remains intact even when an adaptation landed here.
5. Snapshot each unique local clone/worktree state, including HEAD, staged and
   unstaged changes, ignored and untracked files, and symlinks. Run the
   restore test. A failed or incomplete receipt blocks deletion.
6. Run a final compare-and-swap style identity check immediately before every
   deletion. Never delete default branches, missing targets, changed refs,
   unresolved sources, or sources still needed by another target.
7. Delete only the proven eligible source through the repository's native
   command. Record exact path/ref/OID, action, actor, and result. If the
   command is uncertain, stop and inspect; do not retry blindly.
8. Rescan the scoped source set and target. Emit a cleanup receipt that lists
   deleted and retained candidates with evidence and reasons.

## Cross-target preservation

If a source PR's declared destination differs from the requested target,
preserve it and its obligations. Cleanup cannot make that PR look resolved.
Convergence may create a scoped adaptation PR, but cleanup remains blocked until
the original target obligations are separately satisfied.

## Completion gate

Complete only when every deletion has exact identity, restored local state, no
remaining target obligation, no competing target need, and a successful final
rescan. Reporting candidates is not deletion.

Resolve relative links against this skill's directory. Shared references are
in ../shared/.
