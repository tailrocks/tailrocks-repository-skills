# Target-bound receipts

Every meaningful receipt must contain:

- repository identity and resolved repository path;
- target branch name and exact target ref;
- target OID observed before the operation;
- source canonical identity and all raw provenance where applicable;
- campaign ID and scope: selected-sources or all-work;
- operation phase, status, and timestamp;
- post-operation target OID when the operation mutates the target.

Re-read the target after every landing batch. A receipt from main cannot authorize release/next, and a receipt from one OID cannot authorize a later OID without a new observation.

The target-relative comparison base is the fresh selected target, not main, source age, or the PR base. Preserve existing target behavior. Classify evidence for partial, squash, cherry-pick, successor, revert, and target-specific dependency relationships. A source that is already represented on the target is a no-op only when the target evidence proves it.

Completion requires a landed target commit or an exact verified fast-forward/cherry-pick result. An opened PR, approved review, green pending check, queued merge, or prepared patch is incomplete.
