#!/bin/sh
set -eu

repo_root=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
cd "$repo_root"
version=$(jq -er '.version' .codex-plugin/plugin.json)

contract_tmp=$(mktemp -d "${TMPDIR:-/tmp}/release-version-contract.XXXXXX")
trap 'rm -rf "$contract_tmp"' 0
trap 'exit 1' HUP INT TERM
mkdir -p "$contract_tmp/tests" "$contract_tmp/.codex-plugin" "$contract_tmp/.claude-plugin"
cp tests/release-version-guard.sh "$contract_tmp/tests/release-version-guard.sh"
cp .codex-plugin/plugin.json "$contract_tmp/.codex-plugin/plugin.json"
cp .claude-plugin/plugin.json "$contract_tmp/.claude-plugin/plugin.json"
cp .claude-plugin/marketplace.json "$contract_tmp/.claude-plugin/marketplace.json"
cp plugin.json "$contract_tmp/plugin.json"
cp catalog.json "$contract_tmp/catalog.base.json"

write_catalog() {
  jq "$1" "$contract_tmp/catalog.base.json" > "$contract_tmp/catalog.json"
}

assert_catalog_accepted() {
  label=$1
  if ! GITHUB_REF_NAME="v$version" "$contract_tmp/tests/release-version-guard.sh" >/dev/null 2>&1; then
    echo "release version contract: catalog version $label was rejected" >&2
    exit 1
  fi
}

assert_catalog_rejected() {
  label=$1
  if GITHUB_REF_NAME="v$version" "$contract_tmp/tests/release-version-guard.sh" >/dev/null 2>&1; then
    echo "release version contract: catalog version $label was accepted" >&2
    exit 1
  fi
}

write_catalog 'del(.version)'
assert_catalog_accepted absent
write_catalog '.version = null'
assert_catalog_rejected null
write_catalog '.version = ""'
assert_catalog_rejected empty
write_catalog '.version = 7'
assert_catalog_rejected non-string
mismatch=0.0.0
if [ "$mismatch" = "$version" ]; then
  mismatch=0.0.1
fi
write_catalog ".version = \"$mismatch\""
assert_catalog_rejected mismatched

GITHUB_REF_NAME="v$version" tests/release-version-guard.sh >/dev/null
if GITHUB_REF_NAME="v${version%.*}.999" tests/release-version-guard.sh >/dev/null 2>&1; then
  echo 'release version contract: mismatched version was accepted' >&2
  exit 1
fi
if GITHUB_REF_NAME="v$version-rc.1" tests/release-version-guard.sh >/dev/null 2>&1; then
  echo 'release version contract: prerelease tag was accepted' >&2
  exit 1
fi
if GITHUB_REF_NAME="v01.2.3" tests/release-version-guard.sh >/dev/null 2>&1; then
  echo 'release version contract: leading-zero tag was accepted' >&2
  exit 1
fi
if (unset GITHUB_REF_NAME; tests/release-version-guard.sh >/dev/null 2>&1); then
  echo 'release version contract: missing tag was accepted' >&2
  exit 1
fi

echo "release version contract: PASS (exact v$version accepted; malformed tags and present-invalid catalog versions rejected)"
