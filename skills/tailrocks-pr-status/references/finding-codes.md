# Finding codes

Each finding has a `code`, a `kind` (`blocker`, `wait`, or `info`), an `owner`,
a `detail` that holds the evidence, and a `next` action. The table shows what
each code means and what to do. The script prints the exact `next` text.

| Code | Kind | Meaning | Next action | Owner |
| --- | --- | --- | --- | --- |
| `pr_not_open` | blocker | The PR is closed or merged. | None. Report the state. | human |
| `unknown_state` | blocker | Data is missing, cut off, or unreadable. The script fails closed. | Run the script again. | pr-status |
| `draft` | blocker | The PR is a draft. | Mark it ready when the draft policy allows. | pr-merge |
| `stacked` | blocker | The base branch is the head branch of another open PR. | Wait for the parent PR to merge, then retarget. | human |
| `wrong_base` | blocker | The base is not the default branch and not in `branches.bases`. | Retarget the PR. | human |
| `conflict` | blocker | The branch conflicts with its base. | Merge the base and resolve through the policy commands. | pr-refresh |
| `mergeability_pending` | wait | GitHub has not computed mergeability. | Read the PR again. | pr-status |
| `behind_base` | blocker or info | The head is behind the base. A blocker only when the rules need an up-to-date branch. | Merge the base. | pr-refresh |
| `check_failed` | blocker | A required check failed, timed out, or did not start; or a flaky check failed more often than `checks.flaky_reruns`. | Read the log and fix the cause. | human |
| `check_flaky` | blocker | A check on the flaky list failed within its rerun allowance. | Re-run the check. | ci |
| `check_cancelled` | blocker | A required check was cancelled and nothing failed. | Re-run the check or push. | ci |
| `check_not_passing` | blocker | A required check ended skipped or neutral, and the policy does not accept that. | Find out why it did not run. | human |
| `check_wrong_source` | blocker | A check with the required name comes from another app than the rule names. | Investigate. Do not accept the result. | human |
| `check_stale_base` | blocker | A base-sensitive check failed while the branch is behind its base. | Merge the base. Make no code change. | pr-refresh |
| `check_missing` | blocker | A required check has no run on the head. | Trigger CI with a push or the policy label. | ci |
| `checks_pending` | wait | A required check, or a run of a watched workflow, has not finished. | Watch. Run the script again. | ci |
| `ci_label_needed` | blocker | The policy runs full CI only with a label, and the label is absent. | Add the run-once label. | ci |
| `review_missing` | blocker | No approving verdict on the head or on a carry-over equivalent. | Request a review of the head. | reviewer |
| `review_changes_requested` | blocker | The latest verdict of a counted reviewer asks for changes. | Triage the threads, fix, request a new review. | pr-threads |
| `review_decision` | blocker | Branch rules need approvals or a code-owner review, and GitHub's decision is not APPROVED. | Request a review. | reviewer |
| `review_blocking_finding` | blocker | An approval, or a later review, lists a blocking finding. | Fix or defer the finding, then request a review. | pr-threads |
| `review_stale` | blocker | The verdict is on an older head and carry-over does not apply. | Request a review of the head. | reviewer |
| `threads_unresolved` | blocker | At least one review thread is unresolved, from a bot or a person. | Fix or defer each thread, reply, and resolve. | pr-threads |
| `dco_missing` | blocker | A commit that is not exempt has no `Signed-off-by:` trailer. | Add the sign-off. | pr-refresh |
| `queued` | wait | The PR is in the merge queue and moving (QUEUED, AWAITING_CHECKS, MERGEABLE, or LOCKED). | Watch the entry. | pr-merge |
| `queue_unmergeable` | blocker | The queue entry is UNMERGEABLE and blocks the entries behind it. | Dequeue it, then refresh the PR. | pr-merge |
| `queue_ejected` | info | GitHub removed the PR from the queue, and the head has not changed since. The reason is free text. | The blocking findings give the action. | pr-status |
| `done_when_unchecked` | blocker or info | A linked issue has open Done-when boxes. The kind comes from `issues.done_when`. | Prove each box, or link the issue with `Part of`. | human |
| `body_template` | blocker | `pr_body.enforce` is true and the body misses a section or leaves one empty. | Reconcile the body. | pr-refresh |
| `gate_failed` | blocker | A gate that the policy declares fails. | Per gate. The detail names it. | human |
| `cross_repository` | info | The head is in a fork. Writing skills refuse it. | Read only. | pr-status |
| `github_disagrees` | blocker | All gates pass, but GitHub does not allow the merge. | Read GitHub's reason. Do not merge. | human |

## Review rules in short

- Source `github-approval`: any counted CHANGES_REQUESTED blocks. When the branch
  rules need approvals, the decision must be APPROVED. GitHub dismisses stale
  approvals itself.
- Source `comment-verdict`: the latest verdict per counted reviewer decides. A
  counted reviewer is a login in `review.reviewers`, or else an owner, member, or
  collaborator. An approval that also matches `blocking_pattern` is not an approval.
- Carry-over (`clean-base-merge`): an approval on an older commit counts when
  git proves one of three steps from the head: an empty commit, a clean merge of
  the base (`git merge-tree` exits 0 and its tree equals the merge tree), or a
  rewrite that changed only `Signed-off-by:` lines. Any git failure ends the
  chain, and the head needs its own review.

## Verdict rule

BLOCKED when any blocker exists. WAITING when no blocker exists and a wait
exists. READY otherwise, and only when `mergeStateStatus` is `CLEAN` or
`HAS_HOOKS`. A READY verdict is not a merge.
