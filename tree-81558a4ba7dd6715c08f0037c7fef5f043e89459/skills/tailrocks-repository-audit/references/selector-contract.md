# Read-only selector and target contract

Treat the complete argument string as untrusted data. Parse it structurally,
preserve literal `#`, quoting, slashes, URL encoding, and queries, and pass
each value as a separate argument. Never use `eval`, shell interpolation,
`sh -c`, or a joined command string.

## Repository and source binding

Bind exactly one repository before resolving ambiguous selectors:

1. Use explicit `--repo OWNER/REPO` or `--repo=OWNER/REPO` when supplied.
2. Otherwise use the one canonical repository named by source URLs.
3. Otherwise use the unambiguous current checkout identity.

Reject conflicting URLs, a mismatched explicit repository, and unresolved
identity. A URL can select another repository, but never authorizes writes to
an unrelated checkout. A fork PR is selected through its base repository and
the fork remains read-only.

Accept branch names, `refs/heads/...`, qualified remote refs, `branch:NAME`,
`#N`, `pr:N`, bare positive PR numbers, GitHub PR URLs, `/pulls` listing URLs,
and `/branches/all` listing URLs. Bare numbers always mean PRs; use
`branch:NAME` for numeric branches. Resolve URLs before ambiguous local names.
For duplicate names report canonical path, remote identity, full ref, and OID;
never pick the first match. Deduplicate by canonical identity while retaining
every raw spelling. A branch identity includes repository, full ref, and OID;
a PR identity includes base repository and number.

For listings, preserve supported semantic filters, reject unsupported filters,
fetch every page, and record observation time, page/cursor coverage, and the
frozen membership. An empty valid listing is empty selection, not all-work.
Later additions are reported separately.

## Target and scope

`--target-branch NAME` and `--target-branch=NAME` select the one destination.
Without it, select exactly `refs/heads/main` or the exact branch ref on an
explicitly selected remote. Record the freshly observed OID. A missing or
ambiguous target is an error; never substitute `HEAD`, `origin/HEAD`, a PR
base, a hosting default, or a previous target, and never create it. A source
equal to the target is a verified no-op. A non-main target never permits main
mutation.

Require at least one source or explicit `--all-work`; empty input is a usage
error. `--all-work` cannot be mixed with source selectors. A targeted audit may
read only strictly necessary lineage and dependencies; unrelated work stays
report-only.

## All-work coverage

Only `--all-work` authorizes broad local discovery. Build and freeze a finite
root list from the bound checkout, the current user's canonical home, roots
explicitly declared by the request or workspace, client-advertised
project/worktree roots, configured Git/agent roots, and OS-reported local data
volumes after classifying exact exclusions. Do not invent `/` or a parent
fallback, follow arbitrary symlinks, or crawl remote/pseudo filesystems. An
inaccessible or unclassifiable declared root is a coverage gap.

Within frozen roots, locate Git directories, pointer files, bare repositories,
nested repositories, and Git-recorded worktrees. Resolve each with read-only
Git queries and bind by sanitized remote identity, not directory name. Include
linked, detached, and relocated worktrees only when their canonical paths are
inside frozen roots; out-of-root or inaccessible entries remain gaps.

Inventory exact refs/OIDs, common-directory identity, detached HEAD, staged and
unstaged state, untracked and valuable ignored paths, stashes, recoverable
objects, interrupted operations, shallow/partial state, alternates, submodules,
LFS, protected refs, and shared object storage. Check locks and visible writers
without stopping or signalling them. Changing state, uncertain ownership, or
unavailable process visibility is an explicit gap.

Query only the bound repository and PR-linked metadata. Report unavailable
endpoints, permissions, rate limits, incomplete pages, and every root or
identity gap. Freeze roots, exclusions, and membership in the handoff before
any later work; final scans revisit the same roots. The audit never snapshots,
creates recovery branches, changes refs, or cleans.
