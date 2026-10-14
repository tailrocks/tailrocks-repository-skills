#!/bin/sh
set -eu

helper_bin=$(printenv TAILROCKS_HELPER_BIN 2>/dev/null || true)
if [ -z "$helper_bin" ]; then
  cargo build --quiet --locked --manifest-path helper/Cargo.toml
  helper_bin="$PWD/helper/target/debug/tailrocks-repository-helper"
fi

work=$(mktemp -d /tmp/tailrocks-recovery.XXXXXX)
trap 'rm -rf "$work"' EXIT HUP INT TERM
repo="$work/repo"
snapshot="$work/snapshot"
restore="$work/restore"
state="$work/state"

git init -q -b main "$repo"
git -C "$repo" config user.name Fixture
git -C "$repo" config user.email fixture@example.invalid
printf '*.ignored\n' >"$repo/.gitignore"
printf 'base\n' >"$repo/tracked.txt"
git -C "$repo" add .gitignore tracked.txt
git -C "$repo" commit -qm base
printf 'base\nunstaged\n' >"$repo/tracked.txt"
printf 'staged\n' >"$repo/staged.txt"
git -C "$repo" add staged.txt
printf 'untracked\n' >"$repo/untracked.txt"
printf 'ignored\n' >"$repo/local.ignored"
ln -s untracked.txt "$repo/link"

"$helper_bin" snapshot-create --repo-path "$repo" --output "$snapshot" >"$work/snapshot.json"
"$helper_bin" snapshot-restore-test --snapshot "$snapshot" --output "$restore" >"$work/restore.json"
cat "$work/restore.json" | jq -e '
  .bundle_verified and .head_verified and
  .staged_patch_verified and .unstaged_patch_verified and
  .files_verified >= 3
' >/dev/null
restored="$restore/repository"
test "$(cat "$restored/tracked.txt")" = "base
unstaged"
test "$(cat "$restored/staged.txt")" = "staged"
test "$(cat "$restored/untracked.txt")" = "untracked"
test "$(cat "$restored/local.ignored")" = "ignored"
test "$(readlink "$restored/link")" = "untracked.txt"

campaign_repo="$work/campaign-repo"
campaign_state="$work/campaign-state"
git init -q -b main "$campaign_repo"
git -C "$campaign_repo" config user.name Fixture
git -C "$campaign_repo" config user.email fixture@example.invalid
printf 'base\n' >"$campaign_repo/base.txt"
git -C "$campaign_repo" add base.txt
git -C "$campaign_repo" commit -qm base
request="$work/request.json"
target="$work/target.json"
"$helper_bin" parse-request --text "--target-branch=main feature/auth" >"$request"
"$helper_bin" target-check --repo-path "$campaign_repo" --target-branch main >"$target"
state_json=$("$helper_bin" campaign-init --state-dir "$campaign_state" --repo-path "$campaign_repo" --request-file "$request" --target-receipt "$target")
campaign_id=$(printf '%s\n' "$state_json" | jq -r '.campaign_id')
lock_path=$(printf '%s\n' "$state_json" | jq -r '.lock_path')
test -f "$lock_path"
"$helper_bin" campaign-resume --state-dir "$campaign_state" --campaign-id "$campaign_id" --target-branch main >/dev/null
if "$helper_bin" campaign-resume --state-dir "$campaign_state" --campaign-id "$campaign_id" --target-branch release/next >"$work/out" 2>"$work/err"; then
  echo "resume target conflict unexpectedly accepted" >&2
  exit 1
fi
printf 'advanced\n' >"$campaign_repo/advanced.txt"
git -C "$campaign_repo" add advanced.txt
git -C "$campaign_repo" commit -qm advanced
new_target="$work/new-target.json"
"$helper_bin" target-check --repo-path "$campaign_repo" --target-branch main >"$new_target"
observed=$("$helper_bin" campaign-observe --state-dir "$campaign_state" --campaign-id "$campaign_id" --target-receipt "$new_target")
printf '%s\n' "$observed" | jq -e '.current_target_oid == "'"$(jq -r .target_oid "$new_target")"'"' >/dev/null
"$helper_bin" campaign-journal --state-dir "$campaign_state" --campaign-id "$campaign_id" --event no-op-verified --phase verified --status complete >/dev/null
test ! -e "$lock_path"

echo "recovery and resume: PASS"
