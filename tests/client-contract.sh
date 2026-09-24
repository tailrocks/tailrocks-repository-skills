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

client_metadata() {
  client_label=$1
  client_command=$2
  if client_path=$(command -v "$client_command" 2>/dev/null); then
    client_version=$("$client_path" --version 2>/dev/null | sed -n '1p')
    [ -n "$client_version" ] || client_version='version unavailable'
    printf '%s: %s\n' "$client_label" "$client_version"
  else
    printf '%s: not installed\n' "$client_label"
  fi
}

client_metadata 'Codex' codex
client_metadata 'Claude' claude
client_metadata 'Muse' muse
client_metadata 'Kimi' kimi
client_metadata 'OpenCode' opencode
client_metadata 'Antigravity (agy)' agy
echo 'client packaging contract: PASS (six-client metadata only; no model invoked)'
