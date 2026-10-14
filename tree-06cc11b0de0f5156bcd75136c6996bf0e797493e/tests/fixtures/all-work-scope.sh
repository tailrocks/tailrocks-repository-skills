#!/bin/sh
set -eu

# Shared preflight guard for all-work scan roots. The installed-agent fixture
# sources this function; the standalone run below exercises it without auth.
tailrocks_all_work_scope_guard() {
  tailrocks_scope_work=$1
  tailrocks_scope_cwd=$2
  tailrocks_scope_scan=$3
  tailrocks_scope_state=$4
  tailrocks_scope_tmp=$5

  for tailrocks_scope_pair in \
    "work:$tailrocks_scope_work" \
    "cwd:$tailrocks_scope_cwd" \
    "scan:$tailrocks_scope_scan" \
    "state:$tailrocks_scope_state" \
    "tmp:$tailrocks_scope_tmp"; do
    tailrocks_scope_label=${tailrocks_scope_pair%%:*}
    tailrocks_scope_path=${tailrocks_scope_pair#*:}
    [ -d "$tailrocks_scope_path" ] || {
      echo "BLOCKED: all-work $tailrocks_scope_label root is not an existing directory: $tailrocks_scope_path" >&2
      return 2
    }
    tailrocks_scope_canonical=$(CDPATH= cd -- "$tailrocks_scope_path" && pwd -P) || return 2
    case "$tailrocks_scope_canonical" in
      "$tailrocks_scope_work"|"$tailrocks_scope_work"/*) ;;
      *)
        echo "BLOCKED: all-work $tailrocks_scope_label root is outside the owned fixture root: $tailrocks_scope_canonical" >&2
        return 2
        ;;
    esac
  done

  for tailrocks_scope_writable in \
    "$tailrocks_scope_cwd" \
    "$tailrocks_scope_state" \
    "$tailrocks_scope_tmp" \
    "$tailrocks_scope_cwd/plugins" \
    "$tailrocks_scope_cwd/.agents/plugins" \
    "$tailrocks_scope_cwd/.codex"; do
    case "$tailrocks_scope_scan" in
      "$tailrocks_scope_writable"|"$tailrocks_scope_writable"/*)
        echo "BLOCKED: all-work scan root overlaps an authorized writable root: $tailrocks_scope_writable" >&2
        return 2
        ;;
    esac
    case "$tailrocks_scope_writable" in
      "$tailrocks_scope_scan"|"$tailrocks_scope_scan"/*)
        echo "BLOCKED: all-work authorized writable root overlaps the scan root: $tailrocks_scope_writable" >&2
        return 2
        ;;
    esac
  done
}

run_all_work_scope_contract() {
  tmp_root=$(CDPATH= cd -- "${TMPDIR:-/tmp}" && pwd -P)
  work=$(mktemp -d "$tmp_root/tailrocks-all-work-scope.XXXXXX")
  outside=$(mktemp -d "$tmp_root/tailrocks-all-work-outside.XXXXXX")

  fail() {
    printf 'all-work scope contract: FAIL: %s\n' "$*" >&2
    exit 1
  }

  cleanup() {
    exit_status=$?
    trap - EXIT HUP INT TERM
    case "$work" in
      "$tmp_root"/tailrocks-all-work-scope.*)
        rm -rf -- "$work"
        ;;
      *)
        printf 'all-work scope contract: refusing to remove unexpected path: %s\n' "$work" >&2
        exit_status=1
        ;;
    esac
    case "$outside" in
      "$tmp_root"/tailrocks-all-work-outside.*)
        rm -rf -- "$outside"
        ;;
      *)
        printf 'all-work scope contract: refusing to remove unexpected path: %s\n' "$outside" >&2
        exit_status=1
        ;;
    esac
    exit "$exit_status"
  }
  trap cleanup EXIT HUP INT TERM

  project="$work/project"
  state="$work/state"
  task_tmp="$work/task-tmp"
  declared_root="$work/declared-root"
  home_decoy="$outside/home"
  mkdir -p "$project" "$state" "$task_tmp" "$declared_root" "$home_decoy"
  printf '%s\n' declared >"$declared_root/declared.marker"
  printf '%s\n' home >"$home_decoy/home.marker"

  expect_blocked() {
    scope_label=$1
    attempted_root=$2
    if tailrocks_all_work_scope_guard "$work" "$project" "$attempted_root" "$state" "$task_tmp" \
      >"$work/$scope_label.stdout" 2>"$work/$scope_label.stderr"; then
      fail "$scope_label scan root was accepted without a declared authorized root"
    fi
    grep -F -q -- 'BLOCKED:' "$work/$scope_label.stderr" ||
      fail "$scope_label rejection did not produce a safety receipt"
  }

  # The implicit project root, broad fixture root, home-like root, and OS root are rejected.
  expect_blocked implicit "$project"
  expect_blocked broad "$work"
  expect_blocked home "$home_decoy"
  expect_blocked os /

  tailrocks_all_work_scope_guard "$work" "$project" "$declared_root" "$state" "$task_tmp" ||
    fail 'declared scan root was rejected'

  scan_results=$(find "$declared_root" -type f -print | sort)
  [ "$scan_results" = "$declared_root/declared.marker" ] ||
    fail "declared-root scan escaped its scope: $scan_results"
  if printf '%s\n' "$scan_results" | grep -F -q -- "$home_decoy"; then
    fail 'declared-root scan reported a home-decoy path'
  fi

  printf 'all-work scope contract: PASS (implicit, broad, home, and OS roots blocked; declared fixture root only scanned)\n'
}

if [ "${TAILROCKS_ALL_WORK_SCOPE_LIBRARY:-0}" != 1 ]; then
  run_all_work_scope_contract
fi
