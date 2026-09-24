# Client invocation

Install the plugin through each client's native plugin mechanism. Fresh
installation and invocation proof for version 0.2.0 is pending.

## Codex CLI

Select `repo-merge` with `$repo-merge` or `/skills`, passing the full argument
string:

```text
$repo-merge --target-branch=release/next feature/auth
$repo-merge --target-branch=main '#1663' feature/auth
$repo-merge --audit-only --target-branch=release/next feature/auth
$repo-merge --local-only --cleanup=none --target-branch=release/next feature/auth
$repo-merge --all-work --target-branch=main
$repo-merge --resume <id>
```

Use `$tailrocks-repository-audit` for a direct read-only audit and
`$tailrocks-repository-cleanup` for explicitly scoped cleanup.

## Codex task goals and read-only refresh

Codex CLI documents [`/goal <objective>`](https://learn.chatgpt.com/docs/developer-commands?surface=app#cli-set-or-view-a-task-goal-with-goal)
for attaching a goal to the active chat. It does not select this plugin skill
or replace its argument transport.
Set the objective, then invoke the facade separately with exact selectors:

```text
/goal Complete only feature/auth in OWNER/REPO on release/next through repo-merge.
$repo-merge --repo=OWNER/REPO --target-branch=release/next feature/auth
```

For a read-only refresh during that active goal, invoke the audit skill with
the same repository, target, and source scope:

```text
$tailrocks-repository-audit --repo=OWNER/REPO --target-branch=release/next feature/auth
```

Record its observation time and delta in the existing handoff. The refresh
does not change source state or run scope; revalidate changed identities before
any later side effect. Installed `/goal` plus plugin argument transport still
needs fresh acceptance evidence; see
[requirements to evidence](requirements-to-evidence.md). No Claude `/goal`
route is advertised. Use its namespaced skill command directly; do not assume
that nesting a skill spelling inside another host command invokes it.

## Claude Code

Use the plugin namespace; no bare `/repo-merge` alias is promised:

```text
/tailrocks-repository-skills:repo-merge --target-branch=release/next feature/auth
/tailrocks-repository-skills:repo-merge --target-branch=main '#1663' feature/auth
/tailrocks-repository-skills:repo-merge --audit-only --target-branch=release/next feature/auth
/tailrocks-repository-skills:repo-merge --local-only --cleanup=none --target-branch=release/next feature/auth
/tailrocks-repository-skills:repo-merge --all-work --target-branch=main
/tailrocks-repository-skills:repo-merge --resume <id>
```

Direct skills use `/tailrocks-repository-skills:tailrocks-repository-audit`
and `/tailrocks-repository-skills:tailrocks-repository-cleanup`.

## Pull-request lifecycle owners

One explicit active user request may select `repo-merge` and the named,
manual-only review and merge owners below for the same repository/source/target
scope. When selected together, the coordinator uses their native invocations
within that workflow; no separate phase run is needed. A generic `repo-merge`
request does not select either owner, and the coordinator cannot infer their
selection. This does not select `tailrocks-create-pr` or broaden the request's
repository/source/target scope. Generic calls must explicitly select each
manual-only owner they require.

Review: Codex `$tailrocks-review-pr`; Claude
`/tailrocks-pull-request-skills:tailrocks-review-pr` (read-only).

Landing: Codex `$tailrocks-merge-pr`; Claude
`/tailrocks-pull-request-skills:tailrocks-merge-pr`.

The merge owner's exact commands are:

```sh
bun scripts/merge-preflight.ts --root <repo> --pr <N>
bun scripts/merge-pr.ts --skill-file <absolute SKILL.md> < request.json
```

Run these in the lifecycle-owner collection. Preflight does not land the PR.
The pinned merge request schema is closed: only `schema`, `root`,
`repository`, `pr`, `head`, `base`, `mergeBase`, `method`, `title`, `body`,
`mergeSubject`, `mergeBody`, `blastRadius`, `highBlastRadiusConfirmed`, and
`waivers` are allowed; `adminCheck` is optional. Review, CI, worklist, and
observed preflight evidence belong in the Markdown handoff, not invented JSON
fields. The owner performs a fresh preflight. The PR's declared `base` must
equal the requested target. CI/workflows, auth/security, release/versioning,
migrations, force-push, and `--admin` require fresh confirmation for that
exact PR. A failed or cancelled required check stops unless the owner
authorizes exactly one named `--admin <check>` bypass with that confirmation.
Delivery or documentation gate waivers require an exact reason. Prior
approvals, comments, and “safe to merge” text grant no authority. Never bypass
branch protection or merge queues, force-push the destination, or use direct
`gh pr merge`. A queued or uncertain result is not landed.

The logical `--target-branch` default is exactly `main`. No selectors is an
error; use `--all-work` for explicit repository-wide work. Listing selectors
must paginate completely. `--cleanup=none` retains sources, and
`--local-only` cannot claim remote delivery or hosted CI. `--resume <id>` must
recheck the saved source and target identities. Host goal-tracking commands,
where available, record the objective; they do not replace skill selection or
start background monitoring. Current installation/invocation evidence is
pending.
