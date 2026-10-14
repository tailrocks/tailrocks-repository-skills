#!/bin/sh
set -eu

helper_bin=$(printenv TAILROCKS_HELPER_BIN 2>/dev/null || true)
if [ -z "$helper_bin" ]; then
  cargo build --quiet --locked --manifest-path helper/Cargo.toml
  helper_bin="$PWD/helper/target/debug/tailrocks-repository-helper"
fi

work=$(mktemp -d /tmp/tailrocks-cleanup.XXXXXX)
trap 'rm -rf "$work"' EXIT HUP INT TERM
repo="$work/repo"
snapshot="$work/snapshot"
restore="$work/restore"
source_clone="$work/source-clone"

git init -q -b main "$repo"
git -C "$repo" config user.name Fixture
git -C "$repo" config user.email fixture@example.invalid
printf '*.local\n' >"$repo/.gitignore"
printf 'base\n' >"$repo/base.txt"
git -C "$repo" add .gitignore base.txt
git -C "$repo" commit -qm base
git -C "$repo" branch release/next

git -C "$repo" checkout -q -b feature/selected main
printf 'selected\n' >"$repo/selected.txt"
git -C "$repo" add selected.txt
git -C "$repo" commit -qm selected

git -C "$repo" checkout -q -b feature/unselected main
printf 'unselected\n' >"$repo/unselected.txt"
git -C "$repo" add unselected.txt
git -C "$repo" commit -qm unselected

git -C "$repo" checkout -q release/next
git -C "$repo" merge --no-ff -q feature/selected -m 'land selected source'
target_before=$(git -C "$repo" rev-parse refs/heads/release/next)
main_before=$(git -C "$repo" rev-parse refs/heads/main)
selected_before=$(git -C "$repo" rev-parse refs/heads/feature/selected)

git clone -q --local --no-hardlinks "$repo" "$source_clone"
git -C "$source_clone" checkout -q feature/selected
printf 'dirty\n' >>"$source_clone/selected.txt"
printf 'untracked\n' >"$source_clone/private.txt"
printf 'ignored\n' >"$source_clone/secret.local"
"$helper_bin" snapshot-create --repo-path "$source_clone" --output "$snapshot" >"$work/snapshot.json"
"$helper_bin" snapshot-restore-test --snapshot "$snapshot" --output "$restore" >"$work/restore.json"
jq -e '.bundle_verified and .head_verified and .unstaged_patch_verified and .files_verified >= 2 and .ignored_or_untracked_verified >= 2' "$work/restore.json" >/dev/null
test "$(tail -n 1 "$restore/repository/selected.txt")" = "dirty"
test "$(cat "$restore/repository/private.txt")" = "untracked"
test "$(cat "$restore/repository/secret.local")" = "ignored"

# The selected source is eligible only after exact identity and target ancestry
# are rechecked. Unselected sources remain present.
test "$(git -C "$repo" rev-parse refs/heads/feature/selected)" = "$selected_before"
git -C "$repo" merge-base --is-ancestor "$selected_before" refs/heads/release/next
rm -rf "$source_clone"
test ! -e "$source_clone"
git -C "$repo" branch -d feature/selected >/dev/null
if git -C "$repo" show-ref --verify --quiet refs/heads/feature/selected; then
  echo "selected source branch was not removed" >&2
  exit 1
fi
git -C "$repo" show-ref --verify --quiet refs/heads/feature/unselected
test "$(git -C "$repo" rev-parse refs/heads/release/next)" = "$target_before"
test "$(git -C "$repo" rev-parse refs/heads/main)" = "$main_before"

retained_request=$("$helper_bin" parse-request --text "--cleanup=none --target-branch=release/next feature/unselected")
printf '%s\n' "$retained_request" | jq -e '.cleanup == "none" and .target_branch == "release/next" and .sources[0].branch == "feature/unselected"' >/dev/null
git -C "$repo" show-ref --verify --quiet refs/heads/feature/unselected

echo "cleanup scope: PASS"
