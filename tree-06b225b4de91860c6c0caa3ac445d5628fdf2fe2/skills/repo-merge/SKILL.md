---
name: repo-merge
description: >-
  Run the complete, target-bound repository convergence workflow for explicitly
  selected branches or pull requests, or for explicitly requested all-work.
  Audit-only mode is read-only.
argument-hint: "[--repo REPO] [--target-branch BRANCH] [--audit-only] [--cleanup resolved|none] [--local-only] SOURCES... | --all-work | --resume RUN_ID"
disable-model-invocation: true
license: Apache-2.0
user-invocable: true
---

# repo-merge

This is the single end-to-end coordinator for repository convergence. Route
read-only comparison to `tailrocks-repository-audit`; `repo-merge` owns
finishing accepted work and coordinates the existing pull-request lifecycle
and cleanup owners. Do not delegate convergence to another skill, duplicate
their review, merge, or cleanup policies, or ask the user to invoke each phase
separately. Normal mode must finish justified in-scope work through verified
landing, or report the exact blocker. A plan, patch, open PR, or queued merge
is not done.

Treat the complete argument string as data. Preserve literal `#`, quoting,
slashes, URL queries, and metacharacters. Never evaluate it or pass a joined
request to a shell. Reject malformed, unknown, or contradictory options before
mutation. Read [the selector contract](../shared/selector-contract.md) before
resolving sources.

## Request and scope

- Positional arguments are SOURCES. `--target-branch` is the one DESTINATION.
  Omitted target means the literal branch `main`. Accept both
  `--target-branch NAME` and `--target-branch=NAME`.
- Accept branch names, `refs/heads/...`, remote-qualified refs, `branch:NAME`,
  `#N`, `pr:N`, bare positive PR numbers, PR URLs, repository `/pulls` URLs,
  and `/branches/all` URLs. Mixed selectors are valid within one repository.
  Bare numbers mean PRs; use `branch:N` for a numeric branch.
- Bind one repository: explicit `--repo`, otherwise consistent selector URLs,
  otherwise one unambiguous current checkout. Reject conflicting identities
  or ambiguous same-name refs; show candidate refs, remotes, OIDs, and paths.
  An explicit URL repository never authorizes writes to an unrelated checkout.
- Fully paginate `/pulls` (all open PRs, including drafts) and `/branches/all`
  (all canonical remote branches except the destination); honor supported
  semantic filters and reject unsupported ones. A partial or failed listing
  blocks that source selection. Preserve selector provenance when deduplicating.
- A missing selected target is a blocker. Never substitute HEAD, PR base,
  `origin/HEAD`, repository default, or a prior run's target; never create it.
  When target is non-main, leave `main` outside mutation scope. Sources all
  flow to this one destination; multiple sources do not define source/target
  pairs.
- No sources without `--all-work` or `--resume` means show usage and stop
  without scanning. `--all-work` is explicit, mutually exclusive with source
  selectors, and does not mean other repositories or organization-wide work.
  `--resume RUN_ID` resumes only the saved run and cannot take fresh sources.
- `--audit-only` performs read-only inspection and reports a convergence plan;
  it never edits, lands, or cleans. `--cleanup=none` prohibits deletion.
  Default cleanup is `resolved`; it permits only sources proven eligible below.
- `--local-only` is explicit branch-to-branch work on an existing local target.
  Verify that local ref and describe results as local-only. Do not claim remote
  landing or CI, publish the result, or use this mode to bypass applicable
  policy. Without this flag, use the guarded remote lifecycle.

## Run the workflow

1. Bind and refresh the exact repository, target ref, and selected sources.
   For targeted requests inspect only those sources and strictly necessary
   related work; do not host-scan because the source list is empty. For
   `/pulls` and `/branches/all`, finish the complete selected listing before
   acting. Report later additions separately.

2. In `--all-work`, locate accessible independent clones and linked, detached,
   or relocated worktrees for the bound repository. Inspect their refs and
   branches, PR lineage, staged and unstaged changes, untracked files, stashes
   and recovery candidates, and valuable ignored files. Recover valid
   unfinished goals. Record inaccessible roots, active writers, ambiguous
   identities, and other coverage gaps; never claim complete coverage while
   any remain. Read [recovery guidance](../shared/recovery.md) before anything
   that could risk user work.

3. Route source inventory and comparison to `tailrocks-repository-audit`.
   Compare actual behavior and valid requirements against the fresh selected
   target. Recognize partial work, equivalent patches, reverts, successors,
   dependencies, and target-specific gaps. Identify valid incomplete goals,
   preserve behavior already better on the target, and record justified no-op,
   rejection, or blocker decisions. Do not replay a stale whole branch or mark
   work satisfied merely because it landed on another target.

4. In normal mode, `repo-merge` finishes accepted work against the exact
   target: implement or adapt the justified changes, preserve stronger target
   behavior, and verify the result. Do not hand this convergence work to
   another skill. Keep the original PR and branch when they still serve
   another target or obligation. For cross-target work, use a scoped
   adaptation into the chosen target when coherent; never silently retarget
   or close the original PR.

5. Require fresh independent read-only review through `tailrocks-review-pr`,
   all applicable target-specific CI and repository worklists, then actual
   landing through `tailrocks-merge-pr` under its guarded lifecycle. Re-fetch
   review, checks, source heads, and target policy at the candidate head; a
   commit, push, or target advance invalidates affected results. Do not count
   a main check for a non-main target without proof it applies. Verify that the
   intended change is on the exact selected remote target (or exact local
   target in explicit local-only mode), then verify its resulting behavior.
   A queued merge or uncertain merge status is not landing.

   A missing prerequisite blocks only the action that depends on it. Continue
   independent read-only analysis and safe work; keep dependent work unlanded
   and report the precise blocker. Never substitute direct merge commands,
   bypass protection, weaken checks, or claim completion without landing.
   Read [lifecycle composition](../shared/lifecycle-composition.md) before
   review and landing.

6. Recheck the combined batch against the advanced target after each landing.
   Cleanup only under `resolved`, through `tailrocks-repository-cleanup`, and
   only for sources resolved on this target with no remaining goal, PR,
   dependency, or other-target obligation. Before each destructive action,
   recheck exact refs, ownership, activity, target, and dependencies. Snapshot
   and restore-test unique staged, unstaged, untracked, valuable ignored, and
   other local state first. If identity, ownership, recoverability, or need is
   uncertain, retain the source and say why. Never delete `main`, protected or
   active work, a canonical checkout, shared object storage, or another
   owner's fork. Read [cleanup eligibility](../shared/cleanup-eligibility.md)
   before deletion.

## Interruption and resume

For each interrupted run, create or update one concise Markdown handoff at
`~/.local/state/tailrocks/repo-merge/runs/<run-id>.md`. Put the run ID, original
request and authority, repository, exact target and observed ref, source
identities, completed decisions/actions, review/CI/landing links and status,
recovery location, blockers, and one deterministic next action in that file.
Keep it outside every repository, source, and cleanup candidate. Do not create
campaign databases, journals, leases, phase receipts, or hash sidecars.

`--resume RUN_ID` reads only that file, restores its recorded scope and target,
then refreshes source and target identities before continuing. Re-run any
review or CI made stale by changed heads or policy. A target override, missing
or ambiguous handoff, changed repository identity, or unverified landing
blocks dependent side effects; never guess a replacement or silently widen
scope. Update the same handoff if this resumed run is interrupted again.

## Finish and report

Report the bound repository, source set, exact destination, target result, and
per-source disposition. Distinguish verified remote landing, verified
local-only landing, audit-only, no-op, rejected work, blocked work, and
recovery-required state. Include review and applicable CI status, completed or
disabled cleanup, retained sources with reasons, and all `--all-work` coverage
gaps. Claim completion only after accepted goals are verified on the selected
target and required review, CI, landing, and cleanup gates are accounted for.

Claude Code invokes the namespaced skill, for example
`/tailrocks-repository-skills:repo-merge --target-branch=release/next feature/auth`.
Codex uses its supported skill-selection or mention interface, for example
`$repo-merge --target-branch=release/next feature/auth`. Do not advertise a
universal bare `/repo-merge` command.
