#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
install_test="$repo_root/tests/claude-install-acceptance.sh"

require_text() {
  if ! grep -F -q -- "$2" "$1"; then
    echo "Claude isolated-install contract missing from $1: $2" >&2
    exit 1
  fi
}

require_text "$install_test" 'env -i \'
require_text "$install_test" 'HOME="$home_dir"'
require_text "$install_test" 'CLAUDE_CONFIG_DIR="$config_dir"'
require_text "$install_test" 'XDG_CONFIG_HOME="$xdg_config_dir"'
require_text "$install_test" 'DISABLE_AUTOUPDATER=1'
require_text "$install_test" 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1'
require_text "$install_test" 'plugin marketplace add "$repo_root" --scope user'
require_text "$install_test" 'plugin marketplace add "$pr_skills_root" --scope user'
require_text "$install_test" 'plugin install "$repo_plugin_id" --scope user --yes --json'
require_text "$install_test" 'plugin install "$owner_plugin_id" --scope user --yes --json'
require_text "$install_test" '"$pr_skills_head" = "$TAILROCKS_PR_SKILLS_SHA"'
require_text "$install_test" 'skills/tailrocks-review-pr/SKILL.md'
require_text "$install_test" 'skills/tailrocks-merge-pr/SKILL.md'
require_text "$install_test" 'Claude native install artifacts retained: $work'
require_text "$install_test" 'INSTALL-ONLY: no host auth/config read or copied; model invocation skipped.'

if grep -E -q 'plugin (marketplace )?(remove|uninstall)|--plugin-dir|claude exec|claude .* -p ' "$install_test"; then
  echo 'Claude install contract must not uninstall, inject plugins, or invoke a model from the isolated install-only test' >&2
  exit 1
fi

echo 'Claude native install contract: PASS (static source check only; installed-plugin receipt is a separate fixture result)'
