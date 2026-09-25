# Lifecycle evidence boundaries

Cleanup checks lifecycle obligations but owns no review, create, approve,
merge, close, or retarget policy. A generic cleanup request never implies a
manual-only lifecycle owner. An active request may explicitly select a named
owner; that owner must be invoked through its native entrypoint and exact
closed schema.

## Same-package lifecycle owners

Resolve an explicitly selected owner from the same package root as this
installed skill's absolute `SKILL.md`: `skills/tailrocks-review-pr/SKILL.md`,
`skills/tailrocks-create-pr/SKILL.md`, or
`skills/tailrocks-merge-pr/SKILL.md`. Require the canonical regular owner file
and its native package resources; reject a separate pull-request package,
sibling checkout, global script, or guessed path. Cleanup itself never invokes
these owners and never turns evidence into authorization.

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
receipt. If landing readiness depends on the imported merge owner, record its
separate capability gap: it guards the PR head but does not provide selected
target branch-name/OID CAS or landed target-ref proof. Preserve original source
branches and PRs until their complete obligations are resolved.
