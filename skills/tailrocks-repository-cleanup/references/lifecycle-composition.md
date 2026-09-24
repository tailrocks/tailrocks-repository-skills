# Lifecycle evidence boundaries

Cleanup checks lifecycle obligations but owns no review, create, approve,
merge, close, or retarget policy. A generic cleanup request never implies a
manual-only lifecycle owner. An active request may explicitly select a named
owner; that owner must be invoked through its native entrypoint and exact
closed schema.

Before deleting a source, inspect current PR head/base, review findings,
required checks, successors, dependencies, reverts, repository worklist, and
original-target obligations. A review report is evidence, not merge authority.
An adaptation into the selected target does not resolve a PR targeting another
branch.

Record full PR head/base refs and OIDs, review findings, required-check state,
repository worklist, successors, dependencies, reverts, and original-target
obligations. Missing or stale lifecycle evidence is an unresolved obligation,
so retain the source. Cleanup never invokes a review, create, or merge owner,
supplies authorization, or treats a preflight/metadata read as a landing
receipt. Preserve original source branches and PRs until their complete
obligations are resolved.
