# Progress

## Current state

- Repository is committed and pushed to the public remote at
  https://github.com/tailrocks/tailrocks-repository-skills.git. Baseline CI
  run 35818512123 and hardening CI run 35826193979 passed. Hardening commit
  4809cf4c1cc91df6ff28cbf009fe3de83de96437 is released; cleanup proof landed
  in 3c996a3ad9d87d2e438456280edc29f7b77eedbf. Patch hardening commit
  6c3b62b is pushed and passed hosted CI 35834837262.
- Rust helper exists under helper/; it is a typed boundary for argument parsing, exact target binding, campaign state, and local-state snapshots.
- Helper tests cover literal hash transport, omitted-main semantics, selector deduplication/provenance, explicit numeric branches, mixed-repository rejection, list URL query preservation, no-selector rejection, and target-bound campaign creation.
- Portable root manifest plus Codex and Claude compatibility manifests are present.
- Disposable contracts pass: selector, main/non-main fixture landing,
  multiple-source landing, target-relative no-op rerun, recovery/resume, and
  client static checks.
- The latest real Codex 0.155.1 / gpt-5.6-luna local-only run used high
  reasoning, approval never, and workspace-write sandbox. It completed
  campaign `campaign-5b4789d507dd56ba` after recovering from immutable
  checked-out metadata into the prepared writable clone. Target
  `refs/heads/release/next` advanced from
  `bc9a0feb9dcf0ee5d28c160001b60a7bf1e5b75c` to
  `ec1cb8d556ff0d2193f128364fed7579ba427efa`; source
  `228f5550fd4e275479377068514e0235a2b31d2f` was represented; `auth.txt` and
  `release.txt` were verified; main stayed at
  `ac92839d316618f5dfcfa40bbf213b22cc0028ca`; and cleanup was none.
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
- The full v2 adversarial matrix remains incomplete: all-work live discovery,
  complete remote API pagination, and every
  Git/LFS/submodule recovery mode still need authorized fixtures or runtime
  access. Local contracts cover the implemented seams.

## Next

1. Run authenticated Claude real-agent acceptance when credentials are
   available.
2. Run hosted PR-to-non-main acceptance only in an authorized disposable test
   repository; never use Jackin for mutation.
3. Expand the v2 adversarial matrix in isolated fixtures, then re-audit the
   evidence before closing the goal.
