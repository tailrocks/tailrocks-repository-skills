# Recovery and unique-data restore test

Before removing a branch, clone, or worktree, identify data that exists only in that candidate. Snapshot it outside every cleanup candidate. Do not change source refs or working files to make the snapshot easier.

Capture and keep separate:

- Exact repository, full refs, current object IDs, and each worktree HEAD.
- Staged and unstaged tracked changes as separate states.
- Untracked files and ignored files that may contain user work, local configuration, or required output.
- File bytes, modes, symlink targets, executable bits, and nested repository identity.
- Stashes, reflog-reachable work, otherwise recoverable objects, and in-progress merge, rebase, cherry-pick, or revert state.
- Required LFS content, submodule commits and worktree data, alternates, and other external object dependencies.

A Git bundle alone does not preserve index state, untracked files, ignored files, or unique working-copy data. Keep sensitive content only in a protected local recovery location; never copy it into reports or external systems.

## Required restore test

1. Restore each unique item into a disposable repository or directory, not over the original source.
2. Recreate the relevant refs and HEAD, then restore the working tree and index.
3. Compare ref names and object IDs, HEADs, staged and unstaged diffs, untracked and ignored paths and bytes, modes, symlink targets, and required LFS/submodule content against the snapshot inventory.
4. Confirm that the disposable restore is independently readable and contains every unique item. Record exact paths tested and pass/fail without revealing sensitive values.

Cleanup requires this actual restore test for all unique data in the candidate. A snapshot that merely exists, a successful bundle command, or a sample-file check is not enough. If an artifact is missing, bytes differ, the source is changing, or the restore cannot be verified, keep the candidate and report the specific gap.

## Recover into a new candidate

For all-work recovery, keep every discovered original clone, worktree, ref, and dirty file untouched. Work from a fresh, independent writable clone or repository outside the source roots, based on the freshly verified selected target object ID. Do not add a linked worktree to an original repository, because that changes its Git metadata.

1. Recheck and record the bound repository, exact selected target ref/object ID, and each source path, ref, and object ID before reading source data.
2. Create one new candidate from the exact selected target. If the target is non-main, keep main unchanged; make any working branch only inside the new candidate.
3. Import only source commits and local items whose identity and provenance are clear. For dirty or ignored data, restore from the tested snapshot into the new candidate. Never checkout, reset, stash, or repair the original source.
4. Verify the new candidate still has the selected target as its base, compare every imported item with its source evidence, and run only the relevant checks in that candidate. Record source-to-candidate provenance and coverage in one concise Markdown handoff.
5. Preserve all originals after recovery. A successful copy does not authorize deletion; cleanup must pass its separate target, obligation, ownership, quiescence, restore, and immediate identity gates.

If a path, owner, source identity, required object, or unique-data restore is uncertain, preserve that original and mark only that item recovery-blocked. Do not guess or mutate the original to make it usable. Continue safe work on other independently verified sources and report each blocked gap.

Do not reset, clean, stash-drop, prune, garbage-collect, or overwrite source data as a recovery shortcut. After interruption, re-resolve current refs and source identities and repeat the needed checks; do not rely on unverified prior prose.
