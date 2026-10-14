---
name: tailrocks-repository-cleanup
description: >-
  Use for an explicit, scoped request to remove already resolved source
  branches, clones, or worktrees after proving exact target resolution, no
  remaining obligations, ownership and quiescence, and actual restore safety.
argument-hint: "[SOURCES] [--repo OWNER/REPO] [--target-branch TARGET] [--cleanup resolved|none] [--all-work]"
disable-model-invocation: true
license: Apache-2.0
user-invocable: true
---

# Scoped repository cleanup

This is an independently callable, manual-only cleanup capability. It removes
only explicitly selected sources after target-relative resolution, obligation,
ownership, quiescence, and restore proof. It never implements, merges, closes,
or retargets PRs. `tailrocks-repository-merge` does not invoke this manual-only skill
programmatically; its end-to-end workflow uses a local finalization procedure
with the same gates. An active user request may select this skill explicitly
when a separate cleanup invocation is intended.

Read the local [selector contract](references/selector-contract.md),
[cleanup eligibility](references/cleanup-eligibility.md), and
[recovery and restore test](references/recovery.md). Read [lifecycle evidence](references/lifecycle-composition.md)
when checking PR review, checks, or other obligations.

## Procedure

1. Require an explicit cleanup request with a nonempty source set or explicit
   `--all-work` as the sole scope. No selectors is a usage error. Treat
   `--cleanup=none` as a hard no-delete instruction and
   `--cleanup=resolved` as eligibility only. Preserve the original selector
   arguments and target when this skill is explicitly selected alongside a
   coordinator request; do not add sources discovered during audit.

2. Bind one repository and exact target under the local selector contract.
   Omitted target means literal `main`; a missing or ambiguous target stops.
   Re-resolve its full ref and current OID immediately before any action. Never
   fall back to `HEAD`, `origin/HEAD`, a PR base, or a hosting default. A
   non-main target leaves `main` untouched.

3. Resolve every selected source branch, PR, clone, or worktree and record
   repository identity, canonical path, full ref, current OID, and PR head/base
   where applicable. Deduplicate equivalent identities while retaining every
   selector spelling. A source whose declared PR base differs from the selected
   target remains intact until its original-target obligations are satisfied.

4. Prove that the complete accepted contribution is resolved in actual
   behavior on this exact target. Ancestry or a shared commit alone is not
   enough. Record valid goals intentionally rejected or superseded with
   evidence; partial landing cannot justify deletion.

5. Check every remaining obligation: open or draft PRs, review or checks,
   successors, dependencies, reverts, unresolved findings, another target
   need, protected or maintenance use, and the current repository worklist.
   An adaptation into this target does not satisfy an original-target PR.

6. Prove exclusive ownership and quiescence. A candidate must not be the
   canonical checkout, active worktree, shared object store, nested repository,
   another owner's work, or an active writer/Git operation. Never stop or
   signal a writer; uncertainty means retain and report the source.

7. Before each deletion, snapshot every unique ref, HEAD, index state, staged
   and unstaged change, untracked and valuable ignored file, mode, symlink,
   and required Git/LFS/submodule item outside the candidate. Perform the real
   disposable restore test in [recovery](references/recovery.md), not merely a
   bundle or existence check.

8. Immediately before each individual deletion, recheck repository identity,
   target ref/OID, source ref/OID or PR head/base, canonical path, ownership,
   and quiescence. Delete a local full ref only with a compare-and-delete
   operation such as `git update-ref -d <full-ref> <expected-old-oid>` or an
   equivalent CAS. Delete a filesystem candidate only by its exact proven path.
   Never use wildcards, broad recursive deletion, `git clean -fdx`, reset, force
   update, global stash clearing, or merge/close commands. If a remote host
   cannot condition deletion on expected identity, retain the remote ref.

9. Rescan the selected scope and target after each action. Report every removed
   and retained candidate with identity, restore result, action, and reason.
   Later discoveries remain report-only and do not enlarge targeted authority.

## Completion

Cleanup is complete only for candidates whose contribution, obligations,
ownership, quiescence, unique-data restore test, and immediate identity check
all passed. A blocked candidate remains present. Return one concise Markdown
record; save it only when explicitly requested and outside cleanup candidates.
