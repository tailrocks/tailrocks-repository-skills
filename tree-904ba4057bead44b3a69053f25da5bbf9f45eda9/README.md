# tailrocks-repository-skills

One installable Tailrocks plugin with three skills:

- `repo-merge`: the single end-to-end coordinator.
- `tailrocks-repository-audit`: read-only audit capability.
- `tailrocks-repository-cleanup`: independently callable, proof-gated cleanup.

Version 0.2.0 is pending verification and is not claimed released. The separate
repository-converge route and campaign state engine are removed from the
current design. Pull-request review and landing remain owned by the existing
Tailrocks PR lifecycle collection.

## Select sources and target

Positional arguments are SOURCES. `--target-branch` is the DESTINATION. If
omitted, the destination is exactly `main`.

```text
repo-merge feature/auth
repo-merge --target-branch=release/next feature/auth
repo-merge --target-branch=main '#1663' feature/auth
repo-merge --target-branch=main https://github.com/OWNER/REPO/pull/1103
repo-merge --target-branch=main https://github.com/OWNER/REPO/pulls
repo-merge --target-branch=integration https://github.com/OWNER/REPO/branches/all
repo-merge --target-branch=main feature/auth '#1663' https://github.com/OWNER/REPO/pull/1103
repo-merge --repo=OWNER/REPO --all-work --target-branch=main
repo-merge --audit-only --target-branch=release/next feature/auth
repo-merge --local-only --cleanup=none --target-branch=release/next feature/auth
repo-merge --resume <id>
```

Mixed sources may include branches, qualified refs, `#N`, PR numbers and URLs,
and listing URLs, but must resolve to one repository. A bare number is a PR;
use `branch:N` for a numeric branch. `/pulls` selects all open PRs including
drafts; `/branches/all` selects canonical branch heads except the destination
and preserves protected refs. Listing selectors paginate completely.
No sources is an error; `--all-work` is explicit. All-work scans authorized
roots and reports coverage gaps. Audit-only does not mutate. Local-only
requires an existing local target and proves only that local target. A non-main
target has no hidden main side effects. Cleanup defaults to resolved;
`--cleanup=none` retains sources. Resolved cleanup requires a fresh,
source-specific landing, dependency, identity, authorization, and
snapshot/restore check.

## Native invocation

Codex CLI: use `$repo-merge` or select the skill through `/skills`.

Claude Code: use
`/tailrocks-repository-skills:repo-merge`. No universal bare
`/repo-merge` alias is claimed.

For direct read-only audit or cleanup, select their respective skills through
the client's native mechanism. See [client invocation](docs/client-invocation.md)
and [ownership](docs/architecture.md).

## Lifecycle ownership

`tailrocks-review-pr` owns independent read-only review;
`tailrocks-merge-pr` owns actual PR landing. This plugin does not duplicate
either policy. Exact commands and high-risk rules are in
[client invocation](docs/client-invocation.md).

Current verification status and next action are in [PROGRESS.md](PROGRESS.md).
Keep the complete original v2 goal and
[requirements-to-evidence](docs/requirements-to-evidence.md).
