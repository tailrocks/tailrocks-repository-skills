# Selector, repository, and target contract

Treat the complete argument string as untrusted data. Parse structurally and
pass selector values as separate arguments. Never use `eval`, shell
interpolation, `sh -c`, or a joined command string. Preserve literal `#N`,
quoting, branch slashes, URL encoding, and query strings.

## Repository binding

Bind exactly one repository before resolving ambiguous bare selectors:

1. Use explicit `--repo` when supplied.
2. Otherwise use the single canonical repository named by source URLs.
3. Otherwise use the unambiguous current checkout identity.

Validate every URL and local ref against that repository. Conflicting URLs, a
mismatched explicit repository, or unresolved identity stops before mutation.
A URL may select another repository, but never authorizes writes to an
unrelated checkout. A fork PR is selected through its base repository; the
fork remains read-only.

## Source selectors

Accept a mixed list in one bound repository:

- branch names, `refs/heads/BRANCH`, or explicitly qualified remote refs such
  as `origin/BRANCH`;
- `branch:NAME` for a numeric branch;
- `#NUMBER`, `pr:NUMBER`, or bare positive decimal PR numbers, where a bare
  number always means a PR;
- GitHub PR URLs, `/OWNER/REPOSITORY/pulls` listing URLs, and
  `/OWNER/REPOSITORY/branches/all` listing URLs.

Resolve listing URLs with supported APIs or Git. Fetch every result page,
preserve supported semantic filters, and reject unsupported filters instead of
widening scope. A `/pulls` listing without an explicit state/scope selects open
PRs, including drafts. Supported `state=closed` selects closed PRs (including
merged ones), and `state=all` selects open and closed PRs; `state=merged` is
unsupported and must be rejected. Page and sort controls are presentation
only. Record the observation time and freeze full membership for the
invocation. A valid empty listing is an empty selection, not all-work. Report
later additions separately.

Resolve URL forms before ambiguous local branch names. For duplicate names,
show exact clone path, remote identity, full ref, and OID; never pick the first
match. Deduplicate only by canonical identity while retaining every raw
selector spelling. A branch identity includes repository, exact ref, and OID;
a PR identity includes base repository and PR number; a PR head name alone is
never identity.

## Destination and scope

`--target-branch` is the one destination. If omitted, select exactly
`refs/heads/main` or the exact branch ref on an explicitly selected remote.
Record its freshly observed OID. A missing or ambiguous target is an error;
never substitute current `HEAD`, `origin/HEAD`, a PR base, a hosting default,
or a prior target, and never create it. A source equal to the target is a
verified no-op and never a cleanup candidate. A non-main target never permits
hidden `main` mutation.

At least one source selector or `--all-work` is required unless a valid existing
`--resume RUN_ID` is supplied. Resume restores only the frozen prior scope and
target; it cannot be combined with `--all-work`, new source selectors, or a
`--target-branch` override. Without resume, empty input is a usage error and
never means all work. `--all-work` is the explicit whole-repository scope and
cannot be mixed with source selectors. A targeted request may read strictly
necessary lineage and dependencies, but unrelated work remains report-only.

## All-work discovery and coverage

Only `--all-work` authorizes broad local discovery. Build and freeze a finite
authorized root list from the bound checkout plus roots explicitly declared by
the active request, workspace, client project/worktree configuration, or
authorized Git/agent configuration. Do not infer a home directory, crawl OS
volume roots, invent `/` or a parent fallback, follow arbitrary symlinks, or
crawl remote/pseudo filesystems. An inaccessible, unclassifiable, or
undeclared candidate root is a coverage gap; report it rather than adding it.

Within frozen roots, locate Git directories, pointer files, bare repositories,
nested repositories, and Git-recorded worktrees. Resolve each candidate with
read-only Git queries, bind identity by sanitized remote identity rather than
directory name, and keep unrelated repositories outside scope. Include linked,
detached, and relocated worktrees only when their canonical paths are inside
the frozen roots; out-of-root or inaccessible entries remain gaps.

Inventory exact refs/OIDs, common-directory identity, detached HEAD, staged and
unstaged state, untracked and potentially valuable ignored paths, stashes,
recoverable objects, nested repositories, interrupted operations, shallow or
partial state, alternates, submodules, LFS, protected refs, and shared object
storage. Check locks and visible writers without stopping or signaling them.
Changing state, uncertain ownership, or unavailable process visibility blocks
dependent recovery and cleanup.

Query only the bound repository and PR-linked metadata. Report page counts,
cursors, permissions, unavailable endpoints, rate limits, and every API or
root gap. Freeze initial roots, exclusions, and membership in the one handoff
before side effects; final scans revisit the same roots and compare
membership. `--audit-only` reports gaps and candidates but never snapshots,
creates recovery branches, alters refs, or cleans. New discoveries do not gain
cleanup authority for the current run.
