---
name: repo-merge
description: >-
  Use only when the user explicitly requests repository convergence. Compose
  target-bound audit, convergence, existing pull-request lifecycle, and
  eligible cleanup. In default mode actually finish, review, pass CI, land,
  verify, and clean the selected sources. Use --audit-only for read-only
  analysis.
argument-hint: "[SOURCES] [--target-branch TARGET] [--audit-only] [--local-only] [--cleanup resolved|none] [--all-work] [--resume ID]"
disable-model-invocation: true
license: Apache-2.0
user-invocable: true
---

# repo-merge

This is the plugin facade. It owns request binding and orchestration; it does
not copy audit, review, merge, or cleanup policy from another skill.

Read the complete argument string. In Claude Code this is $ARGUMENTS. In
Codex, use the selected skill's complete argument string. Parse it with the
non-shell helper. Never ask a shell to interpret it. The # in #1145 is data.

## Contract

1. Positional inputs are SOURCES. --target-branch names the DESTINATION.
   Omitted --target-branch means the literal branch main.
2. Accept branch names, refs/heads/BRANCH, qualified refs, #PR, pr:PR, bare
   positive PR numbers, PR URLs, repository /pulls URLs, and repository
   /branches/all URLs.
3. Bind one repository. Paginate list results. Preserve raw provenance while
   deduplicating canonical selectors. Reject mixed-repository ambiguity.
4. Check the selected target exactly. Missing or ambiguous targets fail closed.
   Never use current HEAD, a PR base, origin/HEAD, or the repository default.
   Never create a target. Selecting release/next leaves main untouched.
5. No selectors means usage/error. --all-work explicitly selects the original
   host-wide clone/worktree/unfinished-work convergence workflow. It is not
   implied by an empty source list. --resume resumes one recorded scope and
   cannot mix with fresh selectors or --all-work.
6. --audit-only routes to tailrocks-repository-audit and forbids every
   mutation. --cleanup=none forbids deletion. --local-only explicitly permits
   branch-to-branch work on existing local target refs; it never claims remote
   landing or hosted CI. The default cleanup mode is resolved, but it still
   requires every cleanup gate.

## Execution

1. Parse and validate the request using scripts/run-helper.sh parse-request.
2. Resolve the repository and source selectors with the helper's
   \`resolve-selectors\` operation. It resolves local/qualified refs,
   retrieves exact PR metadata, paginates \`/pulls\` and \`/branches/all\`
   through the authenticated GitHub client, freezes the resolved membership,
   and records canonical IDs, provenance, list timestamp, and repository
   identity. If the client or API is unavailable, stop before mutation.
3. Check the exact destination with target-check. Create or resume external
   campaign state. Record target branch, ref, OID, scope, and cleanup mode.
4. Route the read-only inventory and target-relative comparison to
   tailrocks-repository-audit.
5. In default mode, route justified unfinished work to
   tailrocks-repository-converge. It must preserve stronger target behavior,
   recognize partial/squash/cherry-pick/successor/revert/dependency evidence,
   and preserve cross-target source PRs. A cross-target source gets a scoped
   adaptation PR into the requested target only when coherent; its original
   PR is not silently retargeted, closed, or deleted.
6. Require independent read-only review through tailrocks-review-pr,
   applicable CI and repository worklists, then actual landing through
   tailrocks-merge-pr. In --local-only mode, use the explicit local landing
   contract and verify the local target; never claim remote delivery or CI.
   The exact target branch and expected heads must be passed through. A report,
   prepared patch, opened PR, approval, green pending check, or queued merge
   is not completion.
7. Re-read and verify the combined batch after every target advance. Attach
   audit, review, CI, landing, verification, idempotency, and cleanup
   receipts with campaign-attach-receipt. Each must use
   \`tailrocks.campaign-receipt/v1\`, bind campaign/scope/source IDs,
   repository/path, exact target ref/OID, phase/status, operation ID, and a
   64-character content or artifact hash. Do not journal campaign-complete
   until target-observed and all required phase receipts exist.
8. Route eligible deletion to tailrocks-repository-cleanup only after restore
   testing unique local state and proving no other target or unresolved work
   needs the source. Do not turn selected-source work into global cleanup.
9. Journal every phase. On interruption, resume the same target-bound scope.
   A no-op rerun must still verify the exact destination and emit a no-op
   receipt.

## Hard stops

Stop with the exact blocker when target or repository identity is ambiguous,
the target is missing, a required owner or CI result is unavailable, a source
would be silently retargeted, a landing is uncertain, restore-test fails, or
cleanup identity/need cannot be proven. Never fall back or claim completion.

## Client invocation

Claude Code invokes this skill through the plugin namespace:

    /tailrocks-repository-skills:repo-merge --target-branch=release/next feature/auth

Codex CLI uses its supported skill-selection or mention interface:

    $repo-merge --target-branch=release/next feature/auth

The host /goal command records the objective and supports pause/resume; it is
not a plugin alias. This plugin does not advertise a universal /repo-merge
command.

## Final gate

Complete only when the selected exact destination contains the justified
changes, independent review and applicable CI are satisfied, landing is
confirmed, the destination is re-verified, and resolved cleanup has passed its
own gates. Return the target-bound receipts and genuine blockers.

Resolve relative links against this skill's directory. Shared references are
in ../shared/.
