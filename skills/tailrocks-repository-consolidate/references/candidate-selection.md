# Candidate selection and push rules

This file points to the normative rules. It adds no new rule.

- Candidate selection: reuse an existing suitable candidate when reuse
  preserves scope and review context; otherwise create a fresh target-based
  candidate. Verify ownership and the expected head before reuse.
  (Consolidation and merge rules, prepare-a-group checks 1-6.)
- Push rules: for a missing owned candidate, push normally and verify the
  head. For an owned candidate that needs a fast-forward update, recheck the
  expected old head and update safely. For an unexpected head or a
  foreign-owned branch, stop and report drift. Never force-push.
  (Consolidation and merge rules, create-or-reuse-a-PR.)
- Sources stay read-only during preparation. The target is never changed
  directly during preparation.
