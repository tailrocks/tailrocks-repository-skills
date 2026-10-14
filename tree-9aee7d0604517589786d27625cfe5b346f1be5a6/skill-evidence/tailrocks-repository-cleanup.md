# Cleanup evidence

Observed need: cleanup cannot infer safety from a bundle alone. The first
helper implementation used one combined Git listing and missed ordinary
untracked files while capturing ignored files. The failing recovery contract
exposed that root enumeration defect; the helper now enumerates ignored and
non-ignored untracked paths separately and deduplicates them.

Discriminating contract: freeze scope, recheck target/source identity, prove
other-target obligations absent, restore-test unique local state, then delete
only eligible sources. cleanup=none never deletes.

Acceptance:

- tests/recovery-and-resume.sh restores staged, unstaged, untracked, ignored,
  and symlink state, then exercises target-conflict rejection, target
  re-observation, lease release, and no-op journaling.
- skills/shared/cleanup-eligibility.md blocks cross-target and unresolved
  sources and requires a final identity recheck.
- No test touches Jackin or deletes a non-disposable path.
