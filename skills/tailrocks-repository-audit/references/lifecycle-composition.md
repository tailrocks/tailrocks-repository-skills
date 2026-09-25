# Lifecycle evidence boundaries

This skill supplies target-relative evidence only. It does not review, create,
approve, merge, close, retarget, post to, or mutate a pull request, and it
does not authorize another owner to do so. Record review, checks, worklist,
base/head identities, and unresolved obligations as evidence with observation
time and scope.

## Same-package lifecycle owners

When landing readiness is discussed, resolve lifecycle owners from the same
package root as this installed skill's absolute `SKILL.md`; the owner files are
`skills/tailrocks-review-pr/SKILL.md`,
`skills/tailrocks-create-pr/SKILL.md`, and
`skills/tailrocks-merge-pr/SKILL.md`. Do not use a separate pull-request
package, sibling checkout, global script, or guessed path. Owner selection is
explicit and outside this read-only audit; this skill records evidence only.

Record the selected candidate PR, full head/base refs and OIDs, review result,
required-check state, repository worklist, unresolved findings, and
obligations with observation time. A generic audit request never implies
review, create, or merge selection. A review report is evidence only; if a
fresh review, check state, worklist, or lifecycle owner is unavailable, report
that landing blocker rather than claiming approval.

If the report discusses landing readiness, record whether the same-package
owner can atomically guard the exact target branch name and OID during mutation
and prove the landed target OID. The current owner only observes the PR head
through its read-only preflight; it does not guard a ref, mutate remotely, or
provide selected target branch-name/OID CAS or landed target-ref proof. Record
that owner gap as a landing blocker and separate owner work. Remote landing
stays blocked until both guarantees exist. A preflight or metadata read is
evidence, not an atomic guard and not merge authority. A source whose declared
base differs from the selected target remains cross-target evidence with its
original obligation.
