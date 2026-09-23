# Convergence evidence

Observed need: a prepared branch or queued PR is not proof of target
completion. A direct fixture merge can prove a target changed, but only an
orchestrator can bind review, CI, landing, and post-landing evidence to the
same target OID.

Discriminating contract: compare fresh target state, preserve cross-target
source obligations, independently review, satisfy applicable gates, actually
land, re-observe the target, and distinguish local-only from remote delivery.

Control: fixture direct Git landing verifies release/next and main as separate
refs; the initial main OID stays unchanged during release integration.

Acceptance:

- tests/fixture-landing.sh proves one source into a non-main target, multiple
  sources into that target, a separate main landing, target OID recheck, and
  missing-target rejection. Its rerun check proves an already represented
  source leaves the target OID unchanged.
- helper campaign-observe updates current_target_oid only for the recorded
  target identity.
- Shared lifecycle policy routes review to tailrocks-review-pr and landing to
  tailrocks-merge-pr; no duplicate PR policy exists here.

Real-agent receipt:

- Codex CLI 0.155.1, gpt-5.6-luna, high reasoning, approval never,
  workspace-write sandbox, installed local plugin, disposable fixture, and
  `--local-only --cleanup=none`.
- Campaign `campaign-5b4789d507dd56ba` bound the exact target
  `refs/heads/release/next`; audit and independent local review passed, CI was
  correctly not-applicable for the fixture, merge landing produced
  `ec1cb8d556ff0d2193f128364fed7579ba427efa`, and the campaign journal reached
  `campaign-complete/complete`.
- Post-landing checks proved source commit
  `228f5550fd4e275479377068514e0235a2b31d2f` was represented, `auth.txt` and
  `release.txt` were present, main stayed at
  `ac92839d316618f5dfcfa40bbf213b22cc0028ca`, and the target clone was clean.
  No network or cleanup occurred. The helper was built before agent start and
  invoked through `TAILROCKS_HELPER_BIN`; the run also exercised recovery to a
  writable clone when the first checkout's metadata was immutable. The helper's
  per-campaign OS lock serialized the receipt and journal mutations.
