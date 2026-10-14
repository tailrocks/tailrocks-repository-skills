# Recovery and unique-data restore test

Before removing a branch, clone, or worktree, identify data that exists only in that candidate. Snapshot it outside every cleanup candidate. Do not change source refs or working files to make the snapshot easier.

Use only the all-work root list and frozen source membership recorded by this
run; do not broaden discovery while recovering or cleaning. In `--audit-only`,
report recoverable-goal candidates and evidence gaps without making a snapshot
copy, candidate, branch, or source change. In normal mode, preserve each
original clone, worktree, ref, index, and file exactly as observed; recovery
copies into a separate target-bound candidate only after provenance,
applicability, dependencies, and attribution are verified. A failed or
uncertain snapshot/restore blocks that source's recovery or deletion, not safe
independent work.

Before any write that could consume or replace unique local state, check for
active writers without interrupting them: inspect Git lock/in-progress state,
available process ownership for the canonical path, and whether refs or file
state change across the read-only observation. Repeat quiescence and identity
checks immediately before a dependent side effect. Never stop, signal, kill,
or wait indefinitely for a user process. If process visibility is unavailable,
an observed writer exists, state is changing, or exclusive ownership remains
uncertain, retain the source and record the exact limitation; do not recover or
clean from it.

Capture and keep separate:

- Exact repository, full refs, current object IDs, and each worktree HEAD.
- Staged and unstaged tracked changes as separate states.
- Untracked files and ignored files that may contain user work, local configuration, or required output.
- File bytes, modes, symlink targets, executable bits, and nested repository identity.
- Stashes, reflog-reachable work, otherwise recoverable objects, and in-progress merge, rebase, cherry-pick, or revert state.
- Required LFS content, submodule commits and worktree data, alternates, and other external object dependencies.

A Git bundle alone does not preserve index state, untracked files, ignored files, or unique working-copy data. Keep sensitive content only in a protected local recovery location; never copy it into reports or external systems.

Recovery snapshots may contain credentials or private user work. Keep their
contents and sensitive filenames out of prompts, logs, progress handoffs,
commits, PRs, CI, telemetry, and uploads. Before recording remote identity,
strip URL userinfo and omit query strings and fragments; prefer the canonical
host/repository and a remote label. Never echo raw `git remote -v` output.
Keep any exact sensitive-path mapping only in the protected local snapshot;
the handoff records redacted identity and pass/fail, not secret values.

## Required restore test

1. Restore each unique item into a disposable repository or directory, not over the original source.
2. Recreate the relevant refs and HEAD, then restore the working tree and index.
3. Compare ref names and object IDs, HEADs, staged and unstaged diffs, untracked and ignored paths and bytes, modes, symlink targets, and required LFS/submodule content against the snapshot inventory.
4. Confirm that the disposable restore is independently readable and contains every unique item. Record exact paths tested and pass/fail without revealing sensitive values.

Cleanup requires this actual restore test for all unique data in the candidate. A snapshot that merely exists, a successful bundle command, or a sample-file check is not enough. If an artifact is missing, bytes differ, the source is changing, or the restore cannot be verified, keep the candidate and report the specific gap.

## Recover into a new candidate

For all-work recovery, keep every discovered original clone, worktree, ref, and dirty file untouched. Work from a fresh, independent writable clone or repository outside the source roots, based on the freshly verified selected target object ID. Do not add a linked worktree to an original repository, because that changes its Git metadata.

A goal is recoverable only when its provenance and unfinished acceptance
criterion are explicit in the original user request, a linked issue/PR, or a
source-local goal/handoff record; it still applies to this exact target; the
target does not already satisfy it; and the change can be isolated with its
dependencies and attribution clear. Recheck for later cancellation,
supersession, reverts, or a better target implementation. Do not infer a goal
from a dirty file or branch name alone. If the goal, value, dependency, or
correct disposition is uncertain, preserve the original and mark that item
blocked rather than importing it.

1. Recheck and record the bound repository, exact selected target ref/object ID, and each source path, ref, and object ID before reading source data.
2. Create one new candidate from the exact selected target. If the target is non-main, keep main unchanged; make any working branch only inside the new candidate.
3. Import only source commits and local items whose identity and provenance are clear. For dirty or ignored data, restore from the tested snapshot into the new candidate. Never checkout, reset, stash, or repair the original source.
4. Verify the new candidate still has the selected target as its base, compare every imported item with its source evidence, and run only the relevant checks in that candidate. Record source-to-candidate provenance and coverage in one concise Markdown handoff.
5. Preserve all originals after recovery. A successful copy does not authorize deletion; cleanup must pass its separate target, obligation, ownership, quiescence, restore, and immediate identity gates.

If a path, owner, source identity, required object, or unique-data restore is uncertain, preserve that original and mark only that item recovery-blocked. Do not guess or mutate the original to make it usable. Continue safe work on other independently verified sources and report each blocked gap.

Do not reset, clean, stash-drop, prune, garbage-collect, or overwrite source data as a recovery shortcut. After interruption, re-resolve current refs and source identities and repeat the needed checks; do not rely on unverified prior prose.
