#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

jq -e . plugin.json .codex-plugin/plugin.json .claude-plugin/plugin.json \
  .claude-plugin/marketplace.json .muse-plugin/plugin.json catalog.json >/dev/null

plugin_name=$(jq -er '.name' .codex-plugin/plugin.json)
codex_version=$(jq -er '.version' .codex-plugin/plugin.json)
claude_name=$(jq -er '.name' .claude-plugin/plugin.json)
claude_version=$(jq -er '.version' .claude-plugin/plugin.json)
marketplace_name=$(jq -er '.name' .claude-plugin/marketplace.json)
muse_name=$(jq -er '.name' .muse-plugin/plugin.json)
muse_version=$(jq -er '.version' .muse-plugin/plugin.json)
test "$claude_name" = "$plugin_name"
test "$marketplace_name" = "$plugin_name"
test "$muse_name" = "$plugin_name"

marketplace_plugin_count=$(jq --arg name "$plugin_name" '[.plugins[]? | select(.name == $name)] | length' .claude-plugin/marketplace.json)
test "$marketplace_plugin_count" = 1
marketplace_version=$(jq -er --arg name "$plugin_name" '.plugins[] | select(.name == $name) | .version' .claude-plugin/marketplace.json)
test "$claude_version" = "$codex_version"
test "$marketplace_version" = "$codex_version"
test "$muse_version" = "$codex_version"

catalog_version=$(jq -r '.version // empty' catalog.json)
if [ -n "$catalog_version" ]; then
  test "$catalog_version" = "$codex_version"
fi

skill_count=$(find skills -name SKILL.md -type f | wc -l | tr -d ' ')
catalog_skill_count=$(jq -er '.skills | length' catalog.json)
test "$skill_count" = 3
test "$catalog_skill_count" = "$skill_count"

echo "manifest contract: PASS (client versions agree at $codex_version; catalog version ${catalog_version:-not specified})"
