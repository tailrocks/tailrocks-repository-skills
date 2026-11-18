# Fleet rules

## What `plan` reads

1. The open PRs and the default branch at its current commit, in one list query.
2. The policy file at that commit. No other commit gives a policy, and neither
   does a PR head, a PR base branch, or the working tree. Every verdict in the
   run uses this policy.
3. The GraphQL budget. A budget below the cost of the run stops the script
   (exit 2). With `--wait` it sleeps once until the reset, for one hour at most.
4. Each PR that is not held, with the pr-status logic (`gather` and `evaluate`).
5. The in-progress runs of the repository.

## Ranking

| Group | Order inside the group |
| --- | --- |
| READY | PR number, lowest first |
| WAITING | PR number |
| BLOCKED | by owner of the first blocker: `pr-refresh`, `pr-threads`, `pr-merge`, `pr-create`, `reviewer`, `ci`, `human`, `pr-status`; then PR number |

A PR that cannot be read is BLOCKED with the owner `pr-status`. A PR in
`fleet.hold` is listed under `held` and never read.

## Stockpile

The plan reports two lists and gives no threshold. A PR can be on both lists:

- READY PRs that are not in the queue.
- Approved PRs that are behind the base. Approved means: no `review_*` finding,
  and a positive approval signal (an approving review, or `reviewDecision` is
  APPROVED; with comment verdicts, a verdict on the head).

## Queue hygiene

A queue entry in position 1 to 5 in state UNMERGEABLE blocks the entries behind
it. The plan holds one dequeue for it. A fork PR is reported and not planned.
`apply` calls the dequeue of `pr-merge` with the reason `unmergeable`. It first
reads the PR again. The entry must still be UNMERGEABLE in the first 5
positions, and the head must be the head of the plan.

## Refresh budget

| Queue length of the default branch | Budget |
| --- | --- |
| below `ci.congestion_queue_length` | `ci.max_refreshes` |
| at or above it, or not shown by GitHub | `ci.max_refreshes_congested` |

Refreshes that an earlier pass started and whose CI still runs use up the
budget. A PR counts when its head commit is a merge of the base (or the commit
"Start a fresh CI run") and a check on it is not complete. A person's own merge
commit counts too, which only makes the budget safer.

A refresh candidate is an open, non-draft, same-repository PR on the default
branch. It is not queued. Each of its blockers is `behind_base`, `conflict`, or
`check_stale_base`. Candidates are taken in PR number order, up to the budget.
The rest is `deferred`.

`apply` reads the queue length again before each refresh. Its own enqueues
grow the queue, so the budget can shrink during the run. A refresh counts
against the budget when it starts, whatever its result.

## Merge budget

| Route | Cap when the policy sets none |
| --- | --- |
| Merge queue | 3 enqueues |
| Direct merges | 1 merge |

`fleet.max_merges_per_pass` replaces the default. On a merge queue, the cap is
also limited so that the queue length plus the enqueues of the pass stays at or
below `ci.congestion_queue_length`. At or above that length the room is 0, so
nothing is enqueued. A queue of unknown length has no room. The READY PRs over the cap are listed as
`deferred (merge budget)` in ranked order.

`apply` reads the queue and the policy again before each merge. After a direct
merge, the base has moved. The next PR is read on the new base. A PR that is
behind it is skipped as a merge and becomes a refresh candidate for this pass,
within the refresh budget.

## Freeze, hold, and the deadline

Before each write, `apply` reads freeze and hold from the policy of the read
that came right before it, and the environment variable again. A freeze refuses
that action and every action after it (exit 3). A held PR is skipped. The pass
stops at its deadline (30 minutes, below the 60 minute lock bound): the actions
left are pending.

## Orphan runs

An orphan run is an in-progress, queued, waiting, or pending run on a branch that no open PR uses. Runs on
the default branch, on protected branches, and on merge queue branches are not
orphans. Each status list holds 100 runs at most; the report says when it may be cut.
The script never cancels a run.

## Order of `apply`

1. Dequeues, by queue position.
2. Merges (enqueue, or direct merge), in ranked order, up to the merge budget. The route comes from
   `pr-merge`: the policy and the branch rules decide it.
3. Refreshes, by PR number, up to the budget. Refreshes that a direct merge made
   necessary come last.

Each action reads the PR again right before it writes. `apply` takes one lock
per repository, so two runs never overlap.

## Results

| Result | Meaning |
| --- | --- |
| done | The action ran. |
| skipped | The PR no longer matches the plan. Nothing was written. |
| pending | The action cannot run in this build. Nothing was written. |
| stopped | The head moved, or the other skill refused. Nothing was written for it. |
| refused | A freeze started. Nothing was written for it or for any action after it. |
