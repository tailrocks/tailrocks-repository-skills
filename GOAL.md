# Tailrocks repository skills: delivery goal

Status: active; v0.1.2 resolution, lease, receipt, and binding hardening is
in progress. Claude/hosted non-main evidence and several full-spec semantics
remain blocked or incomplete as recorded below.

Ship tailrocks/tailrocks-repository-skills as one installable plugin for Codex CLI and Claude Code. It owns repository audit, convergence, and eligible cleanup while composing the existing pull-request lifecycle skills.

The repo-merge entry point must:

1. Treat positional arguments as SOURCES and --target-branch as the DESTINATION. Omitted target means the literal branch main.
2. Resolve branches, qualified refs, PR numbers, PR URLs, pulls URLs, and branches/all URLs deterministically, with one repository binding, pagination, literal hash transport, provenance-preserving deduplication, and no target fallback.
3. Compare every source against the fresh selected target. Finish justified improvements, independently review, satisfy applicable CI, actually land them, verify the exact target, and clean only eligible sources.
4. Keep cross-target PRs intact. Use scoped adaptation into the requested target when needed. Never confuse a release landing with a main landing.
5. Support audit-only, cleanup=resolved|none, --all-work, durable target-bound resumption, receipts, recovery, idempotent no-op reruns, and actual main and non-main fixture landings.
6. Leave the Jackin repository read-only during development. Use disposable fixtures and authorized test repositories for mutation.
7. Expose native invocation: Claude plugin namespace /tailrocks-repository-skills:repo-merge; Codex $repo-merge or supported skill selection. Do not advertise a universal bare /repo-merge command.

Completion means the selected target contains the justified work and verification receipts prove it. A report, patch, opened PR, or queued merge is not completion.

The full superseding specification is tailrocks-repository-skills-development-goal-v2.md.

Delivery record: main contains the published implementation, hardening, and
scoped-cleanup proof (3c996a3ad9d87d2e438456280edc29f7b77eedbf), plus the
v0.1.1 helper and campaign-state hardening in `6c3b62b`; subsequent records
preserve the verification evidence.
v0.1.0 is released and registered in the Tailrocks umbrella. Native Codex and
Claude installation was verified. The latest real Codex non-main acceptance
completed campaign `campaign-c991f32f1deb5da4` at target OID
`395154a65036e65a83dfc5edd70172c7271b7d6b` from initial target
`401b69dcc549b3df7cd089dbb82753369e546fe2`, with main unchanged at
`36c4a47febe81790b8b232915177da9f20bc669c`. The run exercised the prebuilt
helper seam and serialized campaign-state mutations. Live Claude execution and
hosted PR-to-non-main landing remain blocked as recorded in PROGRESS.md; the
broad v2 adversarial matrix is not yet complete. v0.1.1 passed hosted CI
`35834837262`, release workflow `35834905290`, and fresh native Codex and
Claude installs from tag `v0.1.1`. Unshipped v0.1.2 adds frozen GitHub
selector resolution, current-checkout repository binding verification,
target-wide leases, fast-forward target observation, and typed phase receipts;
its release proof is pending.
