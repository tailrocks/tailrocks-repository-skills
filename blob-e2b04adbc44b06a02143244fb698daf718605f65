# Architecture

## Boundary

The plugin is an orchestration layer. It owns target binding, source resolution, target-relative comparison, convergence state, cleanup eligibility, receipts, and recovery. It composes:

- tailrocks-repository-audit for read-only inventory and target-relative findings.
- tailrocks-repository-converge for adaptation, review, CI, landing, verification, and target-bound receipts.
- tailrocks-repository-cleanup for scoped source cleanup after proof.
- Existing tailrocks-review-pr and tailrocks-merge-pr for review and actual pull-request lifecycle policy.

No component silently changes the requested destination, retargets a cross-target source PR, creates a missing target, or treats a queued merge as landed.

## Flow

1. Parse the complete argument string with a non-shell lexer.
2. Resolve and bind one repository. The typed helper resolves local/qualified
   refs and exact PR metadata, paginates GitHub lists through `gh api`, and
   freezes the timestamped membership before selecting sources.
3. Check the exact destination branch. Record its ref and OID; default main is literal.
4. Freeze a campaign outside the repository with an atomic state file and
   create-new campaign plus repository/target leases. Campaign reuse validates
   repository path, request, frozen resolution, and exact target identity; all
   later typed receipts are attached only when they carry this campaign/scope,
   source phase, repository path, target ref, and initial/current OID.
   Completion is phase-receipt-gated after target observation.
5. Audit each source against the fresh target, recognizing partial, squash, cherry-pick, successor, revert, and target-specific dependency relationships.
6. Adapt only coherent justified improvements. Preserve stronger target behavior.
7. Independently review, run applicable CI, and invoke the existing lifecycle skill to land. Re-check the target after each batch and verify the final target OID.
8. If cleanup=resolved, restore-test unique local state, recheck source identity and need across all targets, then delete only eligible sources. cleanup=none leaves them intact.
9. Journal every phase. Re-observe the target after advances; target rollback
   or non-fast-forward movement fails closed. Resume only within the recorded
   target and scope. A rerun with nothing new is a verified no-op. Snapshot
   restore rejects missing patch artifacts.

## Helper

helper/ is intentionally small and typed. It never invokes a shell
interpreter. It produces request, resolved-source, target, campaign,
target-observation, typed phase-receipt, snapshot, and restore artifacts, with
atomic state and lease mechanics. GitHub reads use the structural `gh api`
client seam; network mutation and pull-request lifecycle mutation remain in
the skill instructions and existing lifecycle owners.
