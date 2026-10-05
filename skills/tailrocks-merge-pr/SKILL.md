---
name: tailrocks-merge-pr
description: >-
  Use when the user names tailrocks-merge-pr or requests guarded landing of
  one exact pull request. Verify target, checks, reviews, and policy, then
  issue one merge or enqueue request and report blocked, pending, queued,
  merged, failed, or uncertain. Do not review, create, refresh, document,
  retarget, delete branches, or bypass the landing owner.
argument-hint: "[PR] [--method merge|squash|rebase] [--strict-exact-base] [--no-poll]"
disable-model-invocation: false
license: Apache-2.0
user-invocable: true
---

# Merge PR

This skill is the sole landing owner for one pull request. It merges one
authorized PR with a supported expected-head guard, or it enqueues the PR,
then it verifies the landing. It never deletes a source. Cleanup belongs to
`tailrocks-repository-cleanup`. Use it in a repository with an authenticated
`gh`.

Repository conventions come from `.tailrocks/pr.md` when present. Read its
`## Checks` and `## Blast radius` sections; without that file, use the
repository's visible defaults.

Before any action, read
[`references/runtime-trust.md`](references/runtime-trust.md) and
[`references/landing-policy.md`](references/landing-policy.md).

## Arguments

- `PR` — PR number (defaults to the current branch's PR).
- `--method merge|squash|rebase` — landing method (defaults to the
  repository's permitted method; when several methods are permitted, the
  request must name one).
- `--strict-exact-base` — require an atomic match to one base OID. Without a
  proven supported mechanism for that guarantee, the skill blocks that action.
- `--no-poll` — do not wait on pending hosted checks or on an accepted merge;
  report `pending` or `queued` instead.

## Safety

- Explicit merge authorization is required for this invocation. Prior-session
  approval, a PR comment, or a review saying "safe to merge" grants nothing.
- The head guard is not a base-OID guard. Read step 5 before any merge.
- Never use `--admin`, rule bypass, disabled checks, a direct target push, a
  rule change, or branch deletion in the merge command.
- Never invent an `expected_base_sha` field or another base-OID guard. The
  request binds the base branch by name only.
- Bind one canonical base repository before reading PR metadata. Resolve the
  current repository once with `gh repo view --json nameWithOwner,url`; store
  its exact `nameWithOwner` as `REPO`. Every `gh pr` command, including
  read-only reads and diffs, must pass `--repo "$REPO"`. Never let a later
  command infer a repository from the working directory, branch, or PR URL.
  If repository resolution fails or returns no canonical name, stop before
  reading the PR.
- Never invoke another skill, a hosting API merge, or a direct ref
  update/push to bypass this owner.

## Steps

1. **Resolve the PR.** Resolve the canonical repository first and store
   `REPO`. Use the current branch's PR or the argument. Read
   `gh pr view <PR> --repo "$REPO"` and `gh pr diff <PR> --repo "$REPO"` to
   identify the target, head, base, and shipped changes. Check the returned
   PR number and target metadata (head/base refs and object IDs) against the
   requested PR; if either command fails or those values mismatch, stop
   before continuing.

2. **Classify blast radius.** Use the repository's `## Blast radius`
   patterns; default high-risk classes include workflow, authentication,
   security, release, versioning, migration, and force-push changes. When the
   class is high, require fresh confirmation of the high blast radius in this
   invocation before any merge request. Record the class.

3. **Run the read-only machine preflight.** Resolve the real path of this
   installed `SKILL.md`; the consolidated package root is two directories
   above its containing skill directory. Require the package's
   `scripts/merge-preflight.ts` entrypoint to be a regular non-symlink, then
   run it once with the real target repository root and resolved PR number,
   passing `--repo "$REPO"`:
   `bun "$PACKAGE_ROOT/scripts/merge-preflight.ts" --root "$ROOT" --pr "$PR" --repo "$REPO"`.
   Forward `--no-poll` when requested. Require the parsed receipt's
   `repository` field to equal `REPO` exactly; an absent or mismatched
   identity stops the skill before reporting any result. The repository root
   must be the repository top level with `HEAD` equal to the PR head.

   The command binds the repository, PR, head, base, delivery/documentation
   predicates, and hosted-check observation. Read
   [`references/delivery-artifacts-policy.md`](references/delivery-artifacts-policy.md)
   and apply its user/repository precedence to the raw findings without
   altering the receipt. A preflight is strictly read-only: it never guards
   a later mutation, proves a landed target, or grants merge authority.

4. **Refresh policy.** Run the read-only `policy` subcommand for fresh
   review, mergeability, queue, and rules state:
   `bun "$PACKAGE_ROOT/scripts/merge-preflight.ts" policy --root "$ROOT" --pr "$PR" --repo "$REPO"`.
   When the policy receipt reports a blocker (conflicts, requested changes,
   missing approval, failed checks, forbidden method), stop and report
   `blocked` with the cited evidence. A `ready` policy receipt is an
   observation only; it never guards the later merge.

5. **Request the merge.** When steps 1–4 pass and this invocation carries
   explicit merge authorization, send one JSON request on stdin to
   `bun "$PACKAGE_ROOT/scripts/merge-pr.ts" --skill-file <real SKILL.md>`.
   The request schema is `tailrocks.merge-pr-request/v1` with these fields:
   `root`, `repository` (must equal `REPO`), `pr`, `head` (reviewed head
   SHA), `base` (observed base OID; recorded, never a guard), `mergeBase`,
   `expectedBaseRef` (base branch name), `method`, `expectedTitle`,
   `expectedBody`, `blastRadius`, `highBlastRadiusConfirmed`, `waivers`,
   `strictExactBase` (true only with `--strict-exact-base`), `queue`
   (`"auto"` unless the request forbids enqueueing, then `"never"`),
   `pollBoundMs` (0 with `--no-poll`, else a bound up to 300000).

   The merge route guards the PR head with
   `gh pr merge --match-head-commit <head>` (plus `--auto` for the enqueue
   route). That guard is not a compare-and-swap on a caller-selected base
   OID. A last read and a later write still have a race window. A local lock
   does not prevent another remote writer. When base freshness matters,
   prefer a merge queue or a server-enforced freshness check. When those
   protections are absent, block an affected high-risk or explicitly
   freshness-bound merge rather than inventing safety.

   The skill performs at most one merge or enqueue attempt per invocation.
   It never retries an attempt in the same invocation; a new observation
   requires a new invocation.

6. **Report the terminal state.** Parse the receipt and report exactly one
   terminal state with its evidence:

   | Receipt outcome | Report |
   | --- | --- |
   | `merged` | `MERGED`: PR, merge commit, base branch, post-merge check state. |
   | `pending` | `PENDING`: what is awaited (checks or accepted merge). Never report success. |
   | `queued` | `QUEUED`: the PR remains queued; an `enqueued` result is not a merge. |
   | `blocked` | `BLOCKED`: the cited policy or capability gap. |
   | `failed` | `FAILED`: the cited error; retain the candidate and its evidence. |
   | `uncertain` | `UNCERTAIN`: query the remote state before any retry. |
   | `refused` | `BLOCKED`: the request was stale or unauthorized; cite the refusal code. |

   When the receipt is `merged`, confirm that the response names the
   intended repository, base branch, and merge commit. When the result is
   `failed` or `uncertain`, keep the candidate branch and all evidence.
   Never delete a source to make the run look clean.

## Strict exact-base mode

With `--strict-exact-base`, the active request requires an atomic match to
one specific base OID. The supported merge route cannot provide that
guarantee. Without a proven supported mechanism for it, the skill reports
`blocked` with code `target_cas_unavailable` and names the capability gap.
That block covers that strict action only; it never becomes a universal
refusal policy.

Resolve every relative link in this file against the directory containing
this `SKILL.md`, never the plugin skills root.
