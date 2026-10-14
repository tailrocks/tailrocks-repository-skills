# Cleanup selector and target contract

Treat the complete argument string as untrusted data. Parse structurally,
preserve literal `#`, quoting, slashes, URL encoding, and queries, and pass
values separately. Never use `eval`, shell interpolation, `sh -c`, or a joined
command string.

Bind exactly one repository before resolving ambiguous selectors. Accept
explicit `--repo OWNER/REPO` or `--repo=OWNER/REPO`, one canonical repository
from source URLs, or one unambiguous current checkout identity, in that order.
Reject conflicting or unresolved identity; a URL never authorizes writes to an
unrelated checkout. A fork PR is selected through its base and remains
read-only.

Accept branch names, `refs/heads/...`, qualified remote refs, `branch:NAME`,
`#N`, `pr:N`, bare positive PR numbers, GitHub PR URLs, `/pulls` listings, and
`/branches/all` listings. Bare numbers always mean PRs. Resolve URL forms
before ambiguous local names; report path, remote, full ref, and OID for
duplicates. Deduplicate canonical identities while retaining raw spellings.
Fetch every listing page, preserve supported filters, reject unsupported ones,
and freeze membership with observation time and page/cursor coverage. Empty
valid listing is empty selection, not all-work.

`--target-branch NAME` and `--target-branch=NAME` select the one destination;
omission means exact `main`. Record its fresh full ref and OID. Missing or
ambiguous target stops. Never substitute `HEAD`, `origin/HEAD`, a PR base,
hosting default, or prior target, and never create it. A non-main target leaves
main untouched. A source equal to target is a no-op and never a deletion
candidate.

Require a nonempty source set or explicit `--all-work`; empty input is a usage
error. `--all-work` cannot be mixed with selectors. Targeted cleanup never
widens to newly discovered work. Freeze repository, target, source membership,
roots, exclusions, and identities before any deletion.

Only `--all-work` authorizes broad local discovery. Use finite roots from the
bound checkout, the current user's canonical home, roots explicitly declared
by the request or workspace, client-advertised project/worktree roots,
configured Git/agent roots, and classified local data volumes. Do not invent
`/`, follow arbitrary symlinks, or crawl remote/pseudo filesystems. Inventory
Git directories, pointer files, bare/nested repositories,
linked/detached/relocated worktrees, refs/OIDs, worktree state, ignored and
untracked data, stashes, recoverable objects, in-progress operations,
submodules, LFS, alternates, shared object stores, locks, and visible writers.
Unknown roots, identities, pages, ownership, or writers block cleanup.
