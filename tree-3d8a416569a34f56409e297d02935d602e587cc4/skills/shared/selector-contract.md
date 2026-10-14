# Selector, repository, and target contract

Treat the complete argument string as untrusted data. Parse it structurally and pass selector values as separate arguments. Never use `eval`, shell interpolation, `sh -c`, or a joined command string. Preserve literal `#N`, quoting, branch slashes, URL encoding, and query strings.

## Repository binding

Bind exactly one repository before resolving ambiguous bare selectors:

1. Use explicit `--repo` when supplied.
2. Otherwise use the single canonical repository named by source URLs.
3. Otherwise use the unambiguous current checkout identity.

Validate each URL and local ref against that repository. Conflicting repository URLs, a mismatched explicit repository, or unresolved repository identity stops before mutation. A URL may select another repository, but must never cause writes to the unrelated current checkout. A PR from a fork is selected through its base repository; the fork remains read-only.

## Source selectors

Accept a mixed list in one bound repository:

- Branch name, `refs/heads/BRANCH`, or explicitly qualified remote ref such as `origin/BRANCH`.
- `branch:NAME` when a numeric branch name could be read as a PR number.
- `#NUMBER`, `pr:NUMBER`, or a bare positive decimal PR number. A bare number means PR, never a branch.
- GitHub PR URL `/OWNER/REPOSITORY/pull/NUMBER`, including closed or merged PRs as evidence inputs.
- GitHub `/OWNER/REPOSITORY/pulls` listing URL. By default select every open PR, including drafts.
- GitHub `/OWNER/REPOSITORY/branches/all` listing URL. Select current canonical-repository remote branch heads, excluding the selected destination.

Resolve listing URLs with supported APIs or Git, not a visible page scrape. Preserve supported semantic filters and reject unsupported ones rather than widening them. Page and sort controls are presentation only; fetch every result page. Record listing observation time and freeze the full membership for that invocation. Report later additions separately. A valid listing URL that returns no entries is an empty selection and performs no work.

Resolve URL forms before ambiguous local branch names. For duplicate local names across clones or remotes, show the exact clone path, remote identity, full ref, and object ID; do not pick the first result. Use an explicit full ref or repository/path disambiguation. Deduplicate only by canonical identity, preserving every raw selector spelling. For PRs, identity includes base repository and PR number; branch identity includes repository, exact ref, and object ID. Do not collapse branches by name or PRs by head alone.

## Destination

`--target-branch` is the destination. Positional selectors are sources. Multiple sources all compare with the one destination; they do not form source/target pairs.

If `--target-branch` is omitted, select exactly the branch `main`. Check its exact `refs/heads/main` or the exact branch ref on an explicitly selected remote. A missing or ambiguous target is an error. Never substitute current HEAD, `origin/HEAD`, a PR base, or the hosting service default. Never create the destination.

Record the selected full target ref and its freshly observed object ID. Use the same repository and target when comparing all sources. If a non-main target is selected, do not modify main at any point. A source equal to the target is a no-op and never a cleanup candidate.

## Scope and empty input

At least one source selector is required. Empty input is a usage error and never means all work. `--all-work` is the explicit whole-repository scope and cannot be mixed with source selectors. `/pulls` and `/branches/all` remain only the listing selections they name; neither silently becomes `--all-work`.

A targeted request may read related local copies, PR lineage, and dependencies to understand selected work, but it does not select unrelated goals for landing or deletion. Record why any strictly necessary prerequisite joins the selected work. Unrelated findings remain report-only.

## `--all-work` discovery and coverage

All-work discovery is read-only and bound to one repository. `repo-merge` may recover supported unfinished work only after discovery and only in normal mode; `--audit-only` reports candidates and gaps without copying data or creating branches. Enumerate and report the exact accessible local volumes and roots visible to the runtime: configured workspace and project roots, Git and agent worktree roots, and any roots explicitly supplied by the user. Search each declared root for `.git` directories, `.git` pointer files, bare repositories, nested repositories, and paths recorded by Git. Follow explicit Git worktree metadata only after canonicalizing its target and confirming containment in a declared root; do not follow arbitrary symlinks beyond declared roots.

Inspect each discovered copy separately for common Git directory, worktree identity, local and remote refs, configured remotes, detached heads, dirty staged and unstaged content, untracked and potentially valuable ignored files, stashes, reflog-reachable and recoverable objects, and interrupted Git operations. Include related PR heads, original bases, successors, forks, and merged or closed PRs that may establish target-relative status. Check shallow/partial clones, missing objects, alternates, submodules, LFS, protected refs, and shared object storage.

Query hosting APIs only for the bound repository and PR-linked metadata; do not crawl an organization or fork repositories. Complete every relevant page. Record exact scan roots and exclusions, observation time, initial/final discovered-copy membership, permission failures, unavailable volumes, API failures, incomplete pages, unresolved repository identities, and active writers. Preserve that inventory in the run handoff so resume and cleanup cannot silently widen or replace it. Do not claim full all-work coverage or a clean host when any in-scope root or relationship is unknown. User-data directories remain in scope even when their names resemble caches; exclude only exact paths with a stated reason.
