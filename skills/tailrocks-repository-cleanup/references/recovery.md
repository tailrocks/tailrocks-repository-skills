# Unique-data recovery and restore test

Before deleting a branch, clone, or worktree, identify every item unique to
that candidate and snapshot it outside every deletion target. Keep originals
unchanged. Never snapshot into a repository or candidate that may be removed.

Before any write, inspect Git locks and visible process ownership without
stopping, signalling, or waiting indefinitely for a user process. Repeat the
quiescence and identity checks immediately before each deletion. If state
changes, a writer exists, process visibility is unavailable, or ownership is
uncertain, retain the source.

Capture exact repository identity, full refs/OIDs, worktree HEADs, staged and
unstaged changes, untracked and valuable ignored files, file bytes/modes,
symlink targets, nested repositories, stashes, recoverable objects, interrupted
operations, LFS/submodules, alternate/shared-object metadata, and declared
dependency artifacts. Keep
credentials and sensitive filenames only in protected local recovery storage;
reports contain redacted identities and pass/fail.

The required restore test is real and disposable:

1. Restore each unique item into a disposable repository or directory, never
   over the original candidate.
2. Recreate relevant refs and HEAD, then restore worktree and index state.
3. Compare refs/OIDs, HEADs, staged and unstaged diffs, untracked and ignored
   paths/bytes, modes, symlinks, nested repositories, stashes, recoverable
   objects, interrupted operations, required LFS/submodule content,
   alternate/shared-object metadata, and declared dependency artifacts.
4. Confirm the disposable restore is independently readable and complete.

A bundle, snapshot existence, or sample-file check is insufficient. A missing
item, byte mismatch, failed restore, or uncertain dependency blocks deletion.
For unfinished-goal recovery, use a fresh candidate based on the exact selected
target and preserve every original; successful copying never itself authorizes
deletion.
