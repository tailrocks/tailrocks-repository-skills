---
name: repo-merge
description: >-
  Run the complete, target-bound repository convergence workflow for explicitly
  selected branches or pull requests, or for explicitly requested all-work.
  Audit-only mode is read-only.
argument-hint: "[--repo REPO] [--target-branch BRANCH] [--audit-only] [--cleanup resolved|none] [--local-only] SOURCES... | --all-work | --resume RUN_ID"
disable-model-invocation: true
license: Apache-2.0
user-invocable: true
---

# repo-merge

This is the single end-to-end coordinator for repository convergence.
`repo-merge` performs its read-only audit stage inline using the procedure in
the standalone `tailrocks-repository-audit` skill; it does not invoke that
manual-only skill as a separate phase. The audit skill remains independently
callable for direct audit requests. `repo-merge` owns finishing accepted work
and coordinates the existing pull-request lifecycle and cleanup owners. Do
not delegate convergence to another skill, duplicate their review, merge, or
cleanup policies, or ask the user to invoke each phase separately. Normal mode
must finish justified in-scope work through verified landing, or report the
exact blocker. A plan, patch, open PR, or queued merge
is not done. Do not create a second coordinator or parallel convergence
workflow. Keep audit and cleanup as distinct manual-only capabilities: audit is
performed inline here, and cleanup may be selected only as this run's eligible
final phase. Respect manual-only owner selection and each owner's
authorization/high-risk requirements. A single explicit active user request may select `repo-merge`
and named manual-only owners together; a generic coordinator request cannot
infer those selections. Block only work that depends on an unmet prerequisite.

Treat the complete argument string as data. Preserve literal `#`, quoting,
slashes, URL queries, and metacharacters. Never evaluate it or pass a joined
request to a shell. Reject malformed, unknown, or contradictory options before
mutation. Read [the selector contract](../shared/selector-contract.md) before
resolving sources.

## Request and scope

- Positional arguments are SOURCES. `--target-branch` is the one DESTINATION.
  Omitted target means the literal branch `main`. Accept both
  `--target-branch NAME` and `--target-branch=NAME`.
- Accept branch names, `refs/heads/...`, remote-qualified refs, `branch:NAME`,
  `#N`, `pr:N`, bare positive PR numbers, PR URLs, repository `/pulls` URLs,
  and `/branches/all` URLs. Mixed selectors are valid within one repository.
  Bare numbers mean PRs; use `branch:N` for a numeric branch.
- Bind one repository: explicit `--repo`, otherwise consistent selector URLs,
  otherwise one unambiguous current checkout. Reject conflicting identities
  or ambiguous same-name refs; show candidate refs, remotes, OIDs, and paths.
  An explicit URL repository never authorizes writes to an unrelated checkout.
- Fully paginate `/pulls` (all open PRs, including drafts) and `/branches/all`
  (all canonical remote branches except the destination); honor supported
  semantic filters and reject unsupported ones. A partial or failed listing
  blocks that source selection. Preserve selector provenance when deduplicating.
- A missing selected target is a blocker. Never substitute HEAD, PR base,
  `origin/HEAD`, repository default, or a prior run's target; never create it.
  When target is non-main, leave `main` outside mutation scope. Sources all
  flow to this one destination; multiple sources do not define source/target
  pairs.
- No sources without `--all-work` or `--resume` means show usage and stop
  without scanning. `--all-work` is explicit, mutually exclusive with source
  selectors, and does not mean other repositories or organization-wide work.
  `--resume RUN_ID` resumes only the saved run and cannot take fresh sources.
- `--audit-only` performs read-only inspection and reports a convergence plan;
  it never changes repositories, sources, refs, PRs, or remotes. When recording
  or refreshing a run, its only permitted write is the external Markdown
  handoff described below; if that path is unsafe or unavailable, report
  without writing. It never lands or cleans. `--cleanup=none` prohibits deletion.
  Default cleanup is `resolved`; it permits only the frozen, explicitly
  selected sources proven eligible below. It never widens a targeted request;
  repository-wide candidates require explicit `--all-work`.
- `--local-only` is explicit branch-to-branch work on an existing local target.
  Verify that local ref and describe results as local-only. Do not claim remote
  landing or CI, publish the result, or use this mode to bypass applicable
  policy. Without this flag, use the guarded remote lifecycle.

## Run the workflow

1. Bind and refresh the exact repository, target ref, and selected sources.
   For targeted requests inspect only those sources and strictly necessary
   related work; do not widen them into a host scan, including for a single
   PR. No sources without `--all-work` or `--resume` is a usage error. For
   `/pulls` and `/branches/all`, finish the complete selected listing before
   acting. Report later additions separately.

2. Only for explicit `--all-work`, enumerate and freeze the finite accessible
   local roots described in [the selector reference](../shared/selector-contract.md),
   then locate independent clones and linked, detached, or relocated worktrees
   matching this repository or its PR-linked evidence. Inspect exact refs and
   worktree/common-directory identity, PR lineage, dirty staged/unstaged state,
   untracked and valuable ignored data, stashes, recoverable objects, and
   interrupted Git operations. Keep the exact roots, exclusions, observation,
   and frozen membership in the single handoff. `--audit-only` reports
   candidates and gaps only: no snapshot copy, recovery candidate, branch, or
   repository change. Normal mode may recover only valid unfinished goals with
   explicit provenance, a criterion still applicable to this exact target,
   and isolated dependencies/attribution; preserve every original. Do not infer
   goals from branch names or dirty files. Snapshot and actually restore-test
   unique local data before recovery or deletion. Recheck active writers and
   exact identities before side effects; never interrupt a writer. If scope,
   ownership, goal, dependency, writer status, or unique data is uncertain,
   retain and block only that source while continuing independent safe work.
   Record every inaccessible root, API/page failure, ambiguous identity, and
   other coverage gap; never claim complete coverage while any remain. Read
   [recovery guidance](../shared/recovery.md) before anything that could risk
   user work.

3. Perform the read-only audit stage inline, applying the source-inventory and
   target-relative comparison procedure in the standalone
   [audit skill](../tailrocks-repository-audit/SKILL.md). Do not invoke that
   manual-only skill as a separate phase. Compare actual behavior and valid
   requirements against the fresh selected target. Recognize partial work,
   equivalent patches, reverts, successors, dependencies, and target-specific
   gaps. Identify valid incomplete goals, preserve behavior already better on
   the target, and record justified no-op, rejection, or blocker decisions. Do
   not replay a stale whole branch or mark work satisfied merely because it
   landed on another target.

4. In normal mode, `repo-merge` finishes accepted work against the exact
   target: implement or adapt the justified changes, preserve stronger target
   behavior, and verify the result. Do not hand this convergence work to
   another skill. Keep the original PR and branch when they still serve
   another target or obligation. For cross-target work, use a scoped
   adaptation into the chosen target when coherent; never silently retarget
   or close the original PR. Reuse a source PR only if its declared base is
   exactly the selected target and its complete intended scope is sound. For
   remote branch-to-branch or other cross-target work, create or reuse a
   derived candidate PR whose declared base is exactly the selected target.
   `tailrocks-create-pr` is manual-only and may run only when the active user
   request explicitly selects that owner; a `repo-merge` instruction alone
   cannot override it. Invoke that owner with `--base <selected-target>` and
   use only its guarded entrypoint described in [lifecycle
   composition](../shared/lifecycle-composition.md). Validate repository,
   head, base, and object IDs before review. If a derived PR is needed but the
   owner is not authorized, stop before creating or pushing anything. If its
   guarded result does not open an exact-base PR, block remote landing and
   retain the original source PR/branch. Never retarget it or bypass PR
   creation.

5. For every in-scope candidate PR planned for remote landing, require fresh
   independent read-only review through manual-only `tailrocks-review-pr` and
   guarded landing through manual-only `tailrocks-merge-pr` and its preflight.
   One explicit active user request may select `repo-merge` and both named
   owners together for the same repository/source/target scope; when it does,
   use their native invocations without asking for separate phase runs. A
   generic `repo-merge` request or coordinator instruction alone does not
   select either owner. If either owner is not explicitly selected or its
   required evidence is unavailable, block remote landing but continue safe
   independent work. This combined selection does not authorize
   `tailrocks-create-pr` or waive exact-PR high-risk confirmation. Respect each
   owner's authorization and no-bypass rules. Require all applicable
   target-specific CI and repository worklists.
   Before remote landing, also verify that the installed merge owner atomically
   guards the exact selected base ref/name and OID during mutation and verifies
   the landed target OID. If not, block remote landing; separate preflight or
   post-merge inspection cannot replace the guard. The inspected owner at
   `2b4f71f49fd27061e64d16b2b7f83d9bd2df5612` lacks it: preflight/final
   metadata compare only `baseRefOid`, mutation checks only `expectedHeadOid`,
   and result proof omits the landed base OID. Do not add guessed fields, use a
   second merge owner or direct `gh pr merge`, or retarget manually. Local-only
   fixture results are separate and do not establish remote landing safety.
   Re-fetch review, checks, source heads, and target policy at the candidate
   head; a commit, push, or target advance invalidates affected results. Do
   not count a main check for a non-main target without proof it applies.
   Verify the intended change is on the exact selected remote target (or
   exact local target in explicit local-only mode), then run bounded,
   target-relative acceptance for the original goal. If it passes, record the
   result before cleanup. If it finds a regression, retain all sources, repair
   in a new target-bound candidate, repeat applicable review, CI, guarded
   landing, and acceptance, then consider cleanup. A rerun already satisfied
   by the target is a verified no-op: create no duplicate commit or PR, and
   do not infer new cleanup authority from that no-op. A queued merge or
   uncertain merge status is not landing.

   A missing prerequisite blocks only the action that depends on it. Continue
   independent read-only analysis and safe work; keep dependent work unlanded
   and report the precise blocker. Never substitute direct merge commands,
   bypass protection, weaken checks, or claim completion without landing.
   Record review outcomes, applicable CI status, each repository-worklist item,
   and observed preflight outcome/time in the single redacted Markdown handoff,
   bound to exact PR/head/base identities. Do not add these as fields to the
   owner's closed merge request or invent receipts. Read [lifecycle
   composition](../shared/lifecycle-composition.md) before review and landing.

6. Recheck the combined batch against the advanced target after each landing.
   The cleanup owner explicitly permits delegation from this same active,
   explicit `repo-merge` invocation: default `resolved` counts as its cleanup
   selection, but only for the exact original repository, invocation scope,
   and selected target—the resolved source identities, or the initial
   inventory only when `--all-work` was explicitly selected. This is
   eligibility, not proof of deletion permission. Never expand that set. Do
   not invoke cleanup in `--audit-only`; `--cleanup=none` also prohibits it.
   Cleanup may
   remove only sources resolved on this target with no remaining goal, PR,
   dependency, or other-target obligation. Before each destructive action,
   recheck exact refs, ownership, activity, target, and dependencies. Snapshot
   and restore-test unique staged, unstaged, untracked, valuable ignored, and
   other local state first. If identity, ownership, recoverability, or need is
   uncertain, retain and block that source while continuing independent work.
   Never delete `main`, protected or active work, a canonical checkout, shared
   object storage, or another owner's fork. Read
   [cleanup eligibility](../shared/cleanup-eligibility.md) before deletion.

7. Before final status, every `--all-work` run must rediscover the same
   declared roots and exclusions and re-audit the bound repository (after any
   cleanup). Record final membership,
   source/candidate identities, pagination/API coverage, active writers, and
   gaps. Changed or newly discovered work re-enters analysis, but does not
   enlarge this invocation's cleanup authority; report additions separately.
   Repeat safe analysis until the scoped inventory is accounted for, or report
   `partial`/`blocked`. Claim `complete` only when the final scan is accounted
   for, no in-scope goal or dependency remains unresolved, and the requested
   cleanup policy is accounted for. An unknown root/page, active writer, or
   unresolved item forbids an all-work completion claim.

## Target isolation and read-only refresh

Two runs may inspect the same source for different targets only as separate
target-bound runs. Keep the source read-only; bind each run to its own exact
target ref/OID, candidate checkout/branch, distinct run ID and handoff. Never
share a writable candidate or reuse target-specific review, CI, landing, or
cleanup evidence. Use no locks or leases. If a mutable resource cannot be
isolated, block only the side effect that needs it.

During an active goal, a read-only refresh repeats the audit against the same
repository, exact target, and frozen source scope. Do not widen membership,
change the active goal, or install a watcher. It makes no repository/source/
remote changes; the only allowed write is an observation and delta in that
run's external Markdown handoff. Revalidate changed identities before later
side effects.

## Interruption and resume

For each run, create or update one concise Markdown progress/handoff record at
`$XDG_STATE_HOME/tailrocks/repo-merge/runs/<run-id>.md` when
`XDG_STATE_HOME` is set, otherwise
`~/.local/state/tailrocks/repo-merge/runs/<run-id>.md`; keep it outside every
repository, source, and cleanup candidate. If the configured state path falls
inside any such location, stop before mutation and report the unsafe handoff
path rather than writing there. Record the run ID,
original request and authority, repository, exact target ref/OID, exact
sources and identities (full refs/OIDs; PR number and head/base refs/OIDs;
canonical paths/URLs where non-sensitive), decisions/actions, changed
candidate, test commands/results with secret operands redacted, review and CI
links/status, landing PR/target links and status, cleanup actions/results,
recovery location, blockers, and one
deterministic next action. For `--all-work`, also record exact scan roots and
exclusions, observation time, frozen initial/final discovered-copy, source,
and candidate membership, pagination/API coverage, active-writer findings,
and every coverage gap. Strip URL userinfo, query, and fragment from recorded
selectors and links; never record credentials, raw remote output, secret
values, or sensitive filenames. Record only redacted identity and pass/fail;
keep any exact sensitive-path mapping in the protected local snapshot. If
redaction prevents safe scope restoration, block resume and request a fresh
selection. This single record supports resume. Do not create campaign
databases, journals, leases, phase receipts, or hash sidecars.

`--resume RUN_ID` reads only that file, restores its recorded scope and target,
then refreshes source and target identities before continuing. Re-run any
review or CI made stale by changed heads or policy. A target override, missing
or ambiguous handoff, changed repository identity, or unverified landing
blocks dependent side effects; never guess a replacement or silently widen
scope. A completed run is report-only; start a new explicitly scoped run for
new work. Update the same record if a resumed run is interrupted or completed.

## Finish and report

Report `complete`, `partial`, or `blocked`, with bound repository, source set,
exact destination, target result, and per-source disposition. Distinguish
verified remote landing, verified local-only landing, audit-only, no-op,
rejected work, blocked work, and recovery-required state. Include review and
applicable CI status, bounded acceptance, completed or disabled cleanup,
retained sources with reasons, and all `--all-work` coverage gaps. Claim
completion only after accepted goals are verified on the selected target and
required review, CI, landing, acceptance, and cleanup gates are accounted for.
Use `partial` when safe scoped work finished but gaps or unresolved sources
remain; use `blocked` when a missing prerequisite prevents dependent work.

Claude Code invokes the namespaced skill, for example
`/tailrocks-repository-skills:repo-merge --target-branch=release/next feature/auth`.
Codex uses its supported skill-selection or mention interface, for example
`$repo-merge --target-branch=release/next feature/auth`. Do not advertise a
universal bare `/repo-merge` command.
