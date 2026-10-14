#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
work=$(mktemp -d /tmp/tailrocks-agent.XXXXXX)
repo="$work/repo"
landing_repo="$work/landing/repo"
state_dir="$work/state"
log="$work/codex.log"
marketplace_name=tailrocks-repository-skills

cleanup() {
  codex plugin remove "$marketplace_name@$marketplace_name" --json >/dev/null 2>&1 || true
  codex plugin marketplace remove "$marketplace_name" --json >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT HUP INT TERM

if codex plugin marketplace list --json | jq -e '.marketplaces[] | select(.name == "'"$marketplace_name"'")' >/dev/null; then
  echo "refusing to overwrite an existing Codex marketplace: $marketplace_name" >&2
  exit 1
fi

git init -q -b main "$repo"
git -C "$repo" config user.name Fixture
git -C "$repo" config user.email fixture@example.invalid
printf 'base\n' >"$repo/base.txt"
git -C "$repo" add base.txt
git -C "$repo" commit -qm base
main_before=$(git -C "$repo" rev-parse refs/heads/main)
git -C "$repo" branch release/next
git -C "$repo" checkout -q -b feature/auth main
printf 'auth\n' >"$repo/auth.txt"
git -C "$repo" add auth.txt
git -C "$repo" commit -qm auth
git -C "$repo" checkout -q release/next
printf 'release\n' >"$repo/release.txt"
git -C "$repo" add release.txt
git -C "$repo" commit -qm release

mkdir -p "$work/landing"
git clone -q --local --no-hardlinks "$repo" "$landing_repo"
mkdir -p "$state_dir"

codex plugin marketplace add "$repo_root" --json >/dev/null
codex plugin add "$marketplace_name@$marketplace_name" --json >/dev/null
export TAILROCKS_REPOSITORY_STATE_DIR="$state_dir"
codex exec --ephemeral --sandbox workspace-write --cd "$repo" \
  'Use $repo-merge --local-only --cleanup=none --target-branch=release/next feature/auth. This is a disposable local fixture. Actually land the justified source into the exact local target, do not change main, do not use network, and report the target OID. Use TAILROCKS_REPOSITORY_STATE_DIR='"$state_dir"' for campaign state. If the checked-out fixture Git metadata is immutable, use the precreated writable clone at '"$landing_repo"' and verify that clone.' >"$log"

test "$(git -C "$repo" rev-parse refs/heads/main)" = "$main_before"
test "$(git -C "$landing_repo" rev-parse refs/remotes/origin/main)" = "$main_before"
test "$(git -C "$landing_repo" rev-parse refs/heads/release/next)" != "$(git -C "$repo" rev-parse refs/heads/release/next)"
test -f "$landing_repo/auth.txt"
test -f "$landing_repo/release.txt"
git -C "$landing_repo" merge-base --is-ancestor refs/remotes/origin/feature/auth refs/heads/release/next
test "$(git -C "$landing_repo" show refs/heads/release/next:auth.txt)" = "auth"
test "$(git -C "$landing_repo" show refs/heads/release/next:release.txt)" = "release"
grep -F '"status": "complete"' "$log" >/dev/null

echo "real Codex local-only landing: PASS"
