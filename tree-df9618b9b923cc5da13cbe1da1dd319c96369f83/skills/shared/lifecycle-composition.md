# Lifecycle composition

This plugin does not duplicate pull-request policy.

Use tailrocks-review-pr for independent read-only review. It may report verified findings but never edits, approves, posts, or merges.

Use tailrocks-merge-pr for the actual PR merge. Supply the exact PR, expected head, requested target, fresh review/CI receipts, repository worklist result, and required high-risk confirmation. Honor its fail-closed gates. A successful preflight is not a merge.

If either lifecycle owner is unavailable, its required receipt cannot be produced, or the merge result is uncertain, stop. Do not substitute a direct gh merge, silently retarget, or report queued work as complete.

Any commit, push, review fix, PR refresh, or target advance invalidates earlier receipts. Recompute the affected receipt and recheck the destination before proceeding.
