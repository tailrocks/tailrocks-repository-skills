#!/bin/sh
set -eu

: "${TAILROCKS_REAL_BUN:?owner-fixture shim needs the resolved Bun executable}"
: "${TAILROCKS_BUN_ARGV_LOG:?owner-fixture shim needs its isolated argv log}"

required_owner_sha=2b4f71f49fd27061e64d16b2b7f83d9bd2df5612

current_cwd=$(pwd -P)
entrypoint=
entrypoint_kind=other
entrypoint_count=0
for argument do
  case "$argument" in
    scripts/merge-preflight.ts|*/scripts/merge-preflight.ts)
      entrypoint=$argument
      entrypoint_kind=merge-preflight.ts
      entrypoint_count=$((entrypoint_count + 1))
      ;;
    scripts/merge-pr.ts|*/scripts/merge-pr.ts)
      entrypoint=$argument
      entrypoint_kind=merge-pr.ts
      entrypoint_count=$((entrypoint_count + 1))
      ;;
  esac
done

log_argv_posix() {
  logged_blocked=$1
  shift
  jq -cn \
    --arg executable "$TAILROCKS_REAL_BUN" \
    --arg cwd "$current_cwd" \
    --arg script "$entrypoint_kind" \
    --arg entrypoint "$entrypoint" \
    --argjson blocked "$logged_blocked" \
    --args \
    '{executable:$executable,cwd:$cwd,script:$script,entrypoint:$entrypoint,blocked:$blocked,argv:$ARGS.positional}' \
    -- "$@" >>"$TAILROCKS_BUN_ARGV_LOG"
}

canonical_directory() {
  [ -d "$1" ] || return 1
  CDPATH= cd -- "$1" && pwd -P
}

require_owner_fixture_environment() {
  : "${TAILROCKS_OWNER_PLUGIN_ROOT:?owner fixture needs its installed plugin root}"
  : "${TAILROCKS_OWNER_EXPECTED_SHA:?owner fixture needs its pinned source SHA}"
  : "${TAILROCKS_OWNER_EXPECTED_CWD:?owner fixture needs its exact disposable repository root}"
  : "${TAILROCKS_OWNER_RECEIPTS_LOG:?owner fixture needs its isolated receipt log}"
  : "${TAILROCKS_OWNER_CAPTURE_ROOT:?owner fixture needs its isolated capture root}"
  : "${TAILROCKS_OWNER_WORK_ROOT:?owner fixture needs its owned work root}"
  : "${TAILROCKS_OWNER_GH_SHIM:?owner fixture needs its exact synthetic gh shim}"
  : "${TAILROCKS_OWNER_GH_SHIM_SOURCE:?owner fixture needs the gh shim source}"
  : "${TAILROCKS_OWNER_GIT_SHIM:?owner fixture needs its exact guarded git shim}"
  : "${TAILROCKS_OWNER_GIT_SHIM_SOURCE:?owner fixture needs the git shim source}"

  [ "${GH_FIXTURE_KIND:-}" = blocked ] &&
    [ -n "${TAILROCKS_GH_FIXTURE_DIR:-}" ] &&
    [ -n "${TAILROCKS_GH_FIXTURE_REPO:-}" ] || {
    echo 'BLOCKED: owner preflight requires the local pending-CI GitHub fixture' >&2
    return 1
  }

  case "$TAILROCKS_OWNER_EXPECTED_SHA" in
    *[!0-9a-f]*|'') echo 'BLOCKED: owner pin must be a full lowercase commit SHA' >&2; return 1 ;;
  esac
  [ "${#TAILROCKS_OWNER_EXPECTED_SHA}" -eq 40 ] || {
    echo 'BLOCKED: owner pin must be a full 40-character commit SHA' >&2
    return 1
  }
  [ "$TAILROCKS_OWNER_EXPECTED_SHA" = "$required_owner_sha" ] || {
    echo 'BLOCKED: owner acceptance requires the reviewed lifecycle owner pin' >&2
    return 1
  }
  [ ! -L "$TAILROCKS_OWNER_PLUGIN_ROOT" ] &&
    [ ! -L "$TAILROCKS_OWNER_WORK_ROOT" ] &&
    [ ! -L "$TAILROCKS_OWNER_CAPTURE_ROOT" ] || {
    echo 'BLOCKED: owner fixture roots may not be symlinks' >&2
    return 1
  }

  owner_root=$(canonical_directory "$TAILROCKS_OWNER_PLUGIN_ROOT") || {
    echo 'BLOCKED: installed owner plugin root is unavailable' >&2
    return 1
  }
  expected_cwd=$(canonical_directory "$TAILROCKS_OWNER_EXPECTED_CWD") || {
    echo 'BLOCKED: expected owner root is unavailable' >&2
    return 1
  }
  work_root=$(canonical_directory "$TAILROCKS_OWNER_WORK_ROOT") || {
    echo 'BLOCKED: owned acceptance work root is unavailable' >&2
    return 1
  }
  capture_root=$(canonical_directory "$TAILROCKS_OWNER_CAPTURE_ROOT") || {
    echo 'BLOCKED: owner output capture root is unavailable' >&2
    return 1
  }
  case "$owner_root" in
    "$work_root"/*) ;;
    *) echo "BLOCKED: installed owner plugin escaped the owned fixture: $owner_root" >&2; return 1 ;;
  esac
  case "$capture_root" in
    "$work_root"/*) ;;
    *) echo "BLOCKED: owner capture root escaped the owned fixture: $capture_root" >&2; return 1 ;;
  esac
  [ "$expected_cwd" = "$TAILROCKS_OWNER_EXPECTED_CWD" ] || {
    echo 'BLOCKED: expected owner cwd must already be canonical' >&2
    return 1
  }
  [ "$current_cwd" = "$expected_cwd" ] || {
    echo "BLOCKED: owner preflight cwd differs from disposable target: $current_cwd" >&2
    return 1
  }
  [ "$TAILROCKS_GH_FIXTURE_REPO" = "$expected_cwd" ] || {
    echo 'BLOCKED: synthetic GitHub fixture is bound to a different local repository' >&2
    return 1
  }

  expected_script="$owner_root/scripts/merge-preflight.ts"
  [ "$entrypoint_count" -eq 1 ] && [ "$entrypoint" = "$expected_script" ] || {
    echo 'BLOCKED: owner preflight must use the exact absolute entrypoint from the pinned installed plugin' >&2
    return 1
  }
  [ -f "$expected_script" ] && [ ! -L "$expected_script" ] || {
    echo 'BLOCKED: pinned owner preflight entrypoint is not a regular non-symlink file' >&2
    return 1
  }

  owner_command_root=$(command -v gh 2>/dev/null || true)
  [ "$owner_command_root" = "$TAILROCKS_OWNER_GH_SHIM" ] || {
    echo 'BLOCKED: owner preflight must use the exact synthetic gh fixture shim' >&2
    return 1
  }
  owner_command_root=$(command -v git 2>/dev/null || true)
  [ "$owner_command_root" = "$TAILROCKS_OWNER_GIT_SHIM" ] || {
    echo 'BLOCKED: owner preflight must use the exact push-guarded git fixture shim' >&2
    return 1
  }
  [ ! -L "$TAILROCKS_OWNER_GH_SHIM" ] && [ ! -L "$TAILROCKS_OWNER_GIT_SHIM" ] || {
    echo 'BLOCKED: owner fixture command shims may not be symlinks' >&2
    return 1
  }
  cmp -s "$TAILROCKS_OWNER_GH_SHIM_SOURCE" "$TAILROCKS_OWNER_GH_SHIM" || {
    echo 'BLOCKED: synthetic gh shim differs from its reviewed fixture source' >&2
    return 1
  }
  cmp -s "$TAILROCKS_OWNER_GIT_SHIM_SOURCE" "$TAILROCKS_OWNER_GIT_SHIM" || {
    echo 'BLOCKED: guarded git shim differs from its reviewed fixture source' >&2
    return 1
  }
}

if [ "$entrypoint_kind" = merge-pr.ts ]; then
  log_argv_posix true "$@"
  echo 'BLOCKED: fixture refuses to execute the merge owner mutation entrypoint' >&2
  exit 69
fi

if [ "$entrypoint_kind" != merge-preflight.ts ]; then
  log_argv_posix false "$@"
  exec "$TAILROCKS_REAL_BUN" "$@"
fi

log_argv_posix false "$@"
if [ "$entrypoint_count" -ne 1 ]; then
  echo 'BLOCKED: owner preflight command contains multiple lifecycle entrypoints' >&2
  exit 69
fi
require_owner_fixture_environment || exit 69

root_argument=
pr_argument=
no_poll=0
root_count=0
pr_count=0
no_poll_count=0
expect_value=
for argument do
  if [ -n "$expect_value" ]; then
    case "$expect_value" in
      --root) root_argument=$argument; root_count=$((root_count + 1)) ;;
      --pr) pr_argument=$argument; pr_count=$((pr_count + 1)) ;;
    esac
    expect_value=
    continue
  fi
  case "$argument" in
    --root|--pr) expect_value=$argument ;;
    --no-poll) no_poll=1; no_poll_count=$((no_poll_count + 1)) ;;
    --poll-with-static-blockers)
      echo 'BLOCKED: owner acceptance preflight must use --no-poll without static-blocker polling' >&2
      exit 69
      ;;
  esac
done
[ -z "$expect_value" ] &&
  [ "$root_count" -eq 1 ] &&
  [ "$pr_count" -eq 1 ] &&
  [ "$no_poll" -eq 1 ] &&
  [ "$no_poll_count" -eq 1 ] &&
  [ "$root_argument" = "$expected_cwd" ] &&
  [ "$pr_argument" = "${TAILROCKS_OWNER_EXPECTED_PR:-}" ] || {
  echo 'BLOCKED: owner preflight must bind exact disposable root and PR with --no-poll' >&2
  exit 69
}

[ -n "${TAILROCKS_OWNER_EXPECTED_REPOSITORY:-}" ] &&
  [ -n "${TAILROCKS_OWNER_EXPECTED_PR:-}" ] &&
  [ -n "${TAILROCKS_OWNER_EXPECTED_HEAD:-}" ] &&
  [ -n "${TAILROCKS_OWNER_EXPECTED_BASE:-}" ] &&
  [ -n "${TAILROCKS_OWNER_EXPECTED_MERGE_BASE:-}" ] || {
  echo 'BLOCKED: exact expected repository/PR/head/base/merge-base are required for owner acceptance' >&2
  exit 69
}

capture_parent=$(dirname -- "$TAILROCKS_OWNER_RECEIPTS_LOG")
capture_parent=$(canonical_directory "$capture_parent") || {
  echo 'BLOCKED: owner receipt log parent is unavailable' >&2
  exit 69
}
case "$capture_parent" in
  "$work_root"|"$work_root"/*) ;;
  *) echo 'BLOCKED: owner receipt log escaped the owned fixture' >&2; exit 69 ;;
esac
[ ! -L "$TAILROCKS_OWNER_RECEIPTS_LOG" ] || {
  echo 'BLOCKED: owner receipt log may not be a symlink' >&2
  exit 69
}

capture_dir=$(mktemp -d "$capture_root/preflight.XXXXXXXX") || {
  echo 'BLOCKED: could not allocate a unique owner output capture root' >&2
  exit 69
}
capture_dir=$(canonical_directory "$capture_dir") || {
  echo 'BLOCKED: owner output capture root could not be canonicalized' >&2
  exit 69
}
case "$capture_dir" in
  "$capture_root"/preflight.*) ;;
  *) echo 'BLOCKED: owner output capture escaped its exact owned root' >&2; exit 69 ;;
esac
printf '%s\n' "tailrocks-owner-preflight:$capture_dir" >"$capture_dir/.tailrocks-owned"

command_status=0
if "$TAILROCKS_REAL_BUN" "$@" >"$capture_dir/stdout" 2>"$capture_dir/stderr"; then
  command_status=0
else
  command_status=$?
fi

# Forward the real process streams, then preserve both streams and exact exit
# status in the isolated receipt log. Command substitution is intentionally
# avoided so trailing newlines and diagnostics remain intact.
cat "$capture_dir/stdout"
cat "$capture_dir/stderr" >&2
jq -cn \
  --arg cwd "$current_cwd" \
  --arg owner_root "$owner_root" \
  --arg owner_sha "$TAILROCKS_OWNER_EXPECTED_SHA" \
  --arg entrypoint "$entrypoint" \
  --arg capture_directory "$capture_dir" \
  --argjson exit_status "$command_status" \
  --rawfile stdout "$capture_dir/stdout" \
  --rawfile stderr "$capture_dir/stderr" \
  '{cwd:$cwd,owner_root:$owner_root,owner_sha:$owner_sha,entrypoint:$entrypoint,capture_directory:$capture_directory,exit_status:$exit_status,stdout:$stdout,stderr:$stderr}' \
  >>"$TAILROCKS_OWNER_RECEIPTS_LOG"

exit "$command_status"
