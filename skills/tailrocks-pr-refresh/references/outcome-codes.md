# Outcome codes

Each run prints one state and one code. `DONE` has code `ok`. The table lists
each `BLOCKED` code, what it means, and what to do. The script prints the exact
`next` text.

| Code | Mode | Meaning | Next action |
| --- | --- | --- | --- |
| `pr_not_open` | all | The PR is closed or merged. | None. Report the state. |
| `cross_repository` | sync, dco-fix | The PR head is in a fork. | Ask the PR author to update the branch. |
| `protected_branch` | sync, dco-fix | The head branch is the default branch or matches `branches.protected`. | None. The script never pushes there. |
| `not_owner` | sync, dco-fix | The PR author is not the gh user and not in `dco.bot_authors`. | Ask the author, or run as the author. |
| `queued` | sync, dco-fix | The PR is in the merge queue. A push removes it. | Dequeue first, then run again. For `dco-fix`, the policy `dco.dequeue_for_fix` allows the script to dequeue. |
| `head_moved` | sync, dco-fix | The PR head changed during the run. Nothing was written. | Run the mode again. |
| `remote_moved` | dco-fix | The remote branch moved. Nothing was pushed. | Run the mode again. |
| `push_rejected` | sync, dco-fix | The remote refused the push, because it moved. | Run the mode again. |
| `conflict` | sync | The merge conflicts in files that are not regenerable outputs. The merge was aborted. | Resolve keeping both sides. Never hand-merge generated files. |
| `regenerate_failed` | sync | A policy regenerate command failed, or left a conflict marker, or did not write an output. | Fix the generator or its inputs. |
| `inventory_miss` | sync | A policy inventory does not name an added file. | Add the files to the inventory. |
| `dco_missing` | sync | A commit has no `Signed-off-by`. | Run `dco-fix`. |
| `prepush_failed` | sync | A policy pre-push step failed. | Fix the cause. |
| `rereview_failed` | sync | The push worked. The re-review request failed. | Ask for a new review by hand. |
| `signed_commit` | dco-fix | A commit in the rewrite range has a GPG or SSH signature. | Ask the author to add the sign-off in a new commit. |
| `policy_report_only` | dco-fix | The policy `dco.fix` is `report`. | Ask a maintainer. |
| `verification_failed` | dco-fix | A rebuilt commit differs from the old one in more than the trailer. Nothing was pushed. | Report the bug. |
| `comment_failed` | dco-fix | The push worked. The PR comment failed. | Post the comment by hand. |
| `drift` | metadata | The head, title, or body changed after `show`. | Run `show` again. |
| `uncertain_outcome` | metadata | An edit may have landed. | Run `show` and compare before any retry. |
| `unknown_state` | all | PR data is missing or cut off. | Run `tailrocks-pr-status`, then try again. |
