---
name: tailrocks-repository-plan
description: >-
  Use when the user names tailrocks-repository-plan or requests a plan from
  a repository branch-and-PR audit. Group related work into PRs and define
  merge order. Do not change branches, PRs, or the target.
user-invocable: true
disable-model-invocation: false
license: Apache-2.0
---

# Repository plan

Plan groups and merge order from one bound audit snapshot. This skill is
independently callable and non-mutating: it reads evidence and writes only
the plan. A plan is not operation permission. Never open PRs while grouping.

Read [grouping rules](references/grouping-rules.md) before assigning groups.
Read [dependency rules](references/dependency-rules.md) before ordering
groups.

## Inputs

Require `--audit <path> --audit-revision <rev> --repo --target-branch
--run-dir`. Accept optional `[--phase-limit] [--allow-partial]`.

Recheck the audit header before planning: repository, target ref and OID,
scope, and coverage. When the audit is partial, write a provisional plan
only. A provisional group cannot enter consolidation until its evidence is
complete.

## Procedure

1. Verify that every audit source ID and work ID has an account. Never drop
   an orphan silently.
2. Assign each accepted work item exactly one primary group. Record shared
   prerequisites once. Never duplicate shared changes in every group.
3. Pick one route per group under the grouping rules.
4. Build the group, disposition, dependency, and conflict tables plus the
   merge schedule under the dependency rules.
5. Keep the reason and the retained source identity for every deferred or
   rejected item.

## Output

Write `plan.md` from [templates/plan.md](templates/plan.md) and initialize
`progress.md` from [templates/progress.md](templates/progress.md) in the run
directory. State the phase, scope, object IDs, gaps, and next action. The
plan grants no operation permission.
