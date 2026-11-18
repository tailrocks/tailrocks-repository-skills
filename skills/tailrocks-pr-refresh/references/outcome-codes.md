# Outcome codes

Each run prints one state and one code. The states are `DONE` (code `ok`),
`BLOCKED`, and `USAGE` (code `usage`). The first line of the output holds the
state, the code, and the headline. The next lines are indented detail lines. The
last one can be `next:`.

If a code is not in this file, report the first line, the detail lines, and
`next` as printed. Never guess what a code means.

## Exit codes

| Exit code | State | Meaning |
| --- | --- | --- |
| 0 | `DONE`, or `--help` | The mode finished. A `next:` line can still ask for a review. |
| 20 | `BLOCKED` | Blocked or refused. Nothing was pushed unless the report says so. |
| 2 | `USAGE` | A command-line error, an invalid policy, or a Bun version that is too old. |
| 1 or any other code | none | The script crashed. Report its output as printed. Do not retry. Do not run the step by hand. |

## Blocked codes

| Code | Mode | Meaning | Next action |
| --- | --- | --- | --- |
| `pr_not_open` | all | The PR is closed or merged. | None. Report the state. |
| `cross_repository` | sync, continue, dco-fix | The PR head is in a fork. | Ask the PR author to update the branch. |
| `protected_branch` | sync, continue, dco-fix | The head branch is the default branch or matches `branches.protected`. | None. The script never pushes there. |
| `not_owner` | sync, continue, dco-fix | The PR author is not the gh user and not in `dco.bot_authors`. | Ask the author, or run as the author. |
| `queued` | sync, continue, dco-fix | The PR is in the merge queue. A push removes it. | Dequeue first, then run again. For `dco-fix`, the policy `dco.dequeue_for_fix` lets the script dequeue. |
| `head_moved` | sync, continue, dco-fix | The PR head changed during the run. Nothing was written. For `continue`, the kept merge is out of date and was removed. | For `sync` and `dco-fix`, run the mode again. For `continue`, run `sync --keep-worktree` again. |
| `remote_moved` | dco-fix | The remote branch moved. Nothing was pushed. | Run the mode again. |
| `push_rejected` | sync, continue, dco-fix | The remote refused the push, because it moved. | Run the mode again. |
| `fetch_failed` | sync, dco-fix | The script could not fetch from the remote. | Check the remote and the network, then run again. |
| `base_missing` | sync, dco-fix | The base commit is not in the local clone after the fetch. | Run `tailrocks-pr-status`, then try again. |
| `merge_failed` | sync | The merge of the base failed without a content conflict. | Report the detail line. |
| `conflict` | sync, continue | The merge conflicts in files that the policy cannot regenerate. | Run `sync` again with `--keep-worktree`, resolve in the kept worktree, then run `continue`. If both sides cannot be kept, or you cannot tell, run `abort` and report to the user. |
| `conflict_markers` | continue | A resolved file still holds conflict markers. The worktree is kept. | Remove the markers, keeping both sides. Run `continue` again. |
| `continue_outside_edit` | continue | The staged tree, the work tree, or an untracked file differs from the plain merge in a path outside the conflict set. This includes a hand-made file under a generator output glob. Nothing was committed. The worktree is kept. | Undo those edits and run `continue` again. If an edit was staged, run `abort`, then `sync --keep-worktree` again. |
| `base_moved` | continue | The base branch moved after `sync --keep-worktree`, so the kept merge is out of date. The worktree is kept. Nothing was pushed. | Run `abort`, then run `sync --keep-worktree` again. |
| `merge_not_in_progress` | continue | The merge in the kept worktree was committed or aborted by hand. | Run `abort`, then run `sync --keep-worktree` again. Do not run `continue` again. |
| `worktree_invalid` | continue, abort | The path is not a worktree that this script kept for this PR, or its recorded state is missing, open to other users, or does not match git. Nothing was deleted. | Use the exact path that `sync --keep-worktree` printed. |
| `worktree_tampered` | sync, continue | A policy step changed the git data of the worktree or the head. Nothing was pushed. | Check the policy steps on the base branch. |
| `regenerate_failed` | sync, continue | A policy regenerate command failed, left a conflict marker, or did not write an output. | Fix the generator or its inputs. Never edit a generated file by hand. |
| `inventory_miss` | sync, continue | A policy inventory does not name an added file. A moved file counts as added. | Add the files to the inventory with a signed commit and a normal push, then run `sync` again. |
| `dco_missing` | sync, continue | A commit has no `Signed-off-by`. | Run `dco-fix`, then run `sync` again. |
| `prepush_failed` | sync, continue | A policy pre-push step failed. | Fix the cause with a signed commit and a normal push. Then run `sync` again. |
| `rereview_failed` | sync, continue | The push worked. The re-review request failed. | Ask for a new review by hand. |
| `signed_commit` | dco-fix | A commit in the rewrite range has a GPG or SSH signature. | Ask the author to add the sign-off in a new commit. |
| `non_utf8_commit` | dco-fix | A commit in the range is not valid UTF-8, so a rewrite could not keep its bytes. | Ask the author to add the sign-off in a new commit. |
| `unsupported_commit` | dco-fix | A commit has a header that a rewrite would drop. | Ask the author to add the sign-off in a new commit. |
| `no_identity` | dco-fix | The git `user.name` or `user.email` is not set. | Set both, then run again. |
| `policy_report_only` | dco-fix | The policy `dco.fix` is `report`. | Ask a maintainer. |
| `verification_failed` | dco-fix | A rebuilt commit differs from the old one in more than the trailer. Nothing was pushed. | Report the bug. |
| `dequeue_failed` | dco-fix | The script could not dequeue the PR. Nothing was pushed. | Dequeue by hand, then run again. |
| `comment_failed` | dco-fix | The push worked. The PR comment failed. | Post the comment by hand. |
| `drift` | metadata | The head, title, or body changed after `show`. | Run `show` again. |
| `credential_in_text` | metadata | The new title or body looks like it holds a token, an auth header, or a URL password. | Remove the secret, then run `write` again. |
| `invalid_text` | metadata | The title or body is not allowed: a line break in the title, or a body file that is a link, empty, or too large. | Fix the text, then run `write` again. |
| `uncertain_outcome` | metadata | An edit may have landed. | Run `show` and compare before any retry. |
| `safety_refused` | all | The safety layer refused a git or gh call. | Report it. Never work around it. |
| `git_failed` | all | A git command failed. The detail line has the message. | Report the detail line. Run the mode again only if it names a cause that you fixed. |
| `failed` | all | An unexpected error. | Report the detail line. |
| `unknown_state` | all | PR data is missing or cut off. | Run `tailrocks-pr-status`, then try again. |
