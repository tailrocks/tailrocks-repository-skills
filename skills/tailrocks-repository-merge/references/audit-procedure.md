# Local target-relative audit procedure

This procedure is the coordinator's local audit phase. It is read-only and
must not ask the host to invoke the independently callable manual-only audit
skill. Bind the frozen repository, target, and source set using the local
selector contract before reading source data.

1. Record repository identity, canonical path, exact target ref and fresh OID,
   source identities, every raw selector spelling, observation time, and the
   declared scope. A missing or ambiguous target blocks the run.
2. Resolve selected branch/ref or PR evidence without changing refs or fetching
   into the inspected repository. Record head, declared base, changed paths,
   commits, reviews and unresolved threads, checks, worklist obligations,
   successors, dependencies, reverts, and relevant local state.
3. Compare actual target behavior with each valid goal and complete source
   contribution. Check direct, partial, squash, cherry-pick, successor,
   reverted, equivalent, conflicting, and target-specific relationships.
   Shared ancestry or a patch ID alone is not proof that behavior is present.
4. Classify each selected goal as satisfied, justified, partial, superseded,
   rejected while retaining valid work, cross-target, conflicting, unresolved,
   or not applicable. Include evidence and the next owner. Keep a source whose
   declared base differs from the selected target and record the original-base
   obligation.
5. For `--all-work`, inventory only the frozen declared roots and report every
   inaccessible root, incomplete page, unresolved identity, active writer,
   unfinished goal, and coverage gap. New discoveries do not join this run's
   cleanup authority.

The audit returns evidence, blockers, and possible cleanup candidates. It
never edits files, changes refs, snapshots data, creates recovery candidates,
posts, approves, merges, closes, retargets, or deletes anything.
