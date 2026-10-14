#!/bin/sh
set -eu

tmp_root=$(CDPATH= cd -- "${TMPDIR:-/tmp}" && pwd -P)
work=$(mktemp -d "$tmp_root/tailrocks-cleanup-cas.XXXXXX")

fail() {
  printf 'cleanup CAS contract: FAIL: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  exit_status=$?
  trap - EXIT HUP INT TERM
  case "$work" in
    "$tmp_root"/tailrocks-cleanup-cas.*)
      rm -rf -- "$work"
      ;;
    *)
      printf 'cleanup CAS contract: refusing to remove unexpected path: %s\n' "$work" >&2
      exit_status=1
      ;;
  esac
  exit "$exit_status"
}
trap cleanup EXIT HUP INT TERM

repo="$work/repository"
mkdir -p "$repo"
git -C "$repo" init -q -b main
git -C "$repo" config user.name 'Disposable Fixture'
git -C "$repo" config user.email fixture@example.invalid

printf '%s\n' base >"$repo/README.md"
git -C "$repo" add README.md
git -C "$repo" commit -qm 'fixture base'
git -C "$repo" checkout -q -b feature/resolved main

printf '%s\n' source-v1 >"$repo/resolved.txt"
git -C "$repo" add resolved.txt
git -C "$repo" commit -qm 'fixture selected source'
expected_oid=$(git -C "$repo" rev-parse refs/heads/feature/resolved)

# A concurrent writer replaces the selected source after its expected OID was read.
printf '%s\n' source-v2 >"$repo/resolved.txt"
git -C "$repo" add resolved.txt
git -C "$repo" commit -qm 'fixture source replacement'
replacement_oid=$(git -C "$repo" rev-parse refs/heads/feature/resolved)
[ "$replacement_oid" != "$expected_oid" ] || fail 'replacement fixture did not move the source OID'

if git -C "$repo" update-ref -d refs/heads/feature/resolved "$expected_oid" \
  >"$work/stale-delete.stdout" 2>"$work/stale-delete.stderr"; then
  fail 'stale expected OID unexpectedly deleted the replaced source ref'
fi
actual_oid=$(git -C "$repo" rev-parse refs/heads/feature/resolved)
[ "$actual_oid" = "$replacement_oid" ] || fail 'CAS rejection changed the replacement source ref'
grep -F -q -- 'expected' "$work/stale-delete.stderr" ||
  fail 'Git did not report the expected-OID mismatch'

git -C "$repo" update-ref -d refs/heads/feature/resolved "$replacement_oid"
if git -C "$repo" show-ref --verify --quiet refs/heads/feature/resolved; then
  fail 'matching expected OID did not delete the selected source ref'
fi

printf 'cleanup CAS contract: PASS (stale expected OID retained replacement; matching OID deleted only selected ref)\n'
