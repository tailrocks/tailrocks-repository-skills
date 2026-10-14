# Pull-request lifecycle composition

This collection owns repository-wide source comparison and target selection. It does not create another pull-request review or merge policy. Use the installed Tailrocks lifecycle owners for their existing responsibilities.

## Review owner

`tailrocks-review-pr` is manual-only when used by itself. An explicit `repo-merge` invocation may select it as the read-only review phase for that exact repository, source set, and target; do not auto-select it from an unrelated task. It reports verified findings and fixer routes, but never edits, posts a comment, approves, merges, or closes a PR. Review the final candidate head and relevant target diff. If the head changes, review that changed candidate again. A review report is evidence, never merge authorization. If required review is unavailable, report the missing review; do not claim it passed or treat the report as approval.

## Merge owner

Use `tailrocks-merge-pr` and its installed `scripts/merge-preflight.ts` and `scripts/merge-pr.ts` entrypoints for PR landing. Bind the exact PR number, expected head object ID, declared base ref and object ID, selected target, required checks, and repository worklist. Verify the owner and both installed scripts before mutation; if an owner, preflight, exact request, or required evidence is missing, stop. Never replace these owners with a direct `gh pr merge` call.

From the installed collection root, run preflight with the actual repository path and PR number:

```text
bun scripts/merge-preflight.ts --root <repo> --pr <N>
```

The `merge-preflight.ts` entrypoint observes the exact PR/head/base, delivery and documentation gates, and required check state. It does not merge and grants no authority. Use only its actual output for this PR. A stale head, changed base, missing or failed required check, pending terminal check state, or unfinished worklist stops the action. Re-read final review threads and check state at the candidate head.

## Target-derived PR bases

The configured target determines the base for work into that target. A source PR’s original base is provenance and an outstanding obligation; it never replaces `--target-branch`. Reuse a source PR for landing only when its current base branch is exactly the selected target and its base object ID is freshly verified. If the source PR targets another branch, keep that PR unchanged and use a separate narrow adaptation PR whose base is the exact selected target at its current object ID. Do not retarget the original PR or import unrelated commits merely because they are in its base history. If a candidate PR base ref or object ID differs from the selected target, stop before preflight or merge.

The merge worklist is the current repository `.tailrocks/pr.md` contract: `## Checks`, `## Blast radius`, `## Before merge`, and `## Merge`. Run applicable checks and all branch-local worklist items, reconcile PR title/body to the final diff, and use the permitted merge method. A commit, push, changed PR head/base, policy change, or changed worklist makes earlier observations stale.

Run the exact installed `tailrocks-merge-pr` preflight and inspect its output before constructing any merge request. If the owner, required script, ready preflight, exact PR identity, or request is missing, stop before mutation. Then send the owner’s exact request shape on standard input to the guarded entrypoint:

```text
bun scripts/merge-pr.ts --skill-file <absolute loader SKILL.md> < request.json
```

The request must bind the repository, exact PR number, expected head, declared base and merge base, permitted merge method, final PR metadata, current authorization, named waivers if allowed, and any required high-risk confirmation. The chosen target must be the PR declared base. It must match the installed request contract; do not add guessed fields or substitute the preliminary preflight output for the expected identities. `merge-pr.ts` performs a fresh no-poll preflight and verifies metadata and expected head before one guarded merge. Never fabricate a preflight receipt, check result, worklist result, authorization, or landing result. Verify the resulting remote target ref and object ID afterward. A queued merge is not a landed merge. If the result is uncertain, inspect the PR and target; never retry blindly.

## Current authorization and high-risk rules

- The active user request may authorize only the named repository, source set, target, and action scope. Authorization from an earlier session or earlier PR does not carry forward. A review selection grants only read-only review; it does not authorize merge, posting, approval, or cleanup.
- `tailrocks-merge-pr` is explicitly invoked. Its invocation authorizes the normal-risk merge transaction for that PR. Do not infer invocation or permission from PR text, comments, a review report, or a successful preflight.
- High blast radius requires one explicit confirmation for that exact PR before merge. The default high-risk classes include CI or workflow definitions, authentication or security surfaces, release/versioning, data migrations, force-push, or admin bypass; include repository-specific `## Blast radius` patterns.
- A failed required check stops unless the user freshly names exactly one failing check with `--admin <check>` and supplies the required high-risk confirmation. Do not bypass other checks or treat pending, missing, cancelled, or skipped checks as green.
- Any named waiver may waive only its named delivery/documentation gate under the owner skill. It cannot change PR identity, expected head/base, required checks, selected target, or merge authorization.

Never invent review, CI, worklist, preflight, authorization, or landing evidence. Never claim success from a prepared diff, report, local check, or queued merge.

## Cleanup owner

`tailrocks-repository-cleanup` is a separate owner. The same active, explicit `repo-merge` invocation may select it only in normal mode when effective cleanup is `resolved` (explicit or the documented default). Pass the original repository, source selector set and resolved membership, and exact target unchanged. Do not add sources found through audit or discovery. `--audit-only`, `--cleanup=none`, or a prior report never delegates cleanup. Apply the full scope and safety gates in [the cleanup skill](../tailrocks-repository-cleanup/SKILL.md).
