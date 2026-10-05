---
name: tailrocks-repository-consolidate
description: >-
  Use when the user names tailrocks-repository-consolidate or requests planned
  integration of grouped work into candidate branches. Build or update one
  candidate per planned group from frozen source commits, verify coverage, and
  hand off to PR owners. Do not audit sources, plan groups, open PRs, land the
  target, or delete sources.
argument-hint: "[--repo OWNER/REPO] [--target-branch BRANCH] [--plan PATH] [--plan-revision REV] [--group GROUP]... [--run-dir DIR]"
disable-model-invocation: false
license: Apache-2.0
user-invocable: true
---

# Consolidate planned groups

`tailrocks-repository-consolidate` integrates planned work into candidate
branches. It consumes one plan revision and selected groups. It outputs
candidate branches, coverage results, and PR handoffs. It never lands the
target. It never deletes sources.

One term names one concept in this skill. A source is a branch, a PR, or an
explicitly selected revision. A work item is one distinct intended change. A
group is a set of work items that belong in one coherent PR. A candidate is
the branch that carries one group's integrated result. The target is the exact
destination branch in one canonical repository. A plan revision is the
grouping decision made from one audit snapshot.

## Inputs

Require the canonical repository, the exact target, one plan revision, and
the selected groups. Require the plan path and the run directory. If any
input is missing or ambiguous, stop and report the gap. Never guess the
target, the plan revision, or group membership.

## Procedure

1. **Bind and verify.** Bind the canonical repository and the exact target
   branch. Verify the plan revision against the plan file. Verify group
   membership of every selected group. Verify source object IDs and the
   target object ID. Verify history constraints for the chosen integration
   method. If any check fails, stop and report the mismatch.
2. **Select the candidate.** If no suitable candidate exists, create a fresh
   candidate from the current target. If an existing candidate preserves
   scope and review context, reuse it. Before reuse, verify ownership and
   the expected head. If the head is unexpected or foreign-owned, stop and
   report drift. Never touch the target directly. Keep sources read-only.
3. **Integrate.** Merge frozen source commits in planned order. Use ordinary
   merges. Preserve author identity and provenance. Record each conflict
   resolution as an attributable commit with its behavior check. Never
   resolve a conflict by taking one entire side without checking the
   intended behavior. Limit new code to necessary integration corrections.
   Keep stronger target behavior unless the plan justifies replacement.
4. **Handle mixed branches.** If a source branch mixes accepted and rejected
   work, plan a full-history integration with explicit correction commits,
   obtain permission for selective extraction, or defer the mixed source.
   Never silently cherry-pick. Never claim that a tip merge imported only
   selected work items.
5. **Record the method.** Record the final PR method in the plan before
   execution. Use ordinary merges for consolidation by default. Never
   rewrite published history.
6. **Verify coverage.** Compare the candidate with the current target and
   the group work matrix. Verify that every retained work item is present.
   Verify that deferred work is absent in behavior. Check interfaces and
   integration points. Use real checks only. Never invent counts. Execute
   untrusted code only in permitted isolation.
7. **Hand off.** Return the branch identity and coverage to the coordinator,
   `tailrocks-create-pr`, or `tailrocks-refresh-pr` through a supported
   runtime route. If this is a standalone request with explicit PR
   permission, load those owners through a supported route. If they cannot
   be loaded, stop at the prepared branch and report the missing handoff.

## Handoff shape

Report the candidate identity tuple: base repository, head repository, head
ref, base ref, group, and head OID. See
[review handoff](references/review-handoff.md). See
[candidate selection](references/candidate-selection.md) for reuse and push
rules.

## Finish and report

Report each group's candidate identity, coverage result, and handoff state.
If a group cannot proceed, report the blocking condition and the next
action. Never claim a landing. A prepared branch is not a PR. A PR is not
a landing.
