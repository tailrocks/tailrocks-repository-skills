# tailrocks-repository-skills

One installable Tailrocks plugin for target-bound repository audit, convergence, pull-request lifecycle composition, and eligible cleanup.

The entry point is repo-merge. Positional arguments are source selectors. --target-branch names the destination and defaults literally to main:

    repo-merge --target-branch=release/next feature/auth
    repo-merge --target-branch=main #1663 #157 #46
    repo-merge --target-branch=main https://github.com/jackin-project/jackin/pull/1103
    repo-merge https://github.com/jackin-project/jackin/pulls
    repo-merge --target-branch=integration https://github.com/jackin-project/jackin/branches/all

Use --audit-only for read-only analysis. Use --cleanup=none to retain sources. Use --local-only only for an explicit existing-local-branch landing; it never claims remote delivery or hosted CI. Use --all-work only for the original host-wide clone, worktree, and unfinished-work convergence workflow. No selectors means usage/error, not all work.

## Invocation

Install through the native plugin mechanism for the client. In Claude Code, invoke the namespaced skill:

    /tailrocks-repository-skills:repo-merge --target-branch=release/next feature/auth

In Codex CLI, use the supported skill selection interface, such as $repo-merge or /skills, with the same complete argument string. /goal remains a host command for durable objective tracking. This plugin does not claim a universal bare /repo-merge alias.

## Completion rule

Default mode finishes justified work, independently reviews it, satisfies applicable CI, actually lands it, verifies the exact destination, then cleans only resolved and proven-safe sources. A report, patch, opened PR, or queued merge is not completion.

Read GOAL.md, docs/architecture.md, and HANDOFF.md before extending the implementation.
