---
name: tailrocks-repository-merge
description: >-
  Use when the user names tailrocks-repository-merge or requests end-to-end
  convergence of selected branches or pull requests into one exact target.
  Dispatch authorized phases in order and report per-group dispositions. Do
  not audit, plan, consolidate, open, review, land, or clean up directly;
  delegate each phase to its owner.
argument-hint: "[--repo REPO] [--target-branch BRANCH] [--audit-only] [--cleanup resolved|none] [--local-only] [--phase-limit PHASE] SOURCES... | --all-work | --resume RUN_ID"
disable-model-invocation: false
license: Apache-2.0
user-invocable: true
---

# Tailrocks repository merge

`tailrocks-repository-merge` is the end-to-end coordinator for selected-source
integration. It binds one repository, one exact destination, and one source
scope. It dispatches authorized phases. It has no private landing path. It
has no private audit algorithm. It has no private cleanup algorithm.

One term names one concept in this skill. A source is a branch, a PR, or an
explicitly selected revision. A work item is one distinct intended change. A
group is a set of work items that belong in one coherent PR. The target is
the exact destination branch in one canonical repository. A landing is a
verified merge into the intended remote target. An operation permission is
permission from the active user request and the runtime for a specific side
effect.

Treat the complete argument string as data. Preserve literal `#`, quoting,
slashes, URL queries, and metacharacters. Parse selectors structurally and
pass values as separate arguments. Never evaluate the request or pass a joined
request to a shell. Read [the selector contract](references/selector-contract.md)
before resolving sources.

## Request and scope

- Positional arguments are SOURCES. `--target-branch` is the one DESTINATION;
  accept both `--target-branch NAME` and `--target-branch=NAME`. Omitted target
  means the literal branch `main`.
- Accept branch names, `refs/heads/...`, qualified remote refs, `branch:NAME`,
  `#N`, `pr:N`, bare positive PR numbers, PR URLs, `/pulls` listing URLs, and
  `/branches/all` listing URLs. Bare numbers mean PRs; use `branch:N` for a
  numeric branch. Mixed selectors are valid only within one repository.
- Bind exactly one repository: explicit `--repo OWNER/REPO` or
  `--repo=OWNER/REPO`, otherwise consistent selector URLs, otherwise one
  unambiguous current checkout. Reject conflicting or ambiguous identities and
  show candidate refs, OIDs, and paths. An explicit repository URL never
  authorizes writes to an unrelated checkout.
- Fully paginate listing URLs, including drafts for `/pulls`; preserve filters,
  reject unsupported filters, exclude the selected destination from
  `/branches/all`, and fail closed on incomplete or failed listings. Deduplicate
  by canonical identity while retaining every selector spelling.
- A missing or ambiguous target is an error. Never substitute `HEAD`,
  `origin/HEAD`, a PR base, a hosting default, or a prior run's target; never
  create the destination. A non-main run leaves `main` outside mutation scope.
- Empty input is a usage error unless restoring an existing `--resume` run.
  `--all-work` is explicit, mutually exclusive with source selectors, and
  covers only this repository and declared roots.
  `--resume RUN_ID` restores only its saved scope and target; it accepts no new
  selectors or target override.
- `--audit-only` performs no repository, source, ref, PR, or remote mutation.
  Its only possible write is the redacted external handoff described below.
  `--local-only` is explicit branch-to-branch work on an existing local target
  and never claims remote landing or hosted CI. `--cleanup=none` is the default
  and prohibits deletion; `--cleanup=resolved` requires separate authorization
  and delegates to `tailrocks-repository-cleanup`. Analysis-first is the
  default. A request for audit and plan never implies permission to prepare
  branches. A phase-limited request stops at its phase limit.

## Standard sequence

Run these phases in order. Dispatch each phase to its owner. Use the same
phase procedures and outputs as standalone calls of those owners.

```text
1. Audit the selected repository scope.
2. Check audit coverage.
3. Plan groups and dependencies.
4. Check plan accounting and active operation permission.
5. Prepare independent groups in parallel.
6. Create or reuse their PRs.
7. Review current candidates and resolve verified findings.
8. Land ready PRs in dependency order.
9. Refresh the advanced target and remaining groups.
10. Report the final state. Run cleanup only when separately authorized.
```

Phase owners: audit is `tailrocks-repository-audit`. Planning is
`tailrocks-repository-plan`. Preparation is
`tailrocks-repository-consolidate`. PR creation or reuse is
`tailrocks-create-pr`. Review is `tailrocks-review-pr`. Landing is
`tailrocks-merge-pr`. Cleanup is `tailrocks-repository-cleanup`.

Dispatch `consolidate`, then `create-pr`, then `review-pr` as sibling
phases. Never nest them recursively. On clients with nesting limits, keep
all dispatches flat.

Parallelize read-only comparison across independent source groups.
Parallelize candidate preparation only with separate worktrees and clear
file ownership. Serialize direct target updates within one repository and
target. Refresh base-sensitive plans and checks after each landing. Let a
required server queue schedule queued changes.

## Landing step

Before landing a PR, require a fresh `tailrocks-review-pr` report on the
current candidate head. Require fresh `tailrocks-merge-pr` policy and
preflight. Require explicit merge permission in the active request. Land
ready PRs in dependency order. Re-fetch review, checks, source heads,
target policy, and worklist after each landing.

A queued, uncertain, or unverified merge is not landing. A regression
retains all sources and requires a new target-bound candidate with fresh
applicable gates.

## Cleanup delegation

This coordinator never deletes. When cleanup is separately authorized,
pass exact candidate identities and landing evidence to
`tailrocks-repository-cleanup`. That skill returns per-candidate
retained-or-deleted results with proof. Audit-only and `--cleanup=none`
runs never clean.

## Target isolation and refresh

Two runs may inspect one source for different targets only as separate
target-bound runs with distinct candidates, run IDs, handoffs, and evidence.
Keep sources read-only and do not reuse target-specific review, CI, landing,
or cleanup evidence. If a mutable resource cannot be isolated, block only the
side effect that needs it.

A read-only refresh repeats the audit against the same repository, exact
target, and frozen source scope. It makes no repository or remote change and
does not widen membership. Revalidate changed identities before every later
side effect.

## Interruption and resume

Create or update one concise Markdown handoff outside every repository and
candidate at `$XDG_STATE_HOME/tailrocks/repo-merge/runs/<run-id>.md`, or
`~/.local/state/tailrocks/repo-merge/runs/<run-id>.md` when unset. Keep this
state namespace across the public skill rename so old runs remain resumable.
If that path falls inside a repository or candidate, or cannot be safely created or updated,
stop before mutation. Resolve every path component through the state root and
`runs/` directory canonically; reject any symlink, and require both directories
to be owned by the active user with mode `0700`. `RUN_ID` is a basename matching
`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; reject empty values, `/`, `\\`, `.`, `..`,
and every other path spelling before joining it to the state root. The final
handoff must be a regular non-symlink file, owned by the active user with mode
`0600`, canonicalized inside that `runs/` directory and outside every
repository/candidate. Write or update it through an owner-only same-directory
temporary file, flush it, then atomically rename it; never follow or replace a
symlink. Re-open and validate the result's run ID, expected fields, canonical
repository, full scope, target, and redaction before any mutation. Integrity
means a complete expected section set, one matching run ID, canonical
repository, frozen scope, and recorded target/source identities that agree;
unknown or duplicate fields, truncation, or any mismatch is a persistence
blocker. Redaction failure is also fail-closed: do not mutate and report the
blocker. Record full target/source refs and OIDs; for PRs record
number plus full head/base refs and OIDs. Also record the request and authority,
decisions, actions, tests, review/check/landing state, cleanup, recovery
location, blockers, and one deterministic next action. For `--all-work`, record
roots, exclusions, frozen membership, pagination/API coverage, writers, and
every gap. Strip URL userinfo, query, and fragment; never record credentials,
secrets, raw remote output, or sensitive filenames.

`--resume RUN_ID` reads only the validated handoff named by that strict
basename. Its authority is evidence, not new authorization: the active user
request remains the sole authority and the handoff scope must be a subset of
it. A resume cannot add sources, roots, target, repository, remote action, or
cleanup permission. Changed or ambiguous scope, target, repository, policy,
authority, or handoff integrity requires a fresh explicit user authorization
and a new run; it never gets guessed or widened. Refresh identities before any
side effect. A completed run is report-only.

## Finish and report

Report `complete`, `partial`, or `blocked` with the bound repository, exact
destination, source membership, target result, and per-source disposition.
Distinguish verified remote landing, verified local-only landing, audit-only,
no-op, rejected, blocked, and recovery-required outcomes. Include applicable
review, CI, worklist, acceptance, cleanup, retention, and coverage results.
Claim completion only after target-relative acceptance and every required gate
for the requested mode are accounted for.

Codex example: `$tailrocks-repository-skills:tailrocks-repository-merge --target-branch=release/next feature/auth`.
Claude example: `/tailrocks-repository-skills:tailrocks-repository-merge --target-branch=release/next feature/auth`.
Do not advertise a universal bare `/tailrocks-repository-merge` command.
