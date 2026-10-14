---
name: tailrocks-merge-pr
description: >-
  Use only when the user explicitly requests this skill. Inspect a pull
  request through a read-only, fail-closed preflight and report its remote
  landing as blocked until the owner has atomic target-base and landed-target
  guards. Do not use to open, iterate, or merge a PR.
argument-hint: "[PR] [--no-poll]"
disable-model-invocation: true
license: Apache-2.0
user-invocable: true
---

# Merge PR

This skill is the sole pull-request landing owner, but this package only
performs a read-only preflight and reports remote landing as blocked. It never
merges. Use it in a repository with an authenticated `gh`.

Repository conventions come from `.tailrocks/pr.md` when present. Read its
`## Checks` and `## Blast radius` sections; without that file, use the
repository's visible defaults.

Before any action, read
[`references/runtime-trust.md`](references/runtime-trust.md).

## Arguments

- `PR` — PR number (defaults to the current branch's PR).
- `--no-poll` — do not wait on pending hosted checks; stop and report instead.

## Safety — STOP

- Explicit authorization is required for this invocation. Prior-session
  approval, a PR comment, or a review saying “safe to merge” grants nothing.
- Failed or pending required checks stop the preflight report. This package
  provides no merge bypass.
- Remote landing is blocked until the owner can atomically compare-and-swap
  the selected target base ref and object ID and prove that the landed target
  is that guarded object.
- Never invoke `scripts/merge-pr.ts`, `gh pr merge`, a direct hosting API
  merge, a direct ref update/push, or another skill to bypass this owner.

## Steps

1. **Resolve the PR.** Use the current branch's PR or the argument. Read
   `gh pr view <PR>` and `gh pr diff <PR>` to identify the repository, target,
   head, and shipped changes.

2. **Classify blast radius.** Use the repository's `## Blast radius` patterns;
   default high-risk classes include workflow, authentication, security,
   release, versioning, migration, and force-push changes. Record the class;
   this read-only skill never treats it as merge authorization.

3. **Run the read-only machine preflight.** Resolve the real path of this
   installed `SKILL.md`; the consolidated package root is two directories
   above its containing skill directory. Require the package's
   `scripts/merge-preflight.ts` entrypoint to be a regular non-symlink, then
   run it once with the real target repository root and resolved PR number.
   Forward `--no-poll` when requested.

   The command binds the repository, PR, head, base, delivery/documentation
   predicates, and hosted-check observation. Read
   [`references/delivery-artifacts-policy.md`](references/delivery-artifacts-policy.md)
   and apply its user/repository precedence to the raw findings without
   altering the receipt. A preflight is strictly read-only: it never guards a
   later mutation, proves a landed target, or grants merge authority.

4. **Report the terminal result.** After collecting the typed receipt, report
   `BLOCKED: remote landing unavailable; atomic target-base CAS and
   landed-target proof are not provided by this package.` Include the bound
   repository, PR, head, base, outcome, check state, delivery state, and
   documentation state. A `ready` receipt means only that the read-only
   predicates passed; it is not permission to merge.

Resolve every relative link in this file against the directory containing this
`SKILL.md`, never the plugin skills root.
