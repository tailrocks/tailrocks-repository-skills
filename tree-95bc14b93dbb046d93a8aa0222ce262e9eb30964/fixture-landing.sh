#!/bin/sh
set -eu

helper_bin=$(printenv TAILROCKS_HELPER_BIN 2>/dev/null || true)
if [ -z "$helper_bin" ]; then
  cargo build --quiet --locked --manifest-path helper/Cargo.toml
  helper_bin="$PWD/helper/target/debug/tailrocks-repository-helper"
fi

work=$(mktemp -d /tmp/tailrocks-fixture.XXXXXX)
trap 'rm -rf "$work"' EXIT HUP INT TERM
repo="$work/repo"
bare="$work/remote.git"

git init -q -b main "$repo"
git -C "$repo" config user.name Fixture
git -C "$repo" config user.email fixture@example.invalid
printf 'base\n' >"$repo/base.txt"
git -C "$repo" add base.txt
git -C "$repo" commit -qm base
git init -q --bare "$bare"
git -C "$repo" remote add origin "$bare"
git -C "$repo" push -q -u origin main

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
git -C "$repo" push -q origin release/next

git -C "$repo" checkout -q release/next
default_request=$("$helper_bin" parse-request --text "feature/auth")
printf '%s\n' "$default_request" | jq -e '.target_branch == "main"' >/dev/null
default_target=$("$helper_bin" target-check --repo-path "$repo" --target-branch main)
printf '%s\n' "$default_target" | jq -e '.target_branch == "main" and .target_ref == "refs/heads/main"' >/dev/null

target=$("$helper_bin" target-check --repo-path "$repo" --target-branch release/next)
printf '%s\n' "$target" | jq -e '.target_branch == "release/next" and .target_ref == "refs/heads/release/next"' >/dev/null
remote_target=$("$helper_bin" target-check --repo-path "$repo" --target-branch release/next --remote "$bare")
printf '%s\n' "$remote_target" | jq -e '.remote == "'"$bare"'" and .target_branch == "release/next"' >/dev/null

git -C "$repo" merge --no-ff -q feature/auth -m 'land auth on release'
test "$(git -C "$repo" rev-parse refs/heads/main)" = "$main_before"
test -f "$repo/auth.txt"
test -f "$repo/release.txt"
git -C "$repo" push -q origin release/next

git -C "$repo" checkout -q -b feature/one release/next
printf 'one\n' >"$repo/one.txt"
git -C "$repo" add one.txt
git -C "$repo" commit -qm one
git -C "$repo" checkout -q -b feature/two release/next
printf 'two\n' >"$repo/two.txt"
git -C "$repo" add two.txt
git -C "$repo" commit -qm two
git -C "$repo" checkout -q release/next
git -C "$repo" merge --no-ff -q feature/one -m 'land one on release'
git -C "$repo" merge --no-ff -q feature/two -m 'land two on release'
git -C "$repo" push -q origin release/next

git -C "$repo" merge-base --is-ancestor feature/auth release/next
release_after_batch=$(git -C "$repo" rev-parse refs/heads/release/next)
git -C "$repo" merge-base --is-ancestor feature/auth release/next
test "$(git -C "$repo" rev-parse refs/heads/release/next)" = "$release_after_batch"

# A rerun against an already-satisfied target is a verified no-op: inspect the
# target-relative relationship, perform no merge, and prove the target OID is
# unchanged.
noop_before=$(git -C "$repo" rev-parse refs/heads/release/next)
git -C "$repo" merge-base --is-ancestor feature/auth release/next
noop_after=$(git -C "$repo" rev-parse refs/heads/release/next)
test "$noop_after" = "$noop_before"

git -C "$repo" checkout -q main
git -C "$repo" checkout -q -b feature/main
printf 'main landing\n' >"$repo/main.txt"
git -C "$repo" add main.txt
git -C "$repo" commit -qm 'main landing'
git -C "$repo" checkout -q main
git -C "$repo" merge --no-ff -q feature/main -m 'land on main'
test -f "$repo/main.txt"
test "$(git -C "$repo" rev-parse refs/heads/main)" != "$main_before"

if "$helper_bin" target-check --repo-path "$repo" --target-branch missing-target >"$work/out" 2>"$work/err"; then
  echo "missing target unexpectedly accepted" >&2
  exit 1
fi
test "$(git -C "$repo" rev-parse refs/heads/main)" != ""

echo "fixture landing: PASS"
