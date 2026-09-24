# Lifecycle composition and runtime capability checks

The coordinator owns source comparison, target selection, local audit, and
local cleanup finalization. It does not create another review or merge policy.
Review, PR creation, and remote landing stay with their installed Tailrocks
owners. The coordinator never invokes a manual-only helper programmatically.

## Explicit owner selection

One active user request may explicitly select a named manual-only owner for the
same repository, source, and target. A generic `tailrocks-repository-merge` request does not
imply review, create, or merge selection. Invoke a selected owner only through
its native entrypoint and exact installed request schema. A review report grants
no merge authority; it may not post, approve, merge, close, or clean.

`tailrocks-review-pr` is read-only. If that owner or a fresh review at the
final candidate head is unavailable, block only dependent landing. Record the
candidate PR, exact head/base, review, CI, repository worklist, and high-risk
classification in the handoff; do not turn evidence into authorization.

Use the installed review owner for a fresh read-only review at the final
candidate head and target diff. Use the installed create owner only for an
explicit cross-target adaptation based on the exact selected target. Preserve
the original source PR and branch when its declared base differs from the
selected target. `tailrocks-create-pr` is manual-only and its native entrypoint
is:

```text
bun scripts/create-pr.ts --skill-file <absolute loader SKILL.md> < request.json
```

Send one closed `tailrocks.create-pr-input/v1` JSON object on stdin. Bind the
exact repository, authenticated actor, remote name and HTTPS URL, base/head
refs and SHAs, title, external body path and SHA-256, draft state, required
trailers, and every required gate. Each gate must carry absolute command argv
and absolute proof argv; each proof must emit exactly one
`tailrocks.gate-proof/v1` object with positive `units`. Require one
`tailrocks.create-pr/v1` receipt with outcome `opened`, then verify its exact
repository, head, base, and OIDs before review. Do not call `git push`,
`gh pr create`, or `gh pr edit` separately.

## Merge owner and schema

Use the installed `tailrocks-merge-pr` owner and its native preflight followed
by its guarded entrypoint. Inspect the owner and scripts at runtime; do not
assume a frozen version or receipt. Its interfaces are the installed
`merge-preflight.ts` and `merge-pr.ts` entrypoints:

```text
bun scripts/merge-preflight.ts --root <repo> --pr <N> --no-poll
bun scripts/merge-pr.ts --skill-file <absolute loader SKILL.md> < request.json
```

Bind repository, PR number, expected head, declared base, merge base, method,
final text, review/check/worklist evidence, and target in the handoff according
to the installed contract. A changed head/base, missing exact PR identity, or
unfinished worklist stops the action. Required checks must be green: pending,
missing, cancelled, skipped, or otherwise non-terminal/non-green is not a
pass. A failed required check stops unless the fresh invocation names exactly
one failed check with `--admin <check>` and supplies the required high-risk
confirmation for that exact PR. High-risk classification always requires one
fresh confirmation for that exact PR; an admin bypass cannot waive that
confirmation.

The installed Tailrocks merge request contract uses `expectedTitle` and
`expectedBody`; `title` and `body` are invalid. Its required fields include
`schema`, `root`, `repository`, `pr`, `head`, `base`, `mergeBase`, `method`,
`expectedTitle`, `expectedBody`, `mergeSubject`, `mergeBody`, `blastRadius`,
`highBlastRadiusConfirmed`, and `waivers`; `adminCheck` is optional. Waivers
may name only one each of the owner's `delivery` or `documentation` gates and
cannot waive PR/head/base/target identity, required checks, worklist,
authorization, or high-risk confirmation. Do not add guessed target,
authorization, review, CI, worklist, or landing fields.

Before remote mutation, the installed owner must atomically guard the exact
selected target branch name and OID during mutation and return proof of the
landed target OID. A preflight base-OID comparison, final metadata read, or
post-merge inspection cannot replace that guard. If runtime inspection shows
the owner only guards the head or fails to compare the target name/OID, block
remote landing and report the owner/capability gap. Do not add guessed fields,
invoke a second merge owner, retarget manually, or use direct `gh pr merge`.

After any accepted landing, re-read the exact remote target and run bounded
target-relative acceptance. A queued or uncertain merge is not landing.
