# Landing policy

This skill performs the only supported landing. One invocation lands at most
one PR with one merge or enqueue attempt.

- The merge route guards the expected PR head with
  `gh pr merge --match-head-commit <head>`. That guard is not a
  compare-and-swap on a caller-selected base OID.
- A last read and a later write still have a race window. A local lock does
  not prevent another remote writer.
- When base freshness matters, prefer a merge queue or a server-enforced
  freshness check. When those protections are absent, block an affected
  high-risk or explicitly freshness-bound merge.
- Strict exact-base mode requires an atomic match to one base OID. Without
  a proven supported mechanism, the skill blocks that action with code
  `target_cas_unavailable`. That block never becomes a universal refusal.
- The skill never uses `--admin`, rule bypass, disabled checks, a direct
  target push, a rule change, or branch deletion in the merge command.
- The skill never deletes a source. Cleanup belongs to
  `tailrocks-repository-cleanup`.
- Terminal states are `blocked`, `pending`, `queued`, `merged`, `failed`,
  and `uncertain`. `enqueued` is not merged. `pending` at the poll bound is
  never success.
- After GitHub reports a merge, the skill verifies the intended PR, the
  intended repository and base, the merge commit, its presence in the
  current target history, the method conditions, and the post-merge check
  state. The target may advance past the merge commit.
- When the result is `failed`, retain the candidate and its evidence. When
  the result is `uncertain`, query the remote state before any retry.
