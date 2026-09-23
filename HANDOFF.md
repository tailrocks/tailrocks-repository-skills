# Handoff

## Scope

Continue from the active goal in GOAL.md. Keep the repository target-bound and fail-closed. Do not edit Jackin.

## Durable state

The helper writes campaign JSON and create-new campaign/target leases outside the repository. A campaign records repository identity, exact target branch/ref/OID, initial and current target OIDs, frozen source selectors and resolved metadata/provenance, scope, local-only/audit modes, configuration digests, scan coverage, decisions, typed receipts, recovery index, phase, status, and journal. Reusing a campaign validates repository path, request, resolution, and target identity. Attach every target-bound phase receipt before completion; completion requires target-observed plus all applicable audit/review/CI/landing/verification receipts. Resume must use the same campaign and target; a different target starts a different campaign. Re-observe the target after every advance; non-fast-forward movement fails closed.

## Required completion proof

- Parser contract passes for all selector forms, quoting, literal #, deduplication, mixed repositories, and omitted-main.
- Target contract proves existing main and existing non-main selection, missing-target rejection, no default/current-HEAD fallback, and main unchanged when non-main is selected.
- Fixture landing proves source A into main, source A into release/next, multiple sources into one target, target-relative no-op, and rerun idempotency.
- Recovery proof restores staged, unstaged, ignored, untracked, and symlink state before cleanup.
- Client proof records Codex native skill invocation and Claude namespaced plugin invocation. If Claude authentication is unavailable, report that exact blocker.
- CI/review/landing receipts name the exact target and target OID. Queued merges do not count.
- Campaign completion must be journaled as campaign-complete/complete only
  after target observation and all applicable typed phase receipts are
  attached through the helper; missing snapshot patch artifacts fail
  restore-test and block cleanup.
- Latest real Codex acceptance landed feature/auth into disposable
  `release/next` at `395154a65036e65a83dfc5edd70172c7271b7d6b` from initial
  target `401b69dcc549b3df7cd089dbb82753369e546fe2`, while keeping main at
  `36c4a47febe81790b8b232915177da9f20bc669c`; campaign
  `campaign-c991f32f1deb5da4` completed with audit, review, landing, target
  observation, and completion receipts. The run recovered to a writable clone
  after immutable checkout metadata, used `TAILROCKS_HELPER_BIN` for a
  prebuilt helper outside the sandbox, and exercised the per-campaign state
  mutation lock.
- Published proof: hardening commit
  4809cf4c1cc91df6ff28cbf009fe3de83de96437; CI 35826193979; release workflow
  35826243801; tag v0.1.0. The tag installed and validated in both native
  clients. Umbrella registration merged at
  2b6d21c326e5febf889d280cb2c5f4a595775ff.
- v0.1.1 is shipped: commit `6c3b62b`, hosted CI `35834837262`, tag
  `v0.1.1`, release workflow `35834905290`, and fresh exact-tag installs in
  native Codex and Claude both passed. The release API exposes the canonical
  `catalog.json` and `plugin.json` assets.
- Current main also contains test compatibility commit `cbc9968`, which
  updates the optional Codex 0.155.1 E2E flag; CI `35842398838` passed.
- Current unshipped work is v0.1.2: explicit `--repo`/URL campaigns verify
  normalized GitHub `origin` identity before state creation; `resolve-selectors`
  freezes paginated PR/branch metadata; target leases serialize a bound target;
  non-fast-forward observation fails closed; typed phase receipts gate
  completion; and the native fixture harness can preserve synthetic
  receipts/transcripts for review.
  Do not call v0.1.2 shipped until commit, CI, tag, release, and fresh install
  are verified.
- Cleanup proof landed in 3c996a3ad9d87d2e438456280edc29f7b77eedbf; later
  main commits only update evidence records. Hosted CI 35830543413 passed.

## Ownership

repo-merge composes the other repository skills and existing pull-request lifecycle skills. It must not copy their policy. Audit is read-only. Converge owns target-relative adaptation and landing orchestration. Cleanup owns eligibility and deletion gates.
