# Merge rules

## Gates before any write

The script runs these gates in order. The first failure ends the step.

1. `--confirm` equals the PR number. A different number exits 3 before any read.
   No `--confirm` prints the plan and exits 3.
2. The PR head is in the same repository. A fork PR exits 3.
3. The verdict uses the base-branch policy (or the built-in default when the
   base branch has no policy file). A verdict from a local policy exits 3.
4. The verdict is READY. WAITING exits 10. BLOCKED exits 20. The verdict lists
   each finding with its owner and next action.
5. For `merge`: the changed files hold no high-risk path, unless the user passed
   `--accept-risk`. A list that GitHub cannot give counts as high risk.
6. For `merge`: the route follows the policy and the branch rules (below).
7. The PR is read again. The head must equal the head of the plan, and the gates
   must still hold. Any other result exits 20 and writes nothing.

After the write, the script reads the PR again and reports what it sees.

## Routes

| Condition | Route |
| --- | --- |
| The base branch has a merge queue and the queue method equals `merge.method` | Enqueue with `expectedHeadOid`. |
| The base branch has no merge queue and the rules allow `merge.method` | `gh pr merge --squash` (or `--merge`, `--rebase`) with `--match-head-commit`. |
| `merge.queue = "required"` and no queue exists | BLOCKED. |
| `merge.queue = "never"` and a queue exists | BLOCKED. |
| The queue method is unknown or differs from the policy | BLOCKED. |

The queue method comes from the `merge_queue` rule of the rules API. A queue that
only the classic branch settings define has no readable method. That case is
BLOCKED.

## Jump

A jump needs both: the policy has `merge.jump = "labelled"`, and the PR has one
of the `merge.jump_labels`. The jump uses the same enqueue mutation with
`jump` set. If GitHub refuses it, the step is BLOCKED. The script does not enter
the queue without the jump. The user decides.

## High-risk paths

The policy schema has no key for these paths. The script uses a built-in list:
`.github/`, release directories, authentication and authorization directories,
and migration directories. The match is on any path segment, so the list can
flag more than it should. It never flags less.

## Watch

- One poll reads the whole verdict again. The poll output shows a line only when
  the queue view changes.
- A review that asks for changes (`review_changes_requested` or
  `review_blocking_finding`) while the PR is queued causes a dequeue and a comment.
  The watch then exits 20.
- An UNMERGEABLE entry stops the watch with exit 20. The next action is
  `dequeue`. The script does not dequeue it by itself.
- Other blockers while queued (for example an unresolved thread) are reported
  and the watch goes on. Use `dequeue` to take such an entry out.
- When the entry vanishes, GitHub can still show the PR as open for a few
  seconds. The script reads three more times, five seconds apart, before it
  decides that the PR left the queue.
- When the PR left the queue, the script prints the last removal reason from
  GitHub and the verdict. Exit 20.
- Three failed reads in a row stop the watch with exit 20.

## Dequeue comment

The comment holds fixed words and finding codes. No text from the PR enters it.
The reason is one of: `changes-needed`, `blocked`, `unmergeable`, `manual`.
