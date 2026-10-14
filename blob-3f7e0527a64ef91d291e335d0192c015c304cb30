---
name: tailrocks-repository-audit
description: >-
  Use for an explicit read-only audit of selected repository sources against
  one exact target branch, or for an explicitly requested all-work inventory.
  Compare target-relative behavior and report evidence, scope, and gaps.
argument-hint: "[SOURCES] [--repo OWNER/REPO] [--target-branch TARGET] [--all-work] [--audit-only]"
disable-model-invocation: true
license: Apache-2.0
user-invocable: true
---

# Read-only repository audit

Read one bound repository and the requested source set against the exact selected target. Use `--repo OWNER/REPO` when `--all-work` is requested outside an unambiguous checkout or when source URLs do not identify the repository. Return one concise Markdown audit record. This skill never edits repository files, changes refs, fetches, stashes, posts, approves, merges, closes PRs, deletes branches, removes clones or worktrees, or invokes cleanup. It does not turn an audit request into convergence.

Read:

- [selector and target contract](../shared/selector-contract.md)
- [recovery limits](../shared/recovery.md) when evaluating recoverable work
- [lifecycle owners](../shared/lifecycle-composition.md) when recording review, check, or landing requirements

## Procedure

1. Parse the full argument text as data. Require at least one source selector or an explicit `--all-work`. Reject an empty selector list as usage error. Keep a mixed selector list within one bound repository. Never use a shell to parse or transport it.
2. Bind the repository and destination under the shared selector contract. When `--target-branch` is absent, select the literal branch `main`. Resolve one exact local branch ref or one explicitly selected remote branch ref and record its current object ID. If missing or ambiguous, stop; never substitute current HEAD, `origin/HEAD`, a PR base, or the hosting service default. On a non-main target, perform no write to main.
3. Resolve each source without changing local refs. For remote evidence, use read-only GitHub queries or existing local objects. Do not fetch into the inspected repository. If the needed objects or API data are unavailable, state the gap rather than changing local state.
4. For `/pulls` and `/branches/all` selectors, finish every API page before using the result and record the resolved membership and observation time. Do not treat an incomplete page set as complete. An empty result from a valid list selector is an empty selection, never all-work.
5. In targeted mode, inspect selected sources and read-only related lineage needed to explain dependencies. Do not expand selection to unrelated work. In `--all-work` mode, follow the declared-root inventory in the shared contract and report every root, exclusion, access error, unresolved repository, incomplete API listing, and active writer.
6. For every source, record canonical identity and every raw selector spelling. Inspect branch/ref or PR number, exact head and declared base, commits and changed paths, current target behavior, reviews and unresolved threads, required checks, repository worklist, successors, dependencies, reverts, and linked obligations where available.
7. Compare each source with the fresh selected target, not with main by default. Check exact, partial, squash, cherry-pick, successor, reverted, and target-specific relationships. A shared commit or patch identifier alone does not prove that the target still has the behavior.
8. Classify each selected goal as satisfied on this target, justified, partially represented, superseded with evidence, rejected while retaining any valid goal, cross-target, conflicting, unresolved, or not applicable. State the evidence and next owner. Preserve the original PR and its obligations when its declared base differs from the selected target.
9. Return the audit record. State the exact repository, target ref, object ID, and observation time; source membership and provenance; target-relative findings; required lifecycle work; scan coverage; blockers; and whether any sources appear eligible for a separately requested cleanup. State plainly that this audit made no mutation and performed no cleanup.

## All-work coverage

`--all-work` means broad read-only discovery for the bound repository. First enumerate the local volumes and the exact accessible workspace, project, and agent worktree roots exposed by the host. Include configured Git/worktree roots, hidden runtime worktree directories, and user-selected roots. Search those roots for `.git` directories, `.git` pointer files, bare repositories, nested repositories, and repository paths recorded by Git. Follow Git worktree metadata and explicit Git pointers; do not follow arbitrary symlinks outside declared roots.

Query the bound hosting repository for branch heads, open and draft PRs, and relevant closed or merged PR lineage. Complete pagination for each list. Inspect each discovered copy for its distinct refs, common Git directory, worktree state, detached heads, configured remotes, stashes, reflog-reachable work, recoverable objects, in-progress Git operations, staged and unstaged changes, untracked files, and potentially valuable ignored files. Note shallow or partial clones, missing objects, alternates, submodules, LFS objects, forks, protected refs, and duplicate object stores.

List exact scan roots, exact exclusions with reasons, permission-denied paths, unavailable volumes, API failures, truncated listings, unresolved identities, and active writers. Do not claim host-wide completeness or zero remaining work when any applicable root, repository, page, or identity is unknown. Do not silently omit user-data directories because their names resemble caches.

## Output boundary

An audit report is evidence for a later decision, not permission to act. `--cleanup=resolved` in forwarded arguments does not authorize this skill to delete anything. Cleanup is a separate, directly callable workflow. Return one concise Markdown record in the response; save it only when explicitly requested, outside the inspected repositories.
