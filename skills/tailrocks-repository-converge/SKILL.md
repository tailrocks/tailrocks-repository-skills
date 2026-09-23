---
name: tailrocks-repository-converge
description: >-
  Use for an explicit target-bound convergence run. Audit selected sources,
  finish justified improvements, independently review, satisfy applicable CI,
  actually land through the existing pull-request lifecycle owners, verify the
  exact destination, and return scoped cleanup candidates.
argument-hint: "[SOURCES] [--target-branch TARGET] [--audit-only] [--local-only] [--cleanup resolved|none] [--resume ID]"
disable-model-invocation: true
license: Apache-2.0
user-invocable: true
---

# Repository converge

This is a mutating workflow only when the caller selected default mode. The
caller must have explicitly invoked this skill or routed here from repo-merge.
--audit-only switches the whole run to the read-only audit owner and forbids
edits, PR changes, merges, and cleanup. --local-only is a separate explicit
branch-to-branch mode for existing local refs; it produces local verification
only and never borrows remote CI or claims hosted delivery.

Read:

- ../shared/selector-contract.md
- ../shared/target-and-receipts.md
- ../shared/lifecycle-composition.md
- ../shared/cleanup-eligibility.md
- ../shared/recovery.md

## Procedure

1. Parse and bind the full request. Positional inputs are SOURCES.
   --target-branch is the DESTINATION and omitted means literal main. Do not
   infer a destination from current HEAD, PR base, origin/HEAD, or the
   repository default. Reject a missing or ambiguous target.
2. Resolve selectors deterministically, paginate list URLs, preserve literal
   hash arguments and provenance, deduplicate canonical identities, and reject
   mixed repositories. No selectors means usage/error. --all-work is the only
   explicit host-wide scope.
3. Check the exact target and create or resume an external campaign. Freeze the
   target branch, ref, OID, repository, source set, cleanup mode, and scope.
4. Run tailrocks-repository-audit against the fresh target. For every source,
   recognize partial, squash, cherry-pick, successor, revert, and
   target-specific dependency evidence. Adapt only coherent justified
   improvements; preserve better destination behavior.
5. For a source PR whose base differs from the requested destination, leave the
   original PR and its remaining obligations intact. Create or update a
   scoped adaptation PR into the requested destination only when the audit
   proves it coherent. Never silently retarget, close, or delete the original.
6. Finish valid unfinished goals in the selected scope. Keep changes bounded
   to the selected target and source obligations. Before each outward or
   irreversible action, verify repository identity, target branch, expected
   head, and authorization.
7. Independently review each adapted batch with tailrocks-review-pr. That owner
   is read-only. Resolve verified blockers through the owning fix route, then
   recompute review evidence after every change.
8. Satisfy the repository's applicable CI and worklist. Record check names,
   conclusion, observed commit, and target. Do not treat pending, skipped
   without justification, or queued checks as green.
9. In connected mode, land through tailrocks-merge-pr and only that existing
   lifecycle owner. Pass the exact PR/head/base and fresh receipts. Require
   confirmation that the remote merge or equivalent landing actually
   completed. In --local-only mode, perform only the declared local branch
   landing contract and label every result local-only. Preflight, approval,
   opened PR, and queued merge are not completion.
10. Re-read the destination after every batch. Verify the combined batch and
    final target OID against the target's requirements. A main receipt cannot
    verify a non-main destination.
11. If cleanup is resolved, route candidates to
    tailrocks-repository-cleanup. If cleanup is none, make no deletion
    attempt. Cleanup remains limited to the frozen source scope.
12. Journal every phase and emit target-bound receipts. On interruption, resume
    only the recorded campaign and target. A rerun with no new justified work
    must still verify the target and emit an idempotency no-op receipt.

## Stop conditions

Stop and report a blocker when the target is missing or changes unexpectedly,
repository identity is ambiguous, a required lifecycle owner is unavailable,
review or CI is unresolved, a merge result is uncertain, an adaptation would
change source obligations incoherently, or cleanup eligibility is not proven.
Never paper over a blocker with a report or queued action.

## Completion gate

Complete only when the selected target contains the justified work, independent
review and applicable CI are satisfied, the landing is confirmed, the exact
destination is verified after it advanced, and resolved cleanup has passed its
own restore, need, identity, and recheck gates.

Resolve relative links against this skill's directory. Shared references are
in ../shared/.
