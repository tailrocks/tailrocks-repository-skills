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

For any remote landing used as evidence, require the installed merge owner and
its `merge-preflight.ts`/`merge-pr.ts` entrypoints to atomically guard the exact
target branch name and OID during mutation and to prove the landed target OID.
Preflight, final metadata, or post-merge reads cannot replace that guard. If
runtime capability is absent, retain the source and report the blocker; do not
add guessed fields, call a second owner, retarget manually, or use direct
`gh pr merge`.

Use the installed merge request keys exactly. The contract requires
`expectedTitle` and `expectedBody`; `title` and `body` are invalid. Do not
invent authorization, review, check, target, or landing fields. Required
review, CI, worklist, and any high-risk confirmation remain owner gates.
Preserve original source branches and PRs until their complete obligations are
resolved.
