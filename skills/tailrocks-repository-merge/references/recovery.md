# Recovery and unique-data restore test

Before any operation that could consume unique local state, identify data
present only in the candidate and snapshot it outside every source and target.
Keep the original clone, worktree, refs, index, and files unchanged. Recovery
is allowed only in normal mode after provenance, applicability, dependency,
and attribution are explicit; audit-only never copies or snapshots.

Check Git locks, in-progress state, and visible process ownership without
stopping or signalling writers. Repeat quiescence and identity checks before
each dependent side effect. If a writer exists, state changes, process
visibility is unavailable, or ownership is uncertain, retain the source and
report the exact gap.

Capture exact repository identity, full refs/OIDs, worktree HEADs, staged and
unstaged changes, untracked and valuable ignored paths, file bytes and modes,
symlink targets, nested repositories, stashes, recoverable objects,
interrupted operations, LFS/submodules, alternates, and shared object
dependencies. Keep credentials and sensitive filenames only in protected local
storage; handoffs contain redacted identity and pass/fail.

## Required disposable restore test

1. Restore each unique item into a disposable repository or directory, never
   over the original source.
2. Recreate relevant refs and HEAD, then restore working-tree and index state.
3. Compare refs/OIDs, HEADs, staged and unstaged diffs, untracked and ignored
   paths/bytes, modes, symlinks, and required LFS/submodule content.
4. Confirm the disposable restore is independently readable and complete.

A bundle, snapshot existence, or sample-file check is not proof. A missing
item, mismatch, failed restore, or uncertain external dependency blocks
recovery and deletion. A recoverable goal must be explicit in the request,
issue/PR, or source-local handoff, still apply to this exact target, not
already be satisfied, and remain unsuperseded or unreverted.

For recovery, create a fresh independent candidate from the exact target and
import only verified source items. Preserve every original. A successful copy
never itself authorizes cleanup.
