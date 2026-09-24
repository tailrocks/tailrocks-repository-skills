# Cleanup eligibility

Cleanup applies only to the explicit selected sources. `--all-work` is required before considering repository-wide candidates. A selected batch never authorizes deletion of unrelated refs, clones, worktrees, or PRs. `--cleanup=none` prohibits deletion.

A candidate is eligible only when every condition below is proven against the exact selected target:

1. **Exact target:** The requested target branch exists at the selected full ref and has a freshly observed object ID. If the target is missing or ambiguous, stop. Omitting the option means literal `main`; do not substitute another branch.
2. **Resolved source:** The complete accepted contribution is present in current target behavior, or each valid goal has an evidenced disposition. Ancestry or a shared commit alone is not enough. Partial landing cannot justify removing a source that still holds accepted work.
3. **No remaining obligation:** No unresolved finding, open or draft PR, required review or check, successor, dependent PR, revert, original-base obligation, other target need, protected use, or unfinished repository worklist still needs this source.
4. **Cross-target preservation:** A source PR whose declared base differs from the selected target and its branch stay intact until obligations to the original destination are separately satisfied. An adaptation to this target does not close or resolve the original PR.
5. **Ownership and quiescence:** The candidate belongs to the authorized repository scope; no owner, editor, agent, Git process, linked worktree, shared object directory, nested repository, or other target depends on it. If exclusive ownership and inactivity cannot be established, retain it.
6. **Unique-data recovery:** Every unique local item has a snapshot outside the candidate and has passed the actual disposable restore test in [recovery.md](recovery.md).
7. **Immediate identity check:** Immediately before the action, the target ref and object ID, source full ref and object ID or PR head/base, repository identity, canonical path, and ownership/quiescence still match. A changed value invalidates the candidate.

Never remove the selected target or a protected/default branch. When the selected target is non-main, leave main untouched. Never delete another owner’s fork ref, a canonical checkout, an active worktree, a shared object store, nested user data, or an unresolved source.

Prefer exact, conditional ref updates that require the expected current object ID. If the remote host cannot condition deletion on the expected ref identity, retain the remote branch. For filesystem cleanup, operate only on one canonical candidate path after the final check; never use wildcards or broad recursive deletion.

After each deletion, rescan the selected scope and recheck the target. Report removed and retained candidates with exact identities and reasons. Any failure or uncertainty means retain.
