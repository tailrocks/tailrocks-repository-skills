#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

fail() {
  printf 'release version guard: FAIL: %s\n' "$1" >&2
  exit 1
}

tag=${GITHUB_REF_NAME-}
[ -n "$tag" ] || fail 'GITHUB_REF_NAME is required'
printf '%s\n' "$tag" | LC_ALL=C grep -Eq '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' ||
  fail "tag must be vX.Y.Z without leading zeroes, prerelease, or build suffix: $tag"
tag_version=${tag#v}

codex_name=$(jq -er '.name | select(type == "string" and length > 0)' .codex-plugin/plugin.json) ||
  fail 'Codex plugin name is missing'
codex_version=$(jq -er '.version | select(type == "string" and length > 0)' .codex-plugin/plugin.json) ||
  fail 'Codex plugin version is missing'
claude_name=$(jq -er '.name | select(type == "string" and length > 0)' .claude-plugin/plugin.json) ||
  fail 'Claude plugin name is missing'
claude_version=$(jq -er '.version | select(type == "string" and length > 0)' .claude-plugin/plugin.json) ||
  fail 'Claude plugin version is missing'
marketplace_name=$(jq -er '.name | select(type == "string" and length > 0)' .claude-plugin/marketplace.json) ||
  fail 'Claude marketplace name is missing'
marketplace_version=$(jq -er --arg name "$codex_name" \
  '[.plugins[]? | select(.name == $name)] | if length == 1 then .[0].version | select(type == "string" and length > 0) else error("expected exactly one matching plugin") end' \
  .claude-plugin/marketplace.json) || fail 'Claude marketplace plugin version is missing or ambiguous'
muse_name=$(jq -er '.name | select(type == "string" and length > 0)' .muse-plugin/plugin.json) ||
  fail 'Muse plugin name is missing'
muse_version=$(jq -er '.version | select(type == "string" and length > 0)' .muse-plugin/plugin.json) ||
  fail 'Muse plugin version is missing'
root_name=$(jq -er '.name | select(type == "string" and length > 0)' plugin.json) ||
  fail 'portable plugin name is missing'

[ "$codex_name" = "$claude_name" ] || fail 'Codex and Claude plugin names differ'
[ "$codex_name" = "$marketplace_name" ] || fail 'plugin and marketplace names differ'
[ "$codex_name" = "$muse_name" ] || fail 'plugin and Muse names differ'
[ "$codex_name" = "$root_name" ] || fail 'portable and client plugin names differ'

check_version() {
  label=$1
  version=$2
  [ "$version" = "$tag_version" ] ||
    fail "$label version '$version' does not match tag '$tag'"
}

check_version 'Codex plugin' "$codex_version"
check_version 'Claude plugin' "$claude_version"
check_version 'Claude marketplace plugin' "$marketplace_version"
check_version 'Muse plugin' "$muse_version"

# The portable root manifest intentionally omits version under its schema;
# catalogs may add a version later, but a present value must be valid and match.
check_optional_version() {
  file=$1
  label=$2
  has_version=$(jq -r 'has("version")' "$file") || fail "$label manifest is invalid"
  if [ "$has_version" = true ]; then
    version=$(jq -er '.version | select(type == "string" and length > 0)' "$file") ||
      fail "$label version is present but is not a non-empty string"
    check_version "$label" "$version"
  fi
}

check_optional_version plugin.json 'portable plugin'
check_optional_version catalog.json 'catalog'

printf 'release version guard: PASS (tag %s matches canonical plugin versions)\n' "$tag"
