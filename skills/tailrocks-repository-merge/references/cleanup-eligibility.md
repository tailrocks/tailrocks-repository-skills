# Local cleanup finalization eligibility

This is the coordinator's local finalization procedure. It does not invoke the
standalone manual-only cleanup skill and never adds sources discovered during
the audit. It applies only to the original selected source set; `--cleanup=none`
prohibits deletion and `--all-work` is required for repository-wide candidates.

A candidate is eligible only when every gate passes against the exact target:

1. **Exact target:** requested target exists at its full ref with a fresh OID;
   omission means literal `main`. Missing or ambiguous target stops.
2. **Resolved source:** complete accepted contribution is present in target
   behavior, or every valid goal has an evidenced disposition. Ancestry or a
   shared commit alone is not enough; partial landing retains the source.
3. **No obligation:** no unresolved finding, open/draft PR, required review or
   check, successor, dependency, revert, original-base obligation, other target
   need, protected use, or unfinished worklist depends on it.
4. **Cross-target preservation:** adapting a source into this target does not
   satisfy its original-target obligations. Keep that source intact.
5. **Ownership and quiescence:** candidate is not a canonical checkout, active
   worktree, shared object store, nested repository, another owner's work, or
   active writer/Git operation. Uncertainty means retain.
6. **Unique-data recovery:** before each deletion, snapshot every unique local
   item into protected storage outside every deletion target, including refs, HEAD, index
   state, staged and unstaged changes, stash, untracked and valuable ignored
   files, content, modes, symlink targets, recoverable objects, interrupted
   operations, nested repositories, required Git/LFS/submodule metadata,
   alternate/shared-object metadata, and declared dependency artifacts. Every
   item must pass the disposable restore test in [recovery](recovery.md).
7. **Immediate identity and data revalidation:** immediately before each
   deletion, repeat that complete unique-local-item snapshot into protected
   storage outside every deletion target and the restore-safety check, then
   recheck repository, target ref/OID, source ref/OID or PR head/base,
   canonical path, ownership, and quiescence. Any drift, missing item, changed
   dependency, or stale restore proof retains the candidate and requires a
   fresh restore proof.

Never remove the selected target, protected/default branch, another owner's
fork ref, canonical checkout, active worktree, shared object store, nested
user data, or unresolved source. Delete a local full ref only with a
compare-and-delete operation such as `git update-ref -d <full-ref>
<expected-old-oid>` (or an equivalent CAS). If a remote host cannot condition
deletion on the expected OID, retain its ref. Filesystem cleanup uses one
exact canonical path after the final check; never use wildcards or broad
recursive deletion.

After every deletion, rescan the selected scope and target. Report removed and
retained identities and reasons. Any failure or uncertainty means retain.
