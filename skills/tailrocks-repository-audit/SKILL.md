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

Audit one bound repository and source scope against one exact target. This
skill is independently callable and always read-only: it never edits files,
changes refs, fetches, stashes, posts, approves, merges, closes PRs, deletes
branches, removes clones or worktrees, invokes cleanup, or turns an audit into
convergence. `--audit-only` is accepted for shared argument compatibility but
does not change that boundary.

Read the local [selector contract](references/selector-contract.md) before
resolving sources. Read [recovery limits](references/recovery.md) only when
evaluating recoverable work. Read [lifecycle evidence](references/lifecycle-composition.md)
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

6. For every source record canonical identity and every raw selector spelling.
   Inspect exact branch/ref or PR number, head and declared base, commits and
   changed paths, target behavior, reviews and unresolved threads, required
   checks, repository worklist, successors, dependencies, reverts, and linked
   obligations where available.

7. Compare each source with the fresh selected target. Check exact, partial,
   squash, cherry-pick, successor, reverted, equivalent, and target-specific
   relationships. A shared commit or patch identifier alone does not prove
   that target behavior is present.

8. Classify each selected goal as satisfied, justified, partial, superseded
   with evidence, rejected while retaining valid work, cross-target,
   conflicting, unresolved, or not applicable. State evidence and next owner.
   Preserve a source PR and its original obligations when its declared base
   differs from the selected target.

## Output

Return one concise Markdown record containing the exact repository, target ref
and OID, observation time, source membership and provenance, target-relative
findings, lifecycle requirements, scan coverage, blockers, and any sources
that appear eligible for a separately authorized cleanup. State plainly that
the audit made no mutation and performed no cleanup. Save a report only when
explicitly requested, outside the inspected repositories.
