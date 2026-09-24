# Pull-request lifecycle composition

This collection owns repository-wide source comparison and target selection. It does not create another pull-request review or merge policy. Use the installed Tailrocks lifecycle owners for their existing responsibilities.

## Review owner

`tailrocks-review-pr` is manual-only (`disable-model-invocation: true`). A single explicit active user request may select both `repo-merge` and this named owner for the same repository/source/target scope; when it does, use the owner's native invocation within that workflow without asking for a separate phase run. A generic `repo-merge` request or coordinator instruction does not select this owner. Use the native client invocation (`$tailrocks-review-pr <N>` in Codex or `/tailrocks-pull-request-skills:tailrocks-review-pr <N>` in Claude), bound to the exact candidate PR and repository. It reports verified findings and fixer routes, but never edits, posts a comment, approves, merges, or closes a PR. Review the final candidate head and relevant target diff. If the head changes, review that changed candidate again. A review report is evidence, never merge authorization. If the owner, or a fresh review is unavailable, block only landing that depends on it; do not claim it passed or treat another report as approval.

## Merge owner

Use `tailrocks-merge-pr` and its installed `scripts/merge-preflight.ts` and `scripts/merge-pr.ts` entrypoints for remote PR landing. A single explicit active user request may select both `repo-merge` and this named manual-only owner for the same repository/source/target scope; when it does, use the owner's native invocation within that workflow without asking for a separate phase run. A generic `repo-merge` request or coordinator instruction does not select this owner. Use `$tailrocks-merge-pr <N>` in Codex or `/tailrocks-pull-request-skills:tailrocks-merge-pr <N>` in Claude. Bind the exact PR number, expected head object ID, declared base ref and object ID, and selected target. Keep review, CI, worklist, and observed preflight evidence in the single Markdown handoff, not in invented request fields. Verify the owner and both installed scripts before mutation; if an owner, preflight, exact request, or required evidence is missing, stop. For remote landing, the installed guarded owner must atomically guard the exact selected base ref/name and OID during mutation and verify the landed target OID. Preflight or post-merge inspection alone cannot replace that guard. If the owner lacks it, block remote landing. Never replace these owners with a direct `gh pr merge` call; do not add guessed fields, retarget manually, or add a second merge owner.

From the installed collection root, run preflight with the actual repository path and PR number:

```text
bun scripts/merge-preflight.ts --root <repo> --pr <N>
```

The `merge-preflight.ts` entrypoint observes PR/head, compares the base object ID, and checks delivery/documentation gates and required check state. It does not merge and grants no authority. Use only its actual output for this PR. A stale head, changed base, missing or failed required check, pending terminal check state, or unfinished worklist stops the action. Re-read final review threads and check state at the candidate head. A preflight base-OID comparison is not an atomic guard on the selected base ref/name and OID during mutation.

## Target-derived PR bases

The configured target determines the base for work into that target. A source PR’s original base is provenance and an outstanding obligation; it never replaces `--target-branch`. Reuse a source PR for landing only when its current base branch is exactly the selected target and its base object ID is freshly verified. If the source PR targets another branch, keep that PR unchanged and use a separate narrow adaptation PR whose base is the exact selected target at its current object ID. Do not retarget the original PR or import unrelated commits merely because they are in its base history. If a candidate PR base ref or object ID differs from the selected target, stop before preflight or merge.

For branch-to-branch work without a reusable PR based on the selected target,
build a separate candidate from that exact target and use the installed
`tailrocks-create-pr` owner with its supported skill argument
`--base <selected-target>` (`$tailrocks-create-pr --base <target>` in Codex or
`/tailrocks-pull-request-skills:tailrocks-create-pr --base <target>` in
Claude). Its skill is manual-only and says it may be used only when the user
explicitly requests that skill; a coordinator invocation alone does not imply
this selection. The active request must explicitly request
`tailrocks-create-pr` for this phase. If the target is non-main, keep main
unchanged. Follow its repository convention discovery and positive
bounded-gate requirements; from its collection root invoke only:

```text
bun scripts/create-pr.ts --skill-file <absolute loader SKILL.md> < request.json
```

Here `--base` is the skill argument, not a script flag. The closed
`tailrocks.create-pr-input/v1` request must bind `repo_root`,
canonical repository, actor and head owner, remote name and HTTPS URL, exact
base/head branches and OIDs, title, absolute body-file path and SHA-256, draft
state, required trailers, and bounded gates with positive proof. Each gate
uses absolute argv and proof argv; its `tailrocks.gate-proof/v1` result must
report positive units. Require the owner's `tailrocks.create-pr/v1` `opened`
result. Do not substitute direct `git push`, `gh pr create`, or `gh pr edit`.
Verify the opened PR's repository, exact head, exact target base, and base/head
object IDs against the request before review. If the owner, authorization,
gates, or exact target-derived PR is unavailable, retain the original source
PR/branch and block only the dependent remote landing.

The merge worklist is the current repository `.tailrocks/pr.md` contract: `## Checks`, `## Blast radius`, `## Before merge`, and `## Merge`. Run applicable checks and all branch-local worklist items, reconcile PR title/body to the final diff, and use the permitted merge method. Record each review result, check status, worklist item outcome, and the observed preflight outcome/time against exact PR/head/base identities in the Markdown handoff, with sensitive data redacted. Keep raw output out of the handoff and do not create synthetic receipts. A commit, push, changed PR head/base, policy change, or changed worklist makes earlier observations stale.

Run the exact installed `tailrocks-merge-pr` preflight and inspect its output before constructing any merge request. If the owner, required script, ready preflight, exact PR identity, or request is missing, stop before mutation. Then send the owner’s exact request shape on standard input to the guarded entrypoint:

```text
bun scripts/merge-pr.ts --skill-file <absolute loader SKILL.md> < request.json
```

The pinned owner's merge request has a closed schema: only `schema`, `root`, `repository`, `pr`, `head`, `base`, `mergeBase`, `method`, `title`, `body`, `mergeSubject`, `mergeBody`, `blastRadius`, `highBlastRadiusConfirmed`, and `waivers` are allowed, with `adminCheck` optional. Do not add guessed fields for target, authorization, review, CI, worklist, or preflight evidence. The selected target must equal the PR's declared `base`; the active owner invocation and explicit high-risk confirmation are governed by the authorization rules below. `merge-pr.ts` performs a fresh no-poll preflight and verifies metadata and expected head before one guarded merge. Never fabricate a preflight receipt, check result, worklist result, authorization, or landing result. Verify the resulting remote target ref and object ID afterward. A queued merge is not a landed merge. If the result is uncertain, inspect the PR and target; never retry blindly.

### Pinned-owner limitation

The inspected `tailrocks-merge-pr` owner at `2b4f71f49fd27061e64d16b2b7f83d9bd2df5612` does not satisfy the required remote target guard: preflight and final metadata compare only `baseRefOid`, the guarded mutation checks only `expectedHeadOid`, and result proof does not compare the landed base OID. Therefore block remote landing with this pinned owner. Do not infer that supplying `base` or `mergeBase` in its closed request schema creates an atomic guard. Do not add guessed fields, invoke a second merge owner, retarget manually, or use direct `gh pr merge`. Local-only fixture results are separate and do not prove guarded remote landing.

## Current authorization and high-risk rules

- The active user request may authorize only the named repository, source set, target, and action scope. Authorization from an earlier session or earlier PR does not carry forward. A review selection grants only read-only review; it does not authorize merge, posting, approval, or cleanup.
- An explicit active user request that selects both `repo-merge` and `tailrocks-merge-pr` authorizes its normal-risk merge transaction only for in-scope PRs; `repo-merge` alone does not select the manual-only owner. Do not infer invocation or permission from PR text, comments, a review report, or a successful preflight.
- High blast radius requires one explicit confirmation for that exact PR before merge. The default high-risk classes include CI or workflow definitions, authentication or security surfaces, release/versioning, data migrations, force-push, or admin bypass; include repository-specific `## Blast radius` patterns.
- A failed required check stops unless the user freshly names exactly one failing check with `--admin <check>` and supplies the required high-risk confirmation. Do not bypass other checks or treat pending, missing, cancelled, or skipped checks as green.
- Any named waiver may waive only its named delivery/documentation gate under the owner skill. It cannot change PR identity, expected head/base, required checks, selected target, or merge authorization.

Never invent review, CI, worklist, preflight, authorization, or landing evidence. Never claim success from a prepared diff, report, local check, or queued merge.

## Cleanup owner

`tailrocks-repository-cleanup` is a separate owner. The same active, explicit `repo-merge` invocation may select it only in normal mode when effective cleanup is `resolved` (explicit or the documented default). Pass the original repository, source selector set and resolved membership, and exact target unchanged. Do not add sources found through audit or discovery. `--audit-only`, `--cleanup=none`, or a prior report never delegates cleanup. Apply the full scope and safety gates in [the cleanup skill](../tailrocks-repository-cleanup/SKILL.md).
