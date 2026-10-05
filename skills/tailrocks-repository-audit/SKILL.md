---
name: tailrocks-repository-audit
description: >-
  Use when the user names tailrocks-repository-audit or requests a read-only
  audit of selected repository sources against one exact target. Report the
  audit.md inventory, work map, evidence, and coverage. Do not change branches,
  PRs, or the target; send plan work to tailrocks-repository-plan.
argument-hint: "[SOURCES] [--repo OWNER/REPO] [--target-branch TARGET] [--all-work] [--audit-only] [--run-dir DIR] [--no-local-write]"
disable-model-invocation: false
license: Apache-2.0
user-invocable: true
---

# Read-only repository audit

Audit one bound repository and source scope against one exact target. This
skill is independently callable and always read-only: it never edits files,
changes refs, fetches, stashes, posts, approves, merges, closes PRs, deletes
branches, removes clones or worktrees, invokes cleanup, or turns an audit into
convergence. `--audit-only` is accepted for shared argument compatibility but
does not change that boundary.

Read the local [selector contract](references/selector-contract.md) before
resolving sources. Read [work comparison](references/work-comparison.md)
before comparing sources. Read [recovery limits](references/recovery.md) only
when evaluating recoverable work. Read [lifecycle evidence](references/lifecycle-composition.md)
when recording review, checks, or landing requirements.

## Procedure

1. Parse the complete argument string as data. Require at least one source
   selector or explicit `--all-work`; reject an empty selector list. Keep mixed
   selectors in one repository and never use a shell to parse or transport it.

2. Bind one repository and exact destination under the local selector contract.
   Without `--target-branch`, select literal `main`. Resolve one exact local
   or explicitly selected remote target ref and record its current OID. Missing
   or ambiguous target is an error; never substitute `HEAD`, `origin/HEAD`, a
   PR base, or a hosting default. A non-main audit never writes to `main`.

3. Resolve sources without changing local refs. Use only read-only GitHub
   queries or existing local objects; do not fetch into the inspected
   repository. Missing objects, unavailable API data, and incomplete pages are
   explicit gaps, never permission to change state.

4. Finish every page for `/pulls` and `/branches/all` before using its result;
   record observation time and frozen membership. An empty valid listing is an
   empty selection, never `--all-work`.

5. In targeted mode inspect selected sources and strictly necessary lineage;
   do not widen to unrelated work. In `--all-work`, follow the declared-root
   inventory and report every root, exclusion, access error, unresolved
   identity, incomplete API listing, active writer, and coverage gap. Same-name
   unrelated repositories remain outside scope.

6. Assign one stable source ID (`S001`, `S002`, ...) to every source. Record
   canonical identity and every raw selector spelling for each source. Inspect
   exact branch/ref or PR number, head and declared base, commits and changed
   paths, target behavior, reviews and unresolved threads, required checks,
   repository worklist, successors, dependencies, reverts, and linked
   obligations where available.

7. Assign one stable work ID (`W001`, `W002`, ...) to every work item. A work
   item describes one intended outcome, not a branch name or one commit. Split
   a mixed source into work items for analysis without changing its history.
   One source can yield many work items. One work item can span many sources.
   Compare each source with the fresh selected target first, then compare
   related sources with each other under [work comparison](references/work-comparison.md).
   Check exact, partial, squash, cherry-pick, successor, reverted, equivalent,
   and target-specific relationships. A shared commit or patch identifier alone
   does not prove that target behavior is present.

8. Assign exactly one disposition to every work item from `## Dispositions`.
   State evidence and next owner. Preserve a source PR and its original
   obligations when its declared base differs from the selected target.

## Output

Write the normative `audit.md` report from [templates/audit.md](templates/audit.md):
header block, source table, work matrix, dispositions, gap list, coverage
statement, and next action. When the active request names a report path, write
the report there. Otherwise return one concise Markdown record with the same
sections. Save a report only outside the inspected repositories.

Never claim that tests ran. The audit is not a plan. The audit grants no
mutation permission. State plainly that the audit made no mutation and
performed no cleanup.

## Run directory and object acquisition

When the active request supplies `--run-dir`, use that directory. Otherwise
use one owner-controlled external directory outside the inspected
repositories. Download isolated objects only into the run directory. Isolated
downloads are evidence collection, not target mutation. Never fetch into the
inspected repository or checkout. Never execute branch code, hooks, filters,
or build scripts.

When `--no-local-write` is active, use remote evidence only. Record missing
objects as explicit gaps. Never write local evidence in that mode.

## Inventory rules

Inventory all PR states: draft, open, closed-unmerged, and merged. A closed PR
is not necessarily a merged PR. Record fork identity separately from the base
repository. A deleted head remains a historical source with availability
limits.

Complete all pages for branches, PRs, commits, files, reviews, and threads.
Never label a truncated API response as complete. Snapshot source heads at
start. Relist source heads before finishing. Report drift when sources moved.

## Orphan handling

An orphan is a source or work item with no clear parent, owner, or
successor. Never drop an orphan silently. Give every orphan a stable
source ID or work ID. Record its identity, its last known state, and
the reason it has no parent. Assign disposition `Unknown` when evidence
is insufficient. List every orphan in the gap list with its next owner.

## Dispositions

| Disposition | Meaning |
| --- | --- |
| New | The target lacks a valid source contribution. |
| Partial | The target or source has only part of the intended result. |
| Equivalent | Different code provides the same relevant behavior, supported by evidence. |
| Duplicate | Another accounted source contains the same contribution. |
| Superseded | A stronger accepted implementation replaces this contribution. |
| Reverted | History contains the change, but later work removed its behavior. |
| Conflicting | Contributions cannot combine as-is without a decision or adaptation. |
| Cross-target | The contribution has obligations for another target branch. |
| Deferred | Valid unique work stays intentionally outside the current groups. |
| Rejected | The contribution is unsuitable, with a specific evidence-based reason. |
| Unknown | Evidence is insufficient. Unknown is not rejected or absent. |

## Arguments

| Argument | Meaning |
| --- | --- |
| `--repo` | Bind the one canonical repository. |
| `--target-branch` | Select the one destination. Default is literal `main`. Never fall back after a lookup failure. |
| `--all-work` | Authorize broad inventory. Mutually exclusive with source selectors. |
| `--run-dir` | Select the external run directory. |
| `--no-local-write` | Use remote evidence only. |
| `--audit-only` | Compatibility no-op. Changes no boundary. |

New report-path parameters stay proposed until a supported contract defines them.
