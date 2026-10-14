---
name: tailrocks-repository-cleanup
description: >-
  Use for an explicit, scoped request to remove already resolved source
  branches, clones, or worktrees after proving exact target resolution, no
  remaining obligations, ownership and quiescence, and actual restore safety.
argument-hint: "[SOURCES] [--target-branch TARGET] [--cleanup resolved|none] [--all-work]"
disable-model-invocation: true
license: Apache-2.0
user-invocable: true
---

# Scoped repository cleanup

This skill is independently callable for an explicit cleanup request. It may also be selected as the final phase of the same active, explicit `repo-merge` invocation only when that invocation is in normal mode and its effective cleanup mode is `resolved`—the documented default or an explicit `--cleanup=resolved`. That delegation preserves exactly the original repository, source selectors and resolved membership, and selected target. It adds no permission to clean related or newly discovered sources.

`--audit-only` and `--cleanup=none` never delegate cleanup. A prior audit report, an older invocation, or a new source set cannot supply delegated authority. For original `--all-work`, retain the same declared scan roots and original candidate membership; report later additions without deleting them under the old request. Re-resolve every identity and eligibility condition against current state. Do not implement, merge, close, or retarget PRs as cleanup.

Read:

- [selector and target contract](../shared/selector-contract.md)
- [cleanup eligibility](../shared/cleanup-eligibility.md)
- [recovery and restore test](../shared/recovery.md)
- [lifecycle owners](../shared/lifecycle-composition.md) when checking PR review, checks, or merge obligations

## Procedure

1. Require a direct explicit cleanup request or the exact delegation described above, plus a nonempty source selector set or explicit `--all-work` as the sole scope. No selectors is a usage error, never permission to clean all work. `--cleanup=none` is a hard no-delete instruction. Treat `--cleanup=resolved` as eligibility only, never as proof.
2. Preserve the original source selector arguments and target from `repo-merge`. Do not add prerequisites, predecessors, successors, branches found during audit, or related clones/worktrees to the cleanup candidates. Bind one repository and the exact selected target. An omitted target means literal `main`. Re-resolve the target ref and current object ID. A missing or ambiguous target stops cleanup. Never fall back to HEAD, `origin/HEAD`, a PR base, or the repository default.
3. Resolve the exact selected source branch, PR, clone, or worktree and record repository identity, canonical path, full ref, current object ID, and PR head/base where applicable. Keep all selectors in the bound repository. Deduplicate equivalent identities while retaining each selector spelling.
4. Prove that the whole selected contribution is resolved on this exact target. Inspect target behavior, not just ancestry or a commit identifier. Record valid goals intentionally rejected or superseded with evidence. Partial landing is not enough to delete a source that still contains accepted work.
5. Check every remaining obligation: open or draft PRs, original PR base, required review or checks, successors, dependent work, reverts, unresolved findings, another target that still needs the source, protected or maintenance use, and current repository worklist. A PR whose base differs from the selected target stays open with its source intact until its original-target obligations are separately satisfied. An adaptation into this target does not satisfy those obligations.
6. Prove ownership and quiescence for each filesystem candidate. It must be within the authorized repository scope, not the canonical checkout, not an active worktree, not shared with another owner or active writer, and not needed by another worktree through a common object store. Preserve any candidate whose owner, active users, nested data, or Git operation is uncertain.
7. Before any deletion, snapshot the candidate and perform the real restore test in a disposable location as specified in the recovery reference. Restore every unique item and compare refs, HEAD, index state, staged and unstaged changes, untracked and ignored files, modes, symlinks, and required Git/LFS/submodule content. A snapshot that was not restored and checked is not sufficient.
8. Immediately before each individual deletion, recheck the exact repository, target ref and object ID, source ref and object ID or PR head/base, canonical filesystem path, ownership, and quiescence. If anything moved, changed, or became active, retain it. For a ref update, use an operation that refuses if the expected object ID changed; if the host offers no safe conditional deletion, do not delete that remote ref.
9. Delete only the proven candidate by exact path or full ref. Never use a wildcard, broad recursive removal, `git clean -fdx`, reset, force update, global stash clearing, or PR merge/close command. Never remove the selected target. When the target is not main, leave main untouched. Keep protected branches, other owners’ refs, and unresolved cross-target sources.
10. Rescan the exact selected scope and recheck the selected target after the action. Report each removed and retained candidate with its identity, action, restore result, and reason. Report later or newly discovered work separately; do not imply full-repository cleanup from a targeted request.

## Completion

Cleanup is complete only for candidates whose target-relative work, obligations, ownership, quiescence, unique-data restore test, and immediate identity recheck all passed. A blocked candidate remains present. Return one concise Markdown record in the response; save it only on explicit request and outside cleanup candidates.
