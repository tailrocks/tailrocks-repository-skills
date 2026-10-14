# Progress and handoff record

Status: implementation is in progress; no release or landing claim.

- Source/decisions: `repo-merge` is the sole end-to-end coordinator; audit and
  cleanup remain distinct capabilities. The redundant converge route and
  campaign engine are removed. Collection keep/remove/finish decisions are in
  [research](docs/research.md); behavior and boundaries are in
  [architecture](docs/architecture.md).
- Target: omitted `--target-branch` means literal `main`. Non-main work must
  leave `main` untouched. `--all-work` is explicit; no selectors do not imply
  global cleanup. See [GOAL.md](GOAL.md) and
  [requirements-to-evidence](docs/requirements-to-evidence.md).
- Branch/worktree: `origin/codex/simplify-repo-merge` is at
  `6eca154533d93e05726b712efc355df88e4e080c`. The local worktree has
  uncommitted test, CI, and progress-record changes; inspect and verify them
  before commit/push.
- Tests: deterministic source contracts, shell syntax checks, and
  `git diff --check` pass. These are source-level checks, not installed-agent
  acceptance evidence. The Codex acceptance runtime is pending its safety
  gate. Claude was not used here; no Claude runtime validation is claimed.
- Landing/CI/release: no hosted PR, hosted CI, landing, or release exists for
  this work. The pinned PR merge owner lacks an atomic selected-target
  branch/base-OID guard; this blocks safe remote merge until that dependency is
  fixed. Do not bypass the owner or merge directly.
- Cleanup: no target repositories, refs, worktrees, or user data were cleaned.
  Product cleanup stays source-scoped, restore-tested, and fail-closed;
  `--cleanup=none` retains sources.

Next: pass the Codex acceptance safety gate, record exact fixture/local
evidence, commit and push verified increments, then use the installed review
and merge owners. Recheck the target-binding dependency before any landing.
