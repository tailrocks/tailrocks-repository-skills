# Delivery-artifact evidence

The package's `merge-preflight` command owns the six exact delivery predicates
and returns their raw findings. `tailrocks-merge-pr` only reports that
read-only receipt. It has no waiver policy, irreversible merge decision, or
remote-landing authority.

- The predicates apply only when the PR diff touches `roadmap/`.
- `delivery.status` is `not_applicable` when it does not, `pass` when the
  touched tree has no findings, and `blocked` when findings remain.
- Each finding names the affected paths, detail, and reported route. Preserve
  those fields in the report; this skill never repairs, deletes, commits, or
  pushes a delivery artifact.
- The command compares only this PR's merge-base and head trees. It requires
  no delivery skill to be installed and does nothing for boards elsewhere.
- Delivery and documentation findings remain visible in the receipt. Neither a
  review, approval, repository prose, waiver request, nor a `ready` receipt
  authorizes remote landing.
