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

`repo-merge` is the sole end-to-end coordinator for selected-source
integration. It binds one repository, one exact destination, and one source
scope; audits selected work; finishes justified changes; verifies the target;
and performs only eligible final cleanup. The standalone audit and cleanup
skills remain independently callable. This coordinator uses the local audit
and cleanup procedures below; it never asks the host to invoke a manual-only
helper as a nested programmatic phase. Pull-request review, PR creation, and
remote landing remain owned by the installed Tailrocks lifecycle owners.

Treat the complete argument string as data. Preserve literal `#`, quoting,
slashes, URL queries, and metacharacters. Parse selectors structurally and
pass values as separate arguments. Never evaluate the request or pass a joined
request to a shell. Read [the local selector contract](references/selector-contract.md)
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
  and never claims remote landing or hosted CI. `--cleanup=none` prohibits
  deletion; `--cleanup=resolved` is the default and remains source-specific
  and proof-gated. It never adds related work discovered during the audit.

## Workflow

1. Bind and refresh the exact repository, target ref/OID, and selected sources.
   Targeted requests inspect only those sources and strictly necessary lineage.
   Listing selectors are frozen only after every page is read. Read the local
   selector and recovery references for `--all-work`; freeze roots, exclusions,
   source membership, identities, active writers, and coverage gaps before any
   side effect. A gap prevents a completeness claim.

2. For explicit `--all-work`, discover matching independent clones, linked or
   detached worktrees, refs, PR evidence, dirty state, untracked and valuable
   ignored data, stashes, recoverable objects, nested repositories, and
   interrupted Git operations only within the declared roots. Keep originals
   read-only. Recover only a clearly attributable unfinished goal into a fresh
   target-based candidate after the local snapshot and disposable restore test
   passes. Never infer a goal from a branch name or dirty file.

3. Run the read-only comparison in [the local audit procedure](references/audit-procedure.md).
   Compare actual target behavior and valid goals, including partial or
   equivalent changes, successors, dependencies, reverts, and work already
   satisfied. Preserve stronger target behavior. A shared commit or patch ID is
   not proof that the target still has the behavior.

4. In normal mode, implement or adapt only justified changes against the exact
   target. A source PR is reusable only when its declared base is exactly the
   selected target and its full scope remains sound. Cross-target work uses a
   derived candidate whose base is exactly the selected target; never retarget
   or silently close the original PR. Keep source PRs and branches that serve
   another target or obligation.

5. For remote landing, require a fresh read-only review from
   `tailrocks-review-pr` and guarded landing from `tailrocks-merge-pr`; one
   active user request may select these manual-only owners with `repo-merge`,
   but a generic coordinator request cannot infer them. A review report grants
   no merge authority. If review, checks, the repository worklist, or an owner
   is unavailable, block only dependent remote landing and continue safe work.
   Cross-target PR creation additionally requires an explicit selection of
   `tailrocks-create-pr`.

   Use the exact owner entrypoints and request shape in
   [lifecycle composition](references/lifecycle-composition.md). Before any
   remote mutation, inspect the installed merge owner and require an atomic
   guard for the exact selected target branch name and OID during mutation,
   plus proof of the landed target OID. A preflight, final metadata read, or
   post-merge inspection cannot replace that guard. If the installed owner
   lacks the capability, report the owner/version and block remote landing;
   do not add guessed fields, invoke a second merge owner, retarget manually,
   or use direct `gh pr merge`.

   Re-fetch review, checks, source heads, target policy, and worklist after
   every relevant change. A queued, uncertain, or unverified merge is not
   landing. Verify the exact selected remote target and run bounded,
   target-relative acceptance after landing. A regression retains all sources
   and requires a new target-bound candidate and fresh applicable gates.

6. In `--local-only`, verify the exact local target ref/OID and report only
   local results. In normal mode, a prepared patch, opened PR, queued merge,
   local check, or preflight is not completion.

7. After each landing, re-audit the advanced target. In normal mode with
   effective cleanup `resolved` (the documented default or explicit selection),
   run this coordinator's local finalization using [cleanup eligibility](references/cleanup-eligibility.md)
   and [recovery guidance](references/recovery.md). It may remove only the
   original selected sources whose complete contribution is resolved on this
   exact target, obligations are satisfied, ownership and quiescence are
   proven, unique data has passed a disposable restore test, and identities
   are rechecked immediately before each action. Do not invoke the standalone
   manual-only cleanup skill or widen the source set. Audit-only and
   `--cleanup=none` never clean.

8. Before final status, every `--all-work` run repeats the same declared-root
   scan and target-relative audit after cleanup. Changed or newly discovered
   work re-enters analysis but does not gain cleanup authority. Unknown roots,
   pages, writers, identities, or unresolved goals make the result `partial`
   or `blocked`, never complete.

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
`~/.local/state/tailrocks/repo-merge/runs/<run-id>.md` when unset. If that path
falls inside a repository or candidate, stop before mutation. Record the
request and authority, repository, exact target/source identities, decisions,
actions, tests, review/check/landing state, cleanup, recovery location,
blockers, and one deterministic next action. For `--all-work`, record roots,
exclusions, frozen membership, pagination/API coverage, writers, and every
gap. Strip URL userinfo, query, and fragment; never record credentials,
secrets, raw remote output, or sensitive filenames.

`--resume RUN_ID` reads only that handoff, restores its scope and target, and
refreshes identities before continuing. Changed or ambiguous scope, target,
repository, policy, or unverified landing blocks dependent side effects; never
guess or widen. A completed run is report-only.

## Finish and report

Report `complete`, `partial`, or `blocked` with the bound repository, exact
destination, source membership, target result, and per-source disposition.
Distinguish verified remote landing, verified local-only landing, audit-only,
no-op, rejected, blocked, and recovery-required outcomes. Include applicable
review, CI, worklist, acceptance, cleanup, retention, and coverage results.
Claim completion only after target-relative acceptance and every required gate
for the requested mode are accounted for.

Codex example: `$tailrocks-repository-skills:repo-merge --target-branch=release/next feature/auth`.
Claude example: `/tailrocks-repository-skills:repo-merge --target-branch=release/next feature/auth`.
Do not advertise a universal bare `/repo-merge` command.
