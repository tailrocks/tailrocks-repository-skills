# Handoff

## Scope

Continue from the active goal in GOAL.md. Keep the repository target-bound and fail-closed. Do not edit Jackin.

## Durable state

The helper writes campaign JSON and a create-new lease outside the repository. A campaign records repository identity, exact target branch/ref/OID, initial and current target OIDs, frozen source selectors and provenance, scope, local-only/audit modes, configuration digest, scan coverage, decisions, receipts, recovery index, phase, status, and journal. Resume must use the same campaign and target; a different target starts a different campaign. Re-observe the target after every advance.

## Required completion proof

- Parser contract passes for all selector forms, quoting, literal #, deduplication, mixed repositories, and omitted-main.
- Target contract proves existing main and existing non-main selection, missing-target rejection, no default/current-HEAD fallback, and main unchanged when non-main is selected.
- Fixture landing proves source A into main, source A into release/next, multiple sources into one target, target-relative no-op, and rerun idempotency.
- Recovery proof restores staged, unstaged, ignored, untracked, and symlink state before cleanup.
- Client proof records Codex native skill invocation and Claude namespaced plugin invocation. If Claude authentication is unavailable, report that exact blocker.
- CI/review/landing receipts name the exact target and target OID. Queued merges do not count.
- Real Codex acceptance landed feature/auth into disposable release/next at
  7db4735a0bcde9f42b083b30c5afbe9eac26b32e while keeping main at
  464cfbe245a3130d89caa89ac1bdfa1110ae4554; campaign
  campaign-15aed4ef4a09c941 completed.

## Ownership

repo-merge composes the other repository skills and existing pull-request lifecycle skills. It must not copy their policy. Audit is read-only. Converge owns target-relative adaptation and landing orchestration. Cleanup owns eligibility and deletion gates.
