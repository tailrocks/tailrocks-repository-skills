# Delivery-artifact evidence

The package's `merge-preflight` command owns the six exact delivery predicates
and returns their raw findings. This skill reports those findings and enforces
them as merge preconditions.

- The predicates apply only when the PR diff touches `roadmap/`.
- `delivery.status` is `not_applicable` when it does not, `pass` when the
  touched tree has no findings, and `blocked` when findings remain.
- Each finding names the affected paths, detail, and reported route. Preserve
  those fields in the report; this skill never repairs, deletes, commits, or
  pushes a delivery artifact.
- The command compares only this PR's merge-base and head trees. It requires
  no delivery skill to be installed and does nothing for boards elsewhere.
- When `delivery.status` is `blocked`, the skill stops and reports `blocked`
  unless the active request carries an explicit delivery waiver. The skill
  records that waiver in the merge request; it never assumes one.
- Delivery and documentation findings remain visible in the receipt. Neither
  a review, an approval, repository prose, nor a `ready` receipt authorizes
  a merge by itself.
- Waiver enforcement is model-side. The model grants a waiver only when
  the active request carries it explicitly. The merge core records the
  waiver in the receipt. It never re-checks the predicates.
