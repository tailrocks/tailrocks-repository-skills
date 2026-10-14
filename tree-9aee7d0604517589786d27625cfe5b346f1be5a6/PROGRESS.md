# Progress

## Current state

- Repository bootstrap is locally complete and passes the mechanical gates; it
  is not yet committed or published.
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
- No remote repository, release, or umbrella registration has been created yet.

## Completed research

- Read the superseding goal and prompt in full.
- Read Tailrocks authoring, pull-request, and release guidance.
- Compared sibling plugin manifests and lifecycle ownership.
- Checked Codex and Claude native invocation rules.
- Recorded sibling repository SHAs and local tool versions in docs/research.md.

## Recovery record

A delegated probe reused the shared workspace as temporary state and removed uncommitted Git metadata plus the first progress and architecture records. It was stopped; all research agents were closed. The Rust helper and source specification survived. Git was reinitialized before reconstruction. Future delegated work must use an isolated temporary directory or worktree, never the shared checkout.

## Blockers

- Claude native execution was not completed because the installed Claude OAuth session was expired during research. Plugin validation and namespaced command shape were checked; final live execution needs an authenticated session.
- The GitHub repository does not yet exist. Creation, push, CI, release, and umbrella registration remain.

## Next

1. Commit with DCO signoff, create/push the public repository, and run hosted CI.
2. Review and land the publication change through the existing PR lifecycle.
3. Tag/release 0.1.0, install the released plugin, and register it in the
   Tailrocks umbrella.
4. Re-run authenticated Claude acceptance if credentials are available; retain
   the OAuth blocker otherwise.
