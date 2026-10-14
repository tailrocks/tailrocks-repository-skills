# Progress

## Current state

- Repository is committed and pushed to the public remote at
  https://github.com/tailrocks/tailrocks-repository-skills.git. Baseline CI
  run 35818512123 and hardening CI run 35826193979 passed. Hardening commit
  4809cf4c1cc91df6ff28cbf009fe3de83de96437 is released; cleanup proof landed
  in 3c996a3ad9d87d2e438456280edc29f7b77eedbf. Patch hardening commit
  6c3b62b is pushed and passed hosted CI 35834837262.
- Rust helper exists under helper/; it is a typed boundary for argument parsing, exact target binding, GitHub selector resolution, frozen campaign state, target leases, typed receipts, and local-state snapshots.
- Helper/contracts cover literal hash transport, omitted-main semantics, selector deduplication/provenance, explicit numeric branches, mixed-repository rejection, list URL query preservation, deterministic local/API selector resolution with pagination fixtures, no-selector rejection, target-bound campaign creation, target leases, typed completion receipts, and non-fast-forward rejection.
- Portable root manifest plus Codex and Claude compatibility manifests are present.
- Disposable contracts pass: selector, main/non-main fixture landing,
  multiple-source landing, target-relative no-op rerun, recovery/resume, and
  client static checks.
- The latest preserved real Codex 0.155.1 / gpt-5.6-luna local-only run used high
  reasoning, approval never, and workspace-write sandbox. It completed
  campaign `campaign-c991f32f1deb5da4` after recovering from immutable
  checked-out metadata into the prepared writable clone. Target
  `refs/heads/release/next` advanced from
  `401b69dcc549b3df7cd089dbb82753369e546fe2` to
  `395154a65036e65a83dfc5edd70172c7271b7d6b`; source
  `9da059a8378cb6853c2d587e52241481bc263311` was represented; `auth.txt` and
  `release.txt` were verified; main stayed at
  `36c4a47febe81790b8b232915177da9f20bc669c`; and cleanup was none.
- The harness now builds the helper outside the agent sandbox and exports
  `TAILROCKS_HELPER_BIN`. The installed helper wrapper honors that prebuilt
  binary, so restricted plugin-cache writes cannot erase a valid landing's
  completion receipt. Campaign JSON read-modify-write commands now take an
  OS-backed per-campaign mutation lock and fail closed on concurrent writers;
  the lock unit test and full helper gates pass. The native harness exited `0`
  with `real Codex local-only landing: PASS` and a complete campaign journal.
- The umbrella registration PR was merged into tailrocks-skills main at
  2b6d21c326e5febf889d280cb2c5f4a595775ff.
- Independent read-only review of baseline commit 5dff1239 requested changes
  for campaign identity collisions, fail-open completion, and missing restore
  artifacts; all three were fixed and covered by the hardening commit. Its
  separate concern that the plugin lacks a duplicate executable convergence
  engine was rejected as out of boundary: the skills are the executor and
  compose existing lifecycle owners, with real-agent landing evidence.
- Review-driven hardening is published: campaign reuse rejects
  repository/path/request/target collisions, completion requires target
  observation plus a target-bound attached receipt, and snapshot restore
  rejects missing patch artifacts. Recovery tests cover all three.
- Tag v0.1.0 is published. Release workflow 35826243801 passed and published
  catalog.json and plugin.json at
  https://github.com/tailrocks/tailrocks-repository-skills/releases/tag/v0.1.0.
- The v0.1.0 tag was installed through native Codex and Claude marketplace
  flows in an isolated checkout; Codex and Claude both reported enabled
  version 0.1.0 and Claude strict validation passed.
- Final hosted CI run 35830543413 passed selector, main/non-main landing,
  scoped cleanup, recovery/resume, no-op, client-contract, manifest, and
  inventory checks.
- v0.1.1 is published. Release workflow 35834905290 passed; the release API
  exposes catalog.json and plugin.json assets for tag v0.1.1. A fresh exact-tag
  checkout installed as v0.1.1 in both native Codex and Claude marketplace
  flows, and both temporary registrations were removed.
- Follow-up test commit `cbc9968` updates the optional Codex E2E invocation for
  Codex 0.155.1; hosted CI `35842398838` passed.
- v0.1.2 binding hardening is prepared: explicit repository selectors are
  checked against the current checkout's normalized GitHub origin before
  campaign state creation; mismatch and missing/unrecognized origin tests
  fail closed. Selector resolution now freezes exact PR/branch membership,
  target-wide leases reject concurrent campaigns, and completion requires
  typed audit/review/CI/landing/verification receipts. The preserved-work
  real-agent harness mode retained the latest synthetic campaign artifacts for
  independent inspection.

## Completed research

- Read the superseding goal and prompt in full.
- Read Tailrocks authoring, pull-request, and release guidance.
- Compared sibling plugin manifests and lifecycle ownership.
- Checked Codex and Claude native invocation rules.
- Recorded sibling repository SHAs and local tool versions in docs/research.md.

## Recovery record

A delegated probe reused the shared workspace as temporary state and removed uncommitted Git metadata plus the first progress and architecture records. It was stopped; all research agents were closed. The Rust helper and source specification survived. Git was reinitialized before reconstruction. Future delegated work must use an isolated temporary directory or worktree, never the shared checkout.

## Blockers

- Live Claude model E2E is blocked before model execution by the installed
  client's expired OAuth session.
- Hosted PR-to-non-main landing is not proven because Jackin remains read-only
  and no authorized disposable hosted test repository was available.
- Semantic target-relative convergence remains model/owner-driven: partial,
  squash, cherry-pick, revert, successor, dependency, cross-target
  adaptation, target policy, review, CI, and actual connected landing still
  need dedicated fixtures and authorized lifecycle integrations. The helper
  now freezes selector metadata and enforces mechanical receipt/lease gates;
  it does not pretend to replace those owners.
- The full v2 adversarial matrix remains incomplete: all-work live discovery,
  live remote pagination, hosted PR landing, Git/LFS/submodule recovery, and
  independent Claude acceptance still need authorized fixtures or runtime
  access. Local contracts cover the implemented seams.

## Next

1. Run authenticated Claude real-agent acceptance when credentials are
   available.
2. Run hosted PR-to-non-main acceptance only in an authorized disposable test
   repository; never use Jackin for mutation.
3. Expand the v2 adversarial matrix in isolated fixtures, then re-audit the
   evidence before closing the goal.
