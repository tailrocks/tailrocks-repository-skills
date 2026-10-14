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

This mode alone authorizes broad local discovery; a targeted branch, PR, `/pulls`, or `/branches/all` request never triggers it. Discovery stays read-only and bound to one repository.

Before searching, build and freeze a finite root list from: the bound checkout; the current user's canonical home path; roots explicitly provided in the user's request or workspace context; workspace/project roots advertised by the active client and its configuration; configured Git and supported agent-worktree roots; and accessible local data-volume roots reported by the operating system. Canonicalize and deduplicate each root without following symlinks. Do not invent `/` or a parent directory as a fallback. An OS-reported volume root is eligible only after classifying it as local data and recording exact pseudo/system-managed exclusions; do not crawl remote or pseudo filesystems as local data roots. If volume enumeration is unavailable, a root cannot be classified or safely bounded, or any declared root is inaccessible, report that exact coverage gap; do not silently drop it or claim complete coverage. Search only within this frozen list, never above its roots or through arbitrary symlinks. Record each root, its discovery source, inclusion/exclusion decision, and exclusion reason in the single run handoff. User-data paths are not excluded merely because they look like caches; exclude only exact paths with a concrete reason.

Within each declared root, locate Git directories, `.git` pointer files, bare repositories, nested repositories, and paths recorded by Git metadata. For every candidate, use installed Git read-only queries (`rev-parse` for top-level/Git/common-dir identity, `worktree list --porcelain`, `for-each-ref`, and porcelain `status` including ignored and untracked paths) to resolve its canonical worktree root, refs, and state. Bind identity using sanitized remote identity—not directory names. Treat independent clones separately even when they share refs or object content. Enumerate linked, detached, and relocated worktrees from Git's worktree metadata; follow an entry only if its canonical path is inside a frozen declared root. An out-of-root, missing, inaccessible, or identity-ambiguous worktree is a coverage gap, not permission to add a root or guess. Classify unrelated repositories without reading their working files. Include forks only when linked to this repository by selected PR metadata; keep fork worktrees read-only. If a path cannot be inspected by Git, keep it in the inventory as unresolved instead of skipping it.

For each matching copy and worktree, inventory exact local/remote refs and OIDs, worktree-to-common-dir identity, detached HEAD, staged and unstaged changes, untracked paths, ignored paths that may hold user work/configuration/output, stashes, reflog-reachable or dangling recoverable objects, nested repositories, and interrupted Git operations. Treat ignored content as potentially valuable until its specific role and owner prove it disposable; ignore patterns alone are not deletion evidence. Check Git lock files and, where process visibility permits, whether a writer is operating in the path; also detect state that changes during observation. Never stop or signal a writer. If ownership/quiescence cannot be established, retain the source and block dependent recovery or cleanup. Keep sensitive file bytes and names out of handoffs; record redacted path counts/status and keep exact mappings only in a protected local snapshot.

Include PR-linked heads, original bases, successors, and merged or closed PRs only as relevant evidence for target-relative status. Check shallow/partial clones, missing objects, alternates, submodules, LFS, protected refs, and shared object storage. Query hosting APIs only for the bound repository and PR-linked metadata; do not crawl an organization or fork repositories. Fully paginate each relevant listing and report page counts/cursors, API permission scope, unavailable endpoints, rate limits, and incomplete pages. A partial API result is a coverage gap; do not infer that an omitted PR or ref does not exist.

Freeze the exact roots, exclusions, and initial discovered-copy/source membership in the one Markdown handoff before side effects. `--audit-only` reports inventory, unfinished-goal candidates, active writers, and gaps; it must not snapshot-copy user data, create recovery candidates/branches, alter refs, or clean anything. Normal mode may recover a valid unfinished goal only after the provenance and isolation tests in [recovery guidance](recovery.md) pass; every original clone, worktree, branch, and file stays unchanged. Before each destructive action, recheck the exact root membership, canonical path, identities, ownership, dependencies, and quiescence, and complete the unique-data snapshot/restore test. The final scan must revisit the same roots and compare membership. Report later additions separately; they do not join this run's cleanup authority. Unknown roots, permission failures, unavailable volumes, API failures, incomplete pages, unresolved repository identities, and active writers remain explicit gaps. Never claim full all-work coverage or a clean host while an in-scope root or relationship is unknown.
