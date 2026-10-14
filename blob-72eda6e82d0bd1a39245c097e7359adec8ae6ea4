#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

codex --version >/dev/null
codex exec --help | grep -F -- '--ephemeral' >/dev/null
codex exec --help | grep -F -- '--sandbox' >/dev/null
codex exec --help | grep -F -- '--add-dir' >/dev/null
codex plugin add --help >/dev/null
codex plugin marketplace add --help >/dev/null
claude --version >/dev/null
claude --help | grep -F -- '--plugin-dir' >/dev/null
claude --help | grep -F -- '--no-session-persistence' >/dev/null
claude --help | grep -F -- '--permission-mode' >/dev/null
claude plugin install --help | grep -F -- 'local' >/dev/null
claude plugin uninstall --help | grep -F -- 'local' >/dev/null
claude plugin marketplace add --help | grep -F -- 'local' >/dev/null
claude plugin marketplace remove --help | grep -F -- 'local' >/dev/null
claude plugin validate --strict --json .claude-plugin/plugin.json >/dev/null
claude plugin validate --strict --json .claude-plugin/marketplace.json >/dev/null

echo "client packaging contract: PASS (installed Codex/Claude CLI metadata only; no model invoked)"
