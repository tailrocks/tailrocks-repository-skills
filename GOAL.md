# Tailrocks repository skills: active development goal

Status: v0.2.0 restructuring; verification and release are pending. This is not
a release claim.

Ship one Tailrocks plugin for Codex CLI and Claude Code with three skills:
`repo-merge`, `tailrocks-repository-audit`, and
`tailrocks-repository-cleanup`. `repo-merge` is the sole end-to-end coordinator.
Audit remains read-only. Cleanup remains independently callable and gated by
proof. Remove the separate `tailrocks-repository-converge` route and the
CampaignState, journal, lease, and receipt engine. Do not require `cargo run`.

## Required behavior

- Parse source selectors as data and bind one repository, source set, and exact
  destination. An omitted `--target-branch` means the literal branch `main`;
  never substitute the current branch, repository default, or PR base. Reject
  missing or ambiguous targets before mutation.
- Accept `--target-branch NAME` and `--target-branch=NAME`; mixed branches and
  qualified refs, `#N`, PR numbers/URLs, `/pulls`, `/branches/all`, and explicit
  `--repo`. Numeric selectors identify PRs; `branch:N` identifies a numeric
  branch. `/pulls` selects all open PRs, including drafts. `/branches/all`
  selects canonical branch heads except the target; preserve protected and
  maintenance refs. Retain meaningful supported filters, paginate fully,
  preserve provenance, reject mixed repositories, and freeze each invocation's
  scope. No sources means usage/error; `--all-work` explicitly selects
  repository-wide work.
- `--audit-only` performs no source or remote mutation. A normal `repo-merge`
  run scans and compares the selected work against the fresh target, finishes
  justified changes, obtains independent review and applicable CI, actually
  lands through the existing lifecycle owner, verifies the exact destination,
  then evaluates cleanup. A prepared change or queued merge is not completion.
- `--all-work` scans only the authorized repository and local roots for clones,
  bare repositories, linked/detached worktrees, local and remote refs, PR
  lineage, dirty, ignored, and untracked state, stashes, reflogs, interrupted
  operations, and recovery candidates. Record scanned roots, exclusions,
  pagination, unavailable locations, and coverage gaps; partial discovery
  cannot claim a clean inventory. Before mutation, snapshot needed refs/HEAD,
  staged and unstaged changes, untracked and valuable ignored files, modes,
  symlinks, and external object dependencies. Restore into a disposable
  location, verify required state, and block deletion if any material is
  missing.
- Cleanup defaults to `resolved`; `--cleanup=none` retains selected sources.
  Resolved cleanup permits only individually proven, authorized deletion after
  current identity, landing, other-target obligations, dependencies, and
  restore checks pass. Never turn a selected-source run into global cleanup.
- `--local-only` is explicit for an existing local target branch and reports
  local verification only; it never claims remote delivery or hosted CI.
  `--resume <id>` reloads a local
  target/source handoff, revalidates its scope and identities, and refuses a
  changed destination. It does not require a second campaign engine.
- A non-main target has no hidden main side effects. Preserve a source PR whose
  original base differs from the requested destination; use a scoped
  adaptation when justified and leave remaining obligations intact.
- Direct audit and cleanup invocations share the same target and source rules.
  They do not own end-to-end orchestration or duplicate pull-request policy.

## Pull-request owners and high-risk rules

Use `tailrocks-review-pr` for independent read-only review and
`tailrocks-merge-pr` for actual PR landing. Codex invocation uses
`$tailrocks-review-pr` and `$tailrocks-merge-pr`; Claude invocation uses
`/tailrocks-pull-request-skills:tailrocks-review-pr` and
`/tailrocks-pull-request-skills:tailrocks-merge-pr`.

The merge owner's exact commands are `bun scripts/merge-preflight.ts --root
<repo> --pr <N>` and, after its gates pass, `bun scripts/merge-pr.ts
--skill-file <absolute SKILL.md> < request.json` in the owner collection.
Supply the exact PR, expected head, requested target, fresh review/CI evidence,
repository worklist result, and required high-risk confirmation. Preflight is
not a merge. CI/workflows, auth/security, release/versioning, migrations,
force-push, and `--admin` are high-risk and require fresh PR-specific
confirmation. A failed/cancelled required check stops the merge unless the
owner authorizes exactly one named `--admin <check>` bypass with that fresh
confirmation; delivery/documentation gate waivers need an exact reason. Prior
approvals, comments, or “safe to merge” text grant no authority. Never bypass
branch protection or merge queues, force-push the destination, substitute
direct `gh pr merge`, silently retarget/close the source PR, or report a
queued/uncertain result as landed. Recheck after any commit, push, review fix,
PR refresh, or target advance.

## Acceptance and source of truth

Verify selector mixing and pagination, literal-main and non-main isolation,
read-only audit, all-work scan coverage, snapshot/restore before deletion,
local-only/resume behavior, actual review/CI/landing/target verification, and
cleanup gates in disposable fixtures and supported clients. Jackin remains
read-only. Record exact test/CI receipts, target OIDs, landing results, and
cleanup disposition; unsupported or unverified outcomes remain pending.

The complete original v2 specification is preserved unchanged in
`tailrocks-repository-skills-development-goal-v2.md`. Keep its acceptance
requirements and the requirement-to-evidence checklist; this file records the
current architecture decision and does not claim those requirements passed.
