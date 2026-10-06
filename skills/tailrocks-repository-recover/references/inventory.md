# Inventory checklist

Read this reference when step 5 inventories local state. All commands
below are read-only.

Contents: identity record; checklist; protection rules; classes.

## Identity record

For each Source, record: exact path, agent, session, repository
evidence, Git IDs, content hashes where needed, observation time, and
any active writer.

## Checklist

1. Identity and remotes: `git rev-parse --show-toplevel --git-dir
   --is-shallow-repository`; `git remote -v`; `git config
   --get-regexp 'remote|fetch|push|lfs|credential'`.
2. Branches and upstreams: `git branch -a -vv`; canonical list with
   `git for-each-ref`; `git show-ref --head -d`.
3. Tags: `git tag --list -n`; peeled refs with `git show-ref -d`.
4. HEAD state: `git symbolic-ref -q HEAD` (empty means detached); `git
   rev-parse HEAD`; `git status -sb`.
5. Staged and unstaged changes: `git status --porcelain=v1 -b`; `git
   diff --stat`; `git diff --cached --stat`.
6. Untracked and useful ignored files: `git ls-files --others
   --exclude-standard`; dry-run preview with `git clean -ndx`;
   ignored-but-useful with `git ls-files --others --ignored
   --exclude-standard`; per-path cause with `git check-ignore -v`.
   Include sparse-checkout exceptions.
7. Stash: `git stash list`; per-entry preview with `git stash show -u
   --name-status stash@{n}`.
8. Interrupted operations: test for `.git/MERGE_HEAD`,
   `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `REBASE_HEAD`, `MERGE_MSG`,
   `.git/rebase-merge/`, `.git/rebase-apply/`; confirm with `git
   status` and `git worktree list --porcelain`. Include conflict index
   stages.
9. Reflog-only and unreachable objects: `git reflog --date=iso --all`;
   `git fsck --unreachable --no-reflogs`; `git fsck --dangling`.
10. Nested copies and links: `git submodule status`; `.gitmodules`;
    nested `.git` dirs; `git worktree list --porcelain`;
    `.git/objects/info/alternates`.
11. LFS and external data: `git lfs ls-files`; `git lfs status`; `git
    lfs env`; transfer preview with `git lfs fetch --dry-run`.
12. Shallow state: `.git/shallow`;
    `git rev-parse --is-shallow-repository`.

## Protection rules

- Never expire reflogs or prune objects before recovery.
- Never pop stashes or abort interrupted operations to simplify the
  task.
- Never assume a clean status means that every useful byte is remote.
- Never combine distinct dirty copies because their branch names match.

## Classes

Assign one class to every Finding:

1. Useful unique Contribution.
2. Unique Source state that needs preservation but is not ready for
   integration.
3. Verified duplicate or already delivered work.
4. Proven reproducible output with no unique work.
5. Sensitive, unrelated, uncertain, or blocked data.

An obsolete implementation can still contain unique source work. A
usefulness verdict is never deletion permission.
