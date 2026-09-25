# Lifecycle composition and runtime capability checks

The coordinator owns source comparison, target selection, local audit, and
local cleanup finalization. It does not create another review or merge policy.
Review and PR creation stay with the explicitly selected owners imported in
this package. The named merge owner currently exposes read-only preflight
only; this package provides no remote-landing operation. The coordinator
never invokes a manual-only helper programmatically.

## Same-package owner binding

Resolve the package root from the coordinator's absolute loader-provided
`SKILL.md`: take the parent of its containing `skills/` directory. Require
that root and every owner path below to be canonical regular files or
directories, never symlinks. These are the only lifecycle owners valid for
this coordinator:

| Owner | Same-package path | Native interface |
| --- | --- | --- |
| `tailrocks-review-pr` | `<PACKAGE_ROOT>/skills/tailrocks-review-pr/SKILL.md` | Explicit skill selection; read-only review |
| `tailrocks-create-pr` | `<PACKAGE_ROOT>/skills/tailrocks-create-pr/SKILL.md` | `scripts/create-pr.ts` with `tailrocks.create-pr-input/v1` |
| `tailrocks-merge-pr` | `<PACKAGE_ROOT>/skills/tailrocks-merge-pr/SKILL.md` | Read-only `scripts/merge-preflight.ts`; blocked compatibility endpoint `scripts/merge-pr.ts` |

The owner skill file and its scripts must resolve beneath this one package
root. A separately installed pull-request package, sibling checkout, global
script, or guessed path is not an owner. The owner name must be explicitly
selected by the active request; a generic repository-merge request never
implicitly selects review, creation, or merge.

## Explicit owner selection

One active user request may explicitly select a named manual-only owner for the
same repository, source, and target. A generic `tailrocks-repository-merge` request does not
imply review, create, or merge selection. Invoke a selected owner only through
its native entrypoint and exact owner request schema. A review report grants
no merge authority; it may not post, approve, merge, close, or clean.

`tailrocks-review-pr` is read-only. If that owner or a fresh review at the
final candidate head is unavailable, block only dependent landing. Record the
candidate PR, exact head/base, review, CI, repository worklist, and high-risk
classification in the handoff; do not turn evidence into authorization.

Use the same-package review owner for a fresh read-only review at the final
candidate head and target diff. Use the same-package create owner only for an
explicit cross-target adaptation based on the exact selected target. Preserve
the original source PR and branch when its declared base differs from the
selected target. `tailrocks-create-pr` is manual-only and its native entrypoint
from this package root is:

```text
bun <PACKAGE_ROOT>/scripts/create-pr.ts --skill-file <PACKAGE_ROOT>/skills/tailrocks-create-pr/SKILL.md < request.json
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

## Merge owner and read-only preflight

Use the same-package `tailrocks-merge-pr` owner for its native, read-only
preflight. The current owner exposes no metadata-lookup endpoint, merge-policy
or waiver consumer, or remote-landing operation. Its only permitted entrypoint
is the imported `merge-preflight.ts` command:

```text
bun <PACKAGE_ROOT>/scripts/merge-preflight.ts --root <repo> --repo OWNER/REPO --pr <N> --no-poll
```

The command derives and binds the repository, PR number, head, base, merge
base, and hosted-check state from the target repository and PR. A changed
head/base, missing exact PR identity, or failing delivery/documentation
predicate stops the report.
Required checks must be green: pending, missing, cancelled, skipped, or
otherwise non-terminal/non-green is not a pass. The receipt provides no merge
bypass, admin override, authorization, policy decision, or waiver.

Do not invoke the bundled `merge-pr.ts` compatibility endpoint, construct a
low-level merge request, or add guessed target, authorization, review, CI,
worklist, policy, waiver, or landing fields. Those paths cannot change the
owner's read-only boundary.

Remote landing is unconditionally blocked until the same-package owner can
atomically guard the exact selected target branch name and OID during mutation
and return proof of the landed target OID. A preflight base-OID comparison,
final metadata read, or post-merge inspection cannot replace that guard. The
current owner only performs the read-only preflight, so report the
owner/capability gap. Do not invoke a second merge owner, retarget manually,
or use direct `gh pr merge`.

## Landing capability condition

The blocked compatibility endpoint's request schema binds the PR and its
head/base values, but it has no selected target-ref CAS and cannot prove the
landed target OID. Until a future owner exposes both guards, repository-merge
must block remote landing even when the read-only preflight passes.

If a future owner supplies those guards, re-read the exact remote target and
require proof of the guarded landed OID; a queued or uncertain merge is not
landing.
