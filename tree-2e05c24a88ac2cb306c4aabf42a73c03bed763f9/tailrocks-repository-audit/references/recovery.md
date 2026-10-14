# Recovery evidence limits

The audit is read-only. It may identify a possible unfinished goal, unique
local data, or a blocked writer, but it never copies data, snapshots a source,
creates a candidate, changes a ref, repairs an index, or modifies a worktree.

For each candidate, record the exact repository identity, canonical path, full
refs and OIDs, worktree HEAD, staged and unstaged state, untracked and valuable
ignored paths, stashes, recoverable objects, nested repositories, interrupted
operations, LFS/submodule content, alternates, and shared object storage. Keep
sensitive bytes and names out of the report.

Check locks and process ownership without stopping or signalling a writer.
State that changes during observation, an active writer, unavailable process
visibility, uncertain ownership, missing objects, or incomplete API data is a
gap. Do not infer a goal from a branch name, dirty file, or commit alone.

A goal is only a recovery candidate when its provenance and unfinished
acceptance criterion are explicit in the request, linked issue/PR, or a
source-local handoff; it still applies to the exact selected target; the target
does not already satisfy it; and dependencies and attribution are clear.
Check cancellation, supersession, reverts, and target-specific behavior.

If a later owner proposes recovery, require a fresh target-based candidate
outside the source and a disposable restore test covering refs, HEADs, index,
tracked and untracked bytes, ignored valuable files, modes, symlinks, LFS,
submodules, and external object dependencies. A bundle or existing snapshot is
not proof. Until that test and immediate identity/quiescence checks pass,
retain the source and report the exact gap.
