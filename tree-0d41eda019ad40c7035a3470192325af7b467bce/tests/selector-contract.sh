#!/bin/sh
set -eu

helper_bin=$(printenv TAILROCKS_HELPER_BIN 2>/dev/null || true)
if [ -z "$helper_bin" ]; then
  cargo build --quiet --locked --manifest-path helper/Cargo.toml
  helper_bin="$PWD/helper/target/debug/tailrocks-repository-helper"
fi

work=$(mktemp -d /tmp/tailrocks-selector.XXXXXX)
trap 'rm -rf "$work"' EXIT HUP INT TERM

request=$("$helper_bin" parse-request --text "--target-branch=release/next #1663 #1663 branch:1145 https://github.com/acme/one/pulls?state=open&page=2#results")
printf '%s\n' "$request" | jq -e '
  .target_branch == "release/next" and
  (.sources | length == 3)
' >/dev/null
printf '%s\n' "$request" | jq -e '
  .repository == "acme/one" and
  (.sources | map(select(.kind == "pull-request")) | length == 1) and
  (.sources | map(select(.branch == "1145")) | length == 1) and
  (.sources | map(select(.kind == "pulls-url"))[0].query == "state=open&page=2") and
  (.sources | map(select(.kind == "pulls-url"))[0].fragment == "results")
' >/dev/null
printf '%s\n' "$request" | jq -e '
  (.sources | map(select(.kind == "pull-request"))[0].provenance) == ["#1663", "#1663"]
' >/dev/null

request=$("$helper_bin" parse-request --text "feature/auth")
printf '%s\n' "$request" | jq -e '
  .target_branch == "main" and
  .target_explicit == false and
  .sources[0].branch == "feature/auth" and
  .sources[0].canonical == "branch:feature/auth"
' >/dev/null

request=$("$helper_bin" parse-request --text "--repo=acme/one --target-branch=main refs/heads/feature/auth origin/feature/auth branch:1145 1145 pr:12 https://github.com/acme/one/pull/12?view=files#discussion https://github.com/acme/one/branches/all?state=all&page=2")
printf '%s\n' "$request" | jq -e '
  .repository == "acme/one" and
  (.sources | map(select(.kind == "branch" and .branch == "feature/auth")) | length == 2) and
  (.sources | map(select(.branch == "1145")) | length == 1) and
  (.sources | map(select(.kind == "branches-all-url"))[0].query == "state=all&page=2") and
  any(.sources[]; (.provenance | index("https://github.com/acme/one/pull/12?view=files#discussion")) != null)
' >/dev/null

request=$("$helper_bin" parse-request --text "'feature;rm'")
printf '%s\n' "$request" | jq -e '.sources[0].raw == "feature;rm"' >/dev/null
for invalid in "bad..ref" "-bad"; do
  if "$helper_bin" parse-request --text "$invalid" >"$work/out" 2>"$work/err"; then
    echo "invalid selector unexpectedly accepted: $invalid" >&2
    exit 1
  fi
done

if "$helper_bin" parse-request --text "--target-branch=one --target-branch=two feature" >"$work/out" 2>"$work/err"; then
  echo "duplicate target unexpectedly accepted" >&2
  exit 1
fi
if "$helper_bin" parse-request --text "" >"$work/out" 2>"$work/err"; then
  echo "empty source set unexpectedly accepted" >&2
  exit 1
fi
if "$helper_bin" parse-request --text "https://github.com/acme/one/pull/1 https://github.com/acme/two/pull/2" >"$work/out" 2>"$work/err"; then
  echo "mixed repositories unexpectedly accepted" >&2
  exit 1
fi

echo "selector contract: PASS"
