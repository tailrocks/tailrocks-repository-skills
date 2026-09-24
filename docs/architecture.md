# Ownership and operation

`repo-merge` is the only end-to-end coordinator. It binds the repository,
selected sources, target, and cleanup scope, then coordinates audit, justified
changes, review, CI, landing, verification, and eligible cleanup.

| Capability | Owner | Boundary |
| --- | --- | --- |
| End-to-end selected-source or `--all-work` run | `repo-merge` | Only coordinator; one repository and one selected target per run. |
| Read-only inventory and target-relative findings | `tailrocks-repository-audit` | No source, ref, PR, or remote mutation. |
| Proven cleanup of resolved selected sources | `tailrocks-repository-cleanup` | No implementation or scope expansion; `--cleanup=none` forbids deletion. |
| Independent PR review | `tailrocks-review-pr` | Read-only review; no edits, approvals, posts, or merges. |
| PR landing | `tailrocks-merge-pr` | Owns PR checks and actual merge policy. |

There is no separate repository-converge route and no second pull-request
review or merge policy. The old converge skill is folded into `repo-merge`.
CampaignState, journal, lease, and receipt machinery is out of the active
design. Use Git and `gh` for native repository operations; add no custom helper
or runtime and require no `cargo run`. This supersedes the full v2 spec's
small-Rust-helper preference; selector safety, snapshot/restore, and resume
remain required skill behaviors. Resume reads a local source/target handoff and
revalidates identities before continuing.

## Operation

1. Parse selectors structurally; bind one repository and the exact target.
   Omitted target means literal `main`. Reject missing or ambiguous targets.
2. Resolve mixed branch, PR, and listing selectors completely; retain
   provenance and record the frozen source set. `--all-work` expands discovery
   only to the authorized repository and local roots.
3. Audit each selected source against a fresh target. Audit-only stops without
   mutation. Normal mode preserves required state before changes and proves
   restoration in a disposable location before any cleanup.
4. Finish only justified work. Request independent review from
   `tailrocks-review-pr`, satisfy checks that apply to this target, then use
   `tailrocks-merge-pr` for a real PR landing. A preflight or queued merge is
   not completion.
5. Verify the exact destination and resulting tree. A non-main run has no
   hidden main updates. `--local-only` reports local verification only.
6. Run cleanup only for selected sources whose identity, target obligations,
   dependencies, authorization, and restore proof remain valid. Otherwise
   retain and report the source.

## Lifecycle commands and high-risk rules

Invoke review with Codex `$tailrocks-review-pr` or Claude
`/tailrocks-pull-request-skills:tailrocks-review-pr`. Invoke landing with
Codex `$tailrocks-merge-pr` or Claude
`/tailrocks-pull-request-skills:tailrocks-merge-pr`.

The owner commands are `bun scripts/merge-preflight.ts --root <repo> --pr <N>`
and, only after its gates pass, `bun scripts/merge-pr.ts --skill-file <absolute
SKILL.md> < request.json`. Supply the exact PR and expected head, requested
target, fresh review and CI evidence, repository worklist result, and required
high-risk confirmation. CI/workflows, auth/security, release/versioning,
migrations, force-push, and `--admin` require fresh PR-specific confirmation.
For a failed/cancelled required check, stop unless the owner authorizes exactly
one named `--admin <check>` bypass with that confirmation. Delivery or
documentation gate waivers require an exact reason. Prior approvals, comments,
or “safe to merge” text grant no authority. Never bypass branch protection or
merge queues, force-push the destination, or replace the guarded owner command
with direct `gh pr merge`. A failed or uncertain owner result blocks
completion. Recheck after every commit, push, PR refresh, review fix, or target
advance.
