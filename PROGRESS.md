# Progress

## Current state

- Repository bootstrap is committed and pushed to the public remote at
  https://github.com/tailrocks/tailrocks-repository-skills.git. Hosted CI run
  35818512123 passed the published baseline.
- Rust helper exists under helper/; it is a typed boundary for argument parsing, exact target binding, campaign state, and local-state snapshots.
- Helper tests cover literal hash transport, omitted-main semantics, selector deduplication/provenance, explicit numeric branches, mixed-repository rejection, list URL query preservation, no-selector rejection, and target-bound campaign creation.
- Portable root manifest plus Codex and Claude compatibility manifests are present.
- Disposable contracts pass: selector, main/non-main fixture landing,
  multiple-source landing, target-relative no-op rerun, recovery/resume, and
  client static checks.
- A real Codex 0.155.1 local-only run completed an actual non-main landing in
  a writable disposable clone: campaign
  campaign-15aed4ef4a09c941, target refs/heads/release/next advanced to
  7db4735a0bcde9f42b083b30c5afbe9eac26b32e by cherry-pick, source
  origin/feature/auth was verified, and main stayed at
  464cfbe245a3130d89caa89ac1bdfa1110ae4554.
- The real-agent harness found and corrected two test assumptions: writable
  clones may expose source/default refs only as origin/*, and completion is a
  receipt status rather than one fixed journal event name. The successful
  agent receipt remains the acceptance evidence; a later retry was stopped
  after a disposable target advance when the model process stalled.
- A post-hardening retry also landed the disposable source into
  release/next (7d2882a3f7e318d3ee6f0d7a84f3556cd086cbd4) while preserving
  main (1eed19fc1ac859cb372d96712fa339cfad93a9ab), but the sandbox denied the
  helper build. It therefore produced no campaign completion receipt and the
  wrapper correctly failed; this run is not counted as end-to-end acceptance.
- The umbrella registration PR was merged into tailrocks-skills main at
  2b6d21c326e5febf889d280cb2c5f4a595775ff.
- Review-driven hardening is staged locally after the baseline push: campaign
  reuse now rejects repository/path/request/target collisions, completion
  requires target observation plus a target-bound attached receipt, and
  snapshot restore rejects missing patch artifacts. Recovery tests cover all
  three.

## Completed research

- Read the superseding goal and prompt in full.
- Read Tailrocks authoring, pull-request, and release guidance.
- Compared sibling plugin manifests and lifecycle ownership.
- Checked Codex and Claude native invocation rules.
- Recorded sibling repository SHAs and local tool versions in docs/research.md.

## Recovery record

A delegated probe reused the shared workspace as temporary state and removed uncommitted Git metadata plus the first progress and architecture records. It was stopped; all research agents were closed. The Rust helper and source specification survived. Git was reinitialized before reconstruction. Future delegated work must use an isolated temporary directory or worktree, never the shared checkout.

## Blockers

- Claude native execution is still blocked by the expired OAuth session; live
  namespaced E2E needs refreshed credentials.
- Release tag/install and post-hardening hosted CI remain.

## Next

1. Commit/push the hardening with DCO signoff and rerun hosted CI.
2. Tag/release 0.1.0 and verify the release assets and install path.
3. Re-run authenticated Claude acceptance if credentials are available; retain
   the OAuth blocker otherwise.
4. Finish final evidence and close the goal only after every required receipt
   and genuine blocker is recorded.
