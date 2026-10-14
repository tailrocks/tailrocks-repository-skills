# Changelog

## 0.1.2

- Verify explicit repository selectors against the current checkout's GitHub
  origin before campaign state or mutation, failing closed on mismatch or
  unverifiable binding.
- Resolve local refs and GitHub PR/list selectors through a paginated client
  seam, freeze source membership/metadata, reject divergent same-name refs,
  serialize campaigns with a repository/target lease, and reject
  non-fast-forward target movement.
- Require typed campaign receipts for applicable audit, review, CI, landing,
  verification, and resolved-cleanup phases before completion.
- Add an opt-in preserved-work mode to the real-agent fixture harness for
  independent transcript, receipt, and artifact inspection.

## 0.1.1

- Allow hosts with restricted plugin-cache writes to invoke a prebuilt helper
  through `TAILROCKS_HELPER_BIN`.
- Make the real-agent acceptance harness build that helper outside the agent
  sandbox and verify the target-bound completion receipt.
- Serialize campaign-state mutations with a per-campaign OS lock and fail
  closed when another writer is active.

## 0.1.0

- Added target-bound repo-merge facade.
- Added repository audit, convergence, and scoped cleanup skills.
- Added typed parser, target receipt, campaign journal, and local-state
  snapshot/restore helper.
- Added Codex and Claude manifests, disposable fixture contracts, CI, and
  release workflow.
