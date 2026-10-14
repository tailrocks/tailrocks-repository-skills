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

- Codex CLI 0.155.1, installed local plugin, workspace-write sandbox,
  disposable fixture, and --local-only --cleanup=none.
- Campaign campaign-15aed4ef4a09c941 bound the exact target
  refs/heads/release/next; audit and independent local review passed, CI was
  correctly not-applicable for the fixture, cherry-pick landing produced
  7db4735a0bcde9f42b083b30c5afbe9eac26b32e, and the campaign journal reached
  complete.
- Post-landing checks proved source commit 8b4bee1e88618f79d3de0a89d38e9f459f70cbcf
  was represented, auth.txt and release.txt were present, main stayed at
  464cfbe245a3130d89caa89ac1bdfa1110ae4554, origin/release/next stayed
  unchanged, and the target clone was clean. No network or cleanup occurred.
