# Collection decisions

The [Tailrocks organization skills query](https://github.com/tailrocks?q=skills&type=all&language=&sort=)
identified the ten relevant collections. These are ownership decisions, not
claims that any collection was modified or released by this work.

Refreshed 2026-09-24: a live scrape of the query listed 10 of 10 repositories,
and each repository card showed zero open pulls. Read-only `git ls-remote`
confirmed each table SHA is the current `main` tip. The target repository is
still at `ef59c8bde4ea6869f9b4c4b83153534c5d95255a`; no target or umbrella PR
existed before this work.

| Collection | Decision | Observed `main` | Open PRs at inspection | Ownership boundary |
| --- | --- | --- | --- | --- |
| `tailrocks-repository-skills` | KEEP + FINISH | `ef59c8bde4ea6869f9b4c4b83153534c5d95255a` | None | This plugin owns repository source audit, `repo-merge` coordination, and scoped cleanup. |
| `tailrocks-skills` | KEEP + UPDATE | `2b6d21c326e5febf889d280cb2c5f4a595775ff2` | None | Umbrella owns its directory, catalog, and registration; it does not become this plugin's source tree. |
| `tailrocks-pull-request-skills` | KEEP | `2b4f71f49fd27061e64d16b2b7f83d9bd2df5612` | None | Owns individual PR review and merge policy; this plugin calls those owners. |
| `tailrocks-skill-authoring-skills` | KEEP | `9e25890fd63f7ca6c587490ba7cc432f5fdd98d6` | None | Owns skill authoring, auditing, and authoring validators. |
| `tailrocks-roadmap-skills` | KEEP | `66d9c79f6472ddace0e265335dc8dd36cdeb8a86` | None | Owns roadmap planning and delivery reconciliation. |
| `tailrocks-code-quality-skills` | KEEP | `0b9a1eaa83ca2ad9b2c895741648e7cde10f6189` | None | Owns general code-quality workflows and standards. |
| `tailrocks-open-source-skills` | KEEP | `6e77a448f9776e837bfc9ab18b833bd5fdc26d3a` | None | Owns open-source project practices, not repository source convergence. |
| `tailrocks-typescript-skills` | KEEP | `f434715f7c664af431f0be62982aa379400102de` | None | Owns TypeScript-specific development practices, not repository orchestration. |
| `tailrocks-rust-skills` | KEEP | `bcc31b1d935dac4de191a6b71b3091f628d204c0` | None | Owns Rust-specific development practices, not repository orchestration. |
| `tailrocks-macos-skills` | KEEP | `1fb177a9a4dc16120b4bc7ca9c0eb4e68f9119d2` | None | Owns macOS-specific workflows, not repository orchestration. |

The internal `tailrocks-repository-converge` route is REMOVE / FOLD INTO
`repo-merge`; it is not an additional collection or end-to-end owner. Audit
and cleanup remain separate capabilities with their own boundaries. PR review
and merge remain delegated to `tailrocks-review-pr` and
`tailrocks-merge-pr`.

Historical sibling references in the preserved v2 specification remain
useful for requirements. Current 0.2.0 claims require fresh verification; see
[requirements-to-evidence](requirements-to-evidence.md).
