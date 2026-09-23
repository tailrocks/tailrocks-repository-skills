# Changelog

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
