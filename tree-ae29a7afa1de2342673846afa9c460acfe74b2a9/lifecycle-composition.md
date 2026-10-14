# Lifecycle evidence boundaries

This skill supplies target-relative evidence only. It does not review, create,
approve, merge, close, retarget, post to, or mutate a pull request, and it
does not authorize another owner to do so. Record review, checks, worklist,
base/head identities, and unresolved obligations as evidence with observation
time and scope.

When an active user request explicitly names a manual-only lifecycle owner,
that owner remains independently responsible for its native invocation and
closed request schema. A generic audit request never implies review, create,
or merge selection. A review report grants no merge authority. The review
owner is read-only; if it or a fresh review is unavailable, report a landing
blocker rather than claiming review, CI, or worklist approval.

For remote landing, require the installed merge owner and its
`merge-preflight.ts`/`merge-pr.ts` entrypoints to be inspected at runtime. Its
mutation must atomically guard the exact selected target branch name and OID
and return proof of the landed target OID. Preflight, final metadata, or
post-merge inspection cannot replace that guard. If the owner lacks the
capability, record the owner/version and block landing; do not add guessed
fields, retarget manually, invoke a second owner, or use direct `gh pr merge`.

If recording a merge request, use the installed owner's exact keys. The
Tailrocks merge contract uses `expectedTitle` and `expectedBody`, not `title`
and `body`; do not fabricate evidence fields. Any high-risk confirmation and
required check/worklist gate stays with the owner. A candidate whose declared
base differs from the selected target is cross-target evidence, not target
landing.
