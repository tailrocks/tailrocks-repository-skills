# Target-bound receipts

Every meaningful receipt must contain:

- \`schema: tailrocks.campaign-receipt/v1\`;
- repository identity and resolved repository path;
- target branch name and exact target ref/OID;
- \`source_ids\` containing canonical source IDs and preserved provenance in the
  evidence payload;
- campaign ID and scope: selected-sources or all-work;
- operation ID, phase, status, timestamp, and a 64-character
  \`content_sha256\` or \`artifact_sha256\`;
- post-operation target OID when the operation mutates the target.

Attach receipts only after the helper has observed the exact target. The helper
rejects wrong campaign/scope/repository/path/source/phase/hash bindings and
rejects pending or queued status. Completion requires audit, review, CI,
landing, and verification phases; resolved cleanup also requires a cleanup
phase. Audit-only campaigns require only an audit phase.

Re-read the target after every landing batch. A receipt from main cannot authorize release/next, and a receipt from one OID cannot authorize a later OID without a new observation.

The target-relative comparison base is the fresh selected target, not main, source age, or the PR base. Preserve existing target behavior. Classify evidence for partial, squash, cherry-pick, successor, revert, and target-specific dependency relationships. A source that is already represented on the target is a no-op only when the target evidence proves it.

Completion requires a landed target commit or an exact verified fast-forward/cherry-pick result. An opened PR, approved review, green pending check, queued merge, or prepared patch is incomplete.
