# Tailrocks repository skills: delivery goal

Status: active; v0.1.0 is shipped, v0.1.1 is ready for release after the
recorded local gates, and Claude/hosted non-main evidence remains externally
blocked as recorded below.

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
scoped-cleanup proof (3c996a3ad9d87d2e438456280edc29f7b77eedbf); subsequent
evidence-only commits preserve the verification records.
v0.1.0 is released and registered in the Tailrocks umbrella. Native Codex and
Claude installation was verified. The latest real Codex non-main acceptance
completed campaign `campaign-5b4789d507dd56ba` at target OID
`ec1cb8d556ff0d2193f128364fed7579ba427efa` from initial target
`bc9a0feb9dcf0ee5d28c160001b60a7bf1e5b75c`, with main unchanged at
`ac92839d316618f5dfcfa40bbf213b22cc0028ca`. The run exercised the prebuilt
helper seam and serialized campaign-state mutations. Live Claude execution and
hosted PR-to-non-main landing remain blocked as recorded in PROGRESS.md; the
broad v2 adversarial matrix is not yet complete.
