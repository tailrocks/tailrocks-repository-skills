#!/bin/sh
set -eu

usage() {
  echo 'usage: assert-owner-preflight.sh <argv-log> <receipt-log> <owner-source-root> <owner-plugin-root> <owner-sha> <bun> <fixture-repo> <repository> <pr> <source-ref> <head> <base-ref> <base> <merge-base> <capture-root>' >&2
  exit 2
}

[ "$#" -eq 15 ] || usage

argv_log=$1
receipt_log=$2
owner_source_root=$3
owner_plugin_root=$4
owner_sha=$5
bun=$6
fixture_repo=$7
repository=$8
pr=$9
shift 9
source_ref=$1
head=$2
base_ref=$3
base=$4
merge_base=$5
capture_root=$6

canonical_directory() {
  [ -d "$1" ] || return 1
  CDPATH= cd -- "$1" && pwd -P
}

require_file() {
  if [ ! -f "$1" ] || [ -L "$1" ]; then
    echo "owner preflight evidence is missing or unsafe: $1" >&2
    exit 1
  fi
}

require_sha() {
  case "$1" in
    *[!0-9a-f]*|'') echo "invalid expected $2 SHA" >&2; exit 1 ;;
  esac
  [ "${#1}" -eq 40 ] || { echo "invalid expected $2 SHA length" >&2; exit 1; }
}

require_sha "$owner_sha" owner
require_sha "$head" head
require_sha "$base" base
require_sha "$merge_base" merge-base
[ "$owner_sha" = '2b4f71f49fd27061e64d16b2b7f83d9bd2df5612' ] || {
  echo 'owner evidence must bind the reviewed lifecycle owner pin' >&2
  exit 1
}
case "$pr" in
  ''|*[!0-9]*) echo 'expected PR number must be a positive integer' >&2; exit 1 ;;
esac
[ "$pr" -gt 0 ] || { echo 'expected PR number must be positive' >&2; exit 1; }

owner_source_root=$(canonical_directory "$owner_source_root") || {
  echo 'pinned owner source checkout is unavailable' >&2
  exit 1
}
owner_plugin_root=$(canonical_directory "$owner_plugin_root") || {
  echo 'installed owner archive is unavailable' >&2
  exit 1
}
fixture_repo=$(canonical_directory "$fixture_repo") || {
  echo 'disposable preflight repository is unavailable' >&2
  exit 1
}
capture_root=$(canonical_directory "$capture_root") || {
  echo 'owner output capture root is unavailable' >&2
  exit 1
}
case "$repository" in
  */*) ;;
  *) echo 'expected repository must be owner/name' >&2; exit 1 ;;
esac
case "$source_ref:$base_ref" in
  *[!A-Za-z0-9_./:-]*|:*) echo 'expected local refs contain unsafe characters' >&2; exit 1 ;;
esac

source_head=$(git -C "$owner_source_root" rev-parse --verify 'HEAD^{commit}')
[ "$source_head" = "$owner_sha" ] || {
  echo "pinned owner checkout changed: expected $owner_sha, found $source_head" >&2
  exit 1
}
owner_status=$(git -C "$owner_source_root" status --porcelain=v2 --untracked-files=all)
[ -z "$owner_status" ] || {
  echo 'pinned owner checkout has local changes; refusing to attribute this result to the pin' >&2
  exit 1
}

for owner_file in \
  scripts/merge-preflight.ts \
  scripts/bounded-command.ts \
  scripts/documentation-discovery.ts; do
  require_file "$owner_plugin_root/$owner_file"
  git -C "$owner_source_root" cat-file -e "$owner_sha:$owner_file"
  if ! git -C "$owner_source_root" show "$owner_sha:$owner_file" | cmp -s - "$owner_plugin_root/$owner_file"; then
    echo "installed owner archive differs from pinned implementation: $owner_file" >&2
    exit 1
  fi
done

require_file "$argv_log"
require_file "$receipt_log"
capture_dir=$(jq -er -s 'if length == 1 then .[0].capture_directory else error("expected one receipt") end' "$receipt_log")
capture_dir=$(canonical_directory "$capture_dir") || {
  echo 'retained owner output capture is unavailable' >&2
  exit 1
}
case "$capture_dir" in
  "$capture_root"/preflight.*) ;;
  *) echo 'owner output capture escaped its exact owned root' >&2; exit 1 ;;
esac
require_file "$capture_dir/.tailrocks-owned"
require_file "$capture_dir/stdout"
require_file "$capture_dir/stderr"
[ "$(cat "$capture_dir/.tailrocks-owned")" = "tailrocks-owner-preflight:$capture_dir" ] || {
  echo 'owner output capture ownership marker does not match its exact path' >&2
  exit 1
}
if ! jq -jr -s '.[0].stdout' "$receipt_log" | cmp -s - "$capture_dir/stdout"; then
  echo 'retained Bun stdout differs from the raw owner receipt log' >&2
  exit 1
fi
if ! jq -jr -s '.[0].stderr' "$receipt_log" | cmp -s - "$capture_dir/stderr"; then
  echo 'retained Bun stderr differs from the raw owner receipt log' >&2
  exit 1
fi
expected_bun=$(CDPATH= cd -- "$(dirname -- "$bun")" && pwd -P)/$(basename -- "$bun")
expected_owner_entrypoint="$owner_plugin_root/scripts/merge-preflight.ts"
expected_root_head=$(git -C "$fixture_repo" rev-parse --verify "refs/heads/$source_ref^{commit}")
expected_root_base=$(git -C "$fixture_repo" rev-parse --verify "refs/heads/$base_ref^{commit}")
expected_root_head_checkout=$(git -C "$fixture_repo" rev-parse --verify 'HEAD^{commit}')
actual_merge_base=$(git -C "$fixture_repo" merge-base "$expected_root_base" "$expected_root_head")
[ "$expected_root_head" = "$head" ] || { echo 'fixture source ref differs from expected PR head' >&2; exit 1; }
[ "$expected_root_base" = "$base" ] || { echo 'fixture base ref differs from expected PR base' >&2; exit 1; }
[ "$expected_root_head_checkout" = "$head" ] || { echo 'fixture checkout is not the expected PR head' >&2; exit 1; }
[ "$actual_merge_base" = "$merge_base" ] || { echo 'fixture merge base differs from expected PR merge base' >&2; exit 1; }

jq -e -s \
  --arg bun "$expected_bun" \
  --arg cwd "$fixture_repo" \
  --arg entrypoint "$expected_owner_entrypoint" \
  --arg owner "$owner_plugin_root" \
  --arg sha "$owner_sha" \
  --arg pr "$pr" \
  --arg repo "$repository" \
  --arg head "$head" \
  --arg base "$base" \
  --arg merge_base "$merge_base" '
    [ .[] | select(.script == "merge-preflight.ts") ] as $preflight |
    [ .[] | select(.script == "merge-pr.ts") ] as $merge |
    length >= 1 and
    ($preflight | length) == 1 and
    ($merge | length) == 0 and
    all(.[]; .executable == $bun and .cwd == $cwd and .blocked == false) and
    $preflight[0].entrypoint == $entrypoint and
    ($preflight[0].argv | index("--no-poll")) != null and
    ($preflight[0].argv | index("--root")) as $root_index |
    ($root_index != null) and $preflight[0].argv[$root_index + 1] == $cwd and
    ($preflight[0].argv | index("--pr")) as $pr_index |
    ($pr_index != null) and $preflight[0].argv[$pr_index + 1] == $pr
  ' "$argv_log" >/dev/null || {
  echo 'Bun argv trace does not prove one exact pinned-owner preflight and zero merge entrypoints' >&2
  exit 1
}

jq -e -s \
  --arg cwd "$fixture_repo" \
  --arg owner "$owner_plugin_root" \
  --arg sha "$owner_sha" \
  --arg entrypoint "$expected_owner_entrypoint" \
  --arg capture_dir "$capture_dir" \
  --arg repo "$repository" \
  --arg pr "$pr" \
  --arg head "$head" \
  --arg base "$base" \
  --arg merge_base "$merge_base" '
    length == 1 and
    .[0].cwd == $cwd and
    .[0].owner_root == $owner and
    .[0].owner_sha == $sha and
    .[0].entrypoint == $entrypoint and
    .[0].capture_directory == $capture_dir and
    .[0].exit_status == 8 and
    .[0].stderr == "" and
    ([.[0].stdout | split("\n")[] | select(length > 0)] | length) == 1 and
    (.[0].stdout | fromjson) as $receipt |
    ($receipt | keys) == ["base","checkAttempts","checks","code","commands","delivery","detail","documentation","head","mergeBase","outcome","pr","repository","schema"] and
    $receipt.schema == "tailrocks.merge-preflight/v1" and
    $receipt.outcome == "pending" and
    $receipt.code == "checks_pending" and
    $receipt.repository == $repo and
    $receipt.pr == ($pr | tonumber) and
    $receipt.head == $head and
    $receipt.base == $base and
    $receipt.mergeBase == $merge_base and
    $receipt.checkAttempts == 1 and
    $receipt.detail == "required checks remain pending at the polling bound" and
    $receipt.delivery.status == "not_applicable" and
    (
      ($receipt.documentation.status == "not_needed" and
       $receipt.documentation.headCovered == true and
       ($receipt.documentation.docWorthyCommits | length) == 0) or
      ($receipt.documentation.status == "pass" and $receipt.documentation.headCovered == true)
    ) and
    ($receipt.checks | length) == 1 and
    ($receipt.checks[0] | keys) == ["bucket","link","name","state","workflow"] and
    $receipt.checks[0].name == "required-ci" and
    $receipt.checks[0].bucket == "pending" and
    $receipt.checks[0].state == "in_progress" and
    ($receipt.commands | map(select(.[0:3] == ["gh","pr","checks"])) | length) == 1 and
    any($receipt.commands[];
      .[0:3] == ["gh","pr","checks"] and
      .[3] == $pr and
      (index("--repo") as $repo_index | $repo_index != null and .[$repo_index + 1] == $repo) and
      (index("--required") != null) and
      (index("--json") as $json_index | $json_index != null and .[$json_index + 1] == "bucket,link,name,state,workflow")
    )
  ' "$receipt_log" >/dev/null || {
  echo 'captured owner stdout/status does not prove the real pending-CI preflight receipt' >&2
  exit 1
}

printf '%s\n' 'pinned owner preflight: PASS (actual local stdout/status, synthetic GH fixture; pending CI, one attempt, no merge invocation)'
