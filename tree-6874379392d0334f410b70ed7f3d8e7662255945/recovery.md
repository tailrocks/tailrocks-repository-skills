# Recovery and resumption

Campaign state lives outside the repository. Write it atomically. Freeze selectors, repository identity, target branch/ref/OID, target scope, and campaign ID before mutation. Record initial and current target OIDs, configuration digest, scan coverage, decisions, receipts, recovery index, and a per-campaign lease. Journal phase transitions and external IDs.

Before destructive cleanup, snapshot tracked staged and unstaged patches, ignored and untracked files, symlinks, and the exact HEAD. Restore into a disposable repository and verify bundle, HEAD, hashes, patches, and extra files. A failed restore blocks deletion.

On interruption, resume only the recorded campaign and target. Re-observe the exact target before continuing; a changed OID is a new observation, not permission to reuse stale review or CI receipts. If the requested target differs, stop with a target conflict and start a new scoped campaign. Reconcile external state before retrying. If merge status is uncertain, inspect the PR and target; never retry a merge blindly.

A no-op rerun must still rebind and verify the exact target, report why every source is already represented or unresolved, and produce an idempotency receipt.
