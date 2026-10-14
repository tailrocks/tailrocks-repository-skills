#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
client=${TAILROCKS_AGENT_CLIENT:-}
selected_case=${TAILROCKS_AGENT_CASE:-all}
keep_work=${TAILROCKS_KEEP_ACCEPTANCE_WORK:-0}
case "$selected_case" in
  all|blocked-owner-preflight) ;;
  *)
    echo "usage: TAILROCKS_AGENT_CASE=all|blocked-owner-preflight (got: $selected_case)" >&2
    exit 2
    ;;
esac
if [ "${TAILROCKS_AGENT_E2E:-}" != "1" ]; then
  echo "BLOCKED: set TAILROCKS_AGENT_E2E=1 to authorize local model/network acceptance" >&2
  exit 2
fi
if [ "$client" = "claude" ]; then
  if [ "$selected_case" != "all" ]; then
    echo "BLOCKED: selected Codex fixture case is unavailable on the Claude install-only route" >&2
    exit 2
  fi
  pinned_pr_skills_sha=2b4f71f49fd27061e64d16b2b7f83d9bd2df5612
  if [ -z "${TAILROCKS_PR_SKILLS_ROOT:-}" ]; then
    echo "BLOCKED: Claude install route requires an explicit TAILROCKS_PR_SKILLS_ROOT for the pinned PR-lifecycle owner checkout" >&2
    exit 2
  fi
  if [ "${TAILROCKS_PR_SKILLS_SHA:-}" != "$pinned_pr_skills_sha" ]; then
    echo "BLOCKED: Claude install route accepts only pinned PR-lifecycle owner SHA $pinned_pr_skills_sha" >&2
    exit 2
  fi

  TAILROCKS_PR_SKILLS_ROOT="$TAILROCKS_PR_SKILLS_ROOT" \
    TAILROCKS_PR_SKILLS_SHA="$pinned_pr_skills_sha" \
    TAILROCKS_KEEP_CLAUDE_INSTALL_WORK=1 \
    sh "$repo_root/tests/claude-install-acceptance.sh"
  echo "BLOCKED: Claude native plugin installation is verified, but this route is install-only; isolated auth is unavailable, so no model invocation or Claude end-to-end pass is recorded." >&2
  exit 2
fi
if [ "$client" != "codex" ]; then
  echo "usage: TAILROCKS_AGENT_E2E=1 TAILROCKS_AGENT_CLIENT=codex [TAILROCKS_AGENT_CASE=all|blocked-owner-preflight] tests/agent-acceptance.sh" >&2
  exit 2
fi

codex_bin=$(command -v codex) || {
  echo "BLOCKED: Codex CLI is not installed" >&2
  exit 2
}
codex_home=${CODEX_HOME:-${HOME:?HOME must be set to locate Codex authentication}}
codex_home=$(CDPATH= cd -- "$codex_home" && pwd -P)
codex_tmp_root=$(CDPATH= cd -- "${TMPDIR:-/tmp}" && pwd -P)
codex_cli_path=${PATH:-/usr/bin:/bin}
codex_cli_lang=${LANG:-C}
codex_cli_lc_all=${LC_ALL:-C}
codex_cli_term=${TERM:-dumb}

run_codex_cli() {
  cli_home=$1
  cli_codex_home=$2
  cli_tmpdir=$3
  cli_probe_path=$4
  cli_profile=$5
  shift 5
  if [ "$cli_profile" = "probe" ] && [ -n "$cli_probe_path" ]; then
    env -i \
      HOME="$cli_home" \
      CODEX_HOME="$cli_codex_home" \
      PATH="$codex_cli_path" \
      TMPDIR="$cli_tmpdir" \
      LANG="$codex_cli_lang" \
      LC_ALL="$codex_cli_lc_all" \
      TERM="$codex_cli_term" \
      PROBE_PATH="$cli_probe_path" \
      "$codex_bin" "$@"
  elif [ "$cli_profile" = "fixture" ]; then
    env -i \
      HOME="$cli_home" \
      CODEX_HOME="$cli_codex_home" \
      PATH="$codex_cli_path" \
      TMPDIR="$cli_tmpdir" \
      LANG="$codex_cli_lang" \
      LC_ALL="$codex_cli_lc_all" \
      TERM="$codex_cli_term" \
      GIT_OPTIONAL_LOCKS=0 \
      TAILROCKS_REAL_GIT="${TAILROCKS_REAL_GIT:-}" \
      TAILROCKS_GIT_SHIM_LOG="${TAILROCKS_GIT_SHIM_LOG:-}" \
      TAILROCKS_GH_FIXTURE_DIR="${TAILROCKS_GH_FIXTURE_DIR:-}" \
      TAILROCKS_GH_FIXTURE_LOG="${TAILROCKS_GH_FIXTURE_LOG:-}" \
      TAILROCKS_REAL_FIND="${TAILROCKS_REAL_FIND:-}" \
      TAILROCKS_REAL_RG="${TAILROCKS_REAL_RG:-}" \
      TAILROCKS_REAL_FD="${TAILROCKS_REAL_FD:-}" \
      TAILROCKS_REAL_LOCATE="${TAILROCKS_REAL_LOCATE:-}" \
      TAILROCKS_REAL_MDFIND="${TAILROCKS_REAL_MDFIND:-}" \
      TAILROCKS_BLOCK_FIND="${TAILROCKS_BLOCK_FIND:-0}" \
      TAILROCKS_FIND_SHIM_LOG="${TAILROCKS_FIND_SHIM_LOG:-}" \
      GH_FIXTURE_KIND="${GH_FIXTURE_KIND:-}" \
      TAILROCKS_GH_FIXTURE_REPO="${TAILROCKS_GH_FIXTURE_REPO:-}" \
      "$codex_bin" "$@"
  else
    env -i \
      HOME="$cli_home" \
      CODEX_HOME="$cli_codex_home" \
      PATH="$codex_cli_path" \
      TMPDIR="$cli_tmpdir" \
      LANG="$codex_cli_lang" \
      LC_ALL="$codex_cli_lc_all" \
      TERM="$codex_cli_term" \
      GIT_OPTIONAL_LOCKS=0 \
      "$codex_bin" "$@"
  fi
}

codex_version=$(run_codex_cli "$codex_home" "$codex_home" "$codex_tmp_root" "" base --version 2>&1) || {
  echo "BLOCKED: Codex CLI version could not be read" >&2
  exit 2
}

work=$(mktemp -d "$codex_tmp_root/tailrocks-agent-acceptance.XXXXXX")
work=$(CDPATH= cd -- "$work" && pwd -P)
work_owned=1
retain_work=0
printf '%s\n' "tailrocks-agent-acceptance:$work" >"$work/.tailrocks-agent-acceptance-owned"
codex_task_tmpdir="$work/.tmp"
codex_command_home="$codex_task_tmpdir/home"
mkdir -p "$codex_task_tmpdir" "$codex_command_home"
shim_dir="$work/shims"
evidence="$work/evidence.txt"
writer_pid=
writer_stop="$work/stop-fixture-writer"
sandbox_probe_listener_pid=
sandbox_probe_root=
sandbox_probe_owned=0
marketplace_root="$work/codex-marketplace"
marketplace_name=
plugin_name=
plugin_id=
owner_plugin_name=
owner_plugin_id=
owner_plugin_root=
codex_user_config="$codex_home/config.toml"
codex_plugin_cache_root="$codex_home/plugins/cache"
codex_plugin_cache_marketplace=
codex_user_config_before=absent
codex_plugin_cache_snapshot_ready=0
retain_work=0

record_hash() {
  path=$1
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$path" | awk '{print $1}'
  else
    sha256sum "$path" | awk '{print $1}'
  fi
}

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    retain_work=1
    echo "retaining Codex acceptance artifacts after failed run: $work" >&2
  fi
  if [ -n "$writer_pid" ]; then
    : >"$writer_stop"
    wait "$writer_pid" 2>/dev/null || true
    writer_pid=
  fi
  if [ -n "$sandbox_probe_listener_pid" ]; then
    kill "$sandbox_probe_listener_pid" 2>/dev/null || true
    wait "$sandbox_probe_listener_pid" 2>/dev/null || true
    sandbox_probe_listener_pid=
  fi
  if [ "$codex_plugin_cache_snapshot_ready" = "1" ]; then
    codex_config_after=absent
    if [ -f "$codex_user_config" ]; then codex_config_after=$(record_hash "$codex_user_config"); fi
    if [ "$codex_config_after" != "$codex_user_config_before" ]; then
      retain_work=1
      status=1
      echo "BLOCKED: caller Codex config changed during isolated project-plugin acceptance; no automatic restore was attempted: $codex_user_config" >&2
    fi
    if [ -e "$codex_plugin_cache_marketplace" ]; then
      retain_work=1
      echo "retaining acceptance fixture because Codex created/changed this exact local-plugin cache identity: $codex_plugin_cache_marketplace" >&2
    fi
  fi
  if [ "$keep_work" = "1" ] || [ "$retain_work" = "1" ]; then
    echo "acceptance artifacts retained: $work" >&2
  elif [ "$work_owned" = "1" ] &&
    [ -f "$work/.tailrocks-agent-acceptance-owned" ] &&
    [ "$(cat "$work/.tailrocks-agent-acceptance-owned" 2>/dev/null || true)" = "tailrocks-agent-acceptance:$work" ]; then
    case "$work" in
      "$codex_tmp_root"/tailrocks-agent-acceptance.*) rm -rf -- "$work" ;;
      *) echo "refusing to remove unexpected acceptance path: $work" >&2 ;;
    esac
  elif [ "$work_owned" = "1" ]; then
    echo "retaining Codex acceptance artifacts; ownership marker is missing or mismatched: $work" >&2
  fi
  if [ "$sandbox_probe_owned" = "1" ] && [ -n "$sandbox_probe_root" ]; then
    sandbox_probe_marker="$sandbox_probe_root/.tailrocks-codex-sandbox-probe-owned"
    if [ -f "$sandbox_probe_marker" ] &&
      [ "$(cat "$sandbox_probe_marker" 2>/dev/null || true)" = "tailrocks-codex-sandbox-probe:$sandbox_probe_root" ]; then
      case "$sandbox_probe_root" in
        "$codex_tmp_root"/tailrocks-codex-sandbox-probe.*) rm -rf -- "$sandbox_probe_root" ;;
        *) echo "retaining unexpected Codex sandbox probe path: $sandbox_probe_root" >&2 ;;
      esac
    else
      echo "retaining Codex sandbox probe path; ownership marker is missing or mismatched: $sandbox_probe_root" >&2
    fi
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

plugin_name=$(jq -r '.name' "$repo_root/.codex-plugin/plugin.json")
mkdir -p "$shim_dir" "$work/xdg-state"
marketplace_suffix=$(basename "$work" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')
codex_permission_profile="tailrocks_acceptance_$marketplace_suffix"
marketplace_root="$work/codex-marketplace"
marketplace_plugin_root="$marketplace_root/plugins/$plugin_name"
marketplace_manifest="$marketplace_root/.agents/plugins/marketplace.json"
include_owner_plugin=false
owner_plugin_sha=
if [ -n "${TAILROCKS_PR_SKILLS_ROOT:-}" ]; then
  if [ -z "${TAILROCKS_PR_SKILLS_SHA:-}" ]; then
    echo "BLOCKED: set TAILROCKS_PR_SKILLS_SHA to pin the local PR-owner plugin checkout" >&2
    exit 2
  fi
  pr_skills_root=$(CDPATH= cd -- "$TAILROCKS_PR_SKILLS_ROOT" && pwd -P)
  owner_plugin_sha=$(git -C "$pr_skills_root" rev-parse --verify 'HEAD^{commit}')
  requested_owner_sha=$(git -C "$pr_skills_root" rev-parse --verify "${TAILROCKS_PR_SKILLS_SHA}^{commit}")
  if [ "$owner_plugin_sha" != "$requested_owner_sha" ]; then
    echo "BLOCKED: local PR-owner plugin HEAD does not match requested pinned commit" >&2
    exit 2
  fi
  case "$owner_plugin_sha" in
    *[!0-9a-f]*|'') echo "BLOCKED: PR-owner plugin pin is not a full commit hash" >&2; exit 2 ;;
  esac
  owner_plugin_name=$(git -C "$pr_skills_root" show "$owner_plugin_sha:.codex-plugin/plugin.json" | jq -er '.name')
  if [ "$owner_plugin_name" != "tailrocks-pull-request-skills" ]; then
    echo "BLOCKED: pinned local PR-owner plugin has unexpected manifest name: $owner_plugin_name" >&2
    exit 2
  fi
  include_owner_plugin=true
  owner_plugin_root="$marketplace_root/plugins/$owner_plugin_name"
  owner_plugin_id="$owner_plugin_name@tailrocks-acceptance-$marketplace_suffix"
fi
if [ "$selected_case" = "blocked-owner-preflight" ]; then
  if [ "$include_owner_plugin" != "true" ]; then
    echo "BLOCKED: blocked-owner-preflight case requires exact pinned TAILROCKS_PR_SKILLS_ROOT and TAILROCKS_PR_SKILLS_SHA" >&2
    exit 2
  fi
  if ! command -v bun >/dev/null 2>&1; then
    echo "BLOCKED: blocked-owner-preflight case requires the installed Bun runtime" >&2
    exit 2
  fi
fi
mkdir -p "$marketplace_root/.agents/plugins" "$marketplace_plugin_root"
cp -R "$repo_root/.codex-plugin" "$marketplace_plugin_root/"
cp -R "$repo_root/skills" "$marketplace_plugin_root/"
if [ "$include_owner_plugin" = "true" ]; then
  mkdir -p "$owner_plugin_root"
  git -C "$pr_skills_root" archive "$owner_plugin_sha" | tar -x -C "$owner_plugin_root"
  test -f "$owner_plugin_root/.codex-plugin/plugin.json"
  test -d "$owner_plugin_root/skills/tailrocks-review-pr"
  test -d "$owner_plugin_root/skills/tailrocks-merge-pr"
  test -f "$owner_plugin_root/scripts/merge-preflight.ts"
  test -f "$owner_plugin_root/scripts/merge-pr.ts"
fi
jq -n \
  --arg name "tailrocks-acceptance-$marketplace_suffix" \
  --arg plugin "$plugin_name" \
  --arg source "./plugins/$plugin_name" \
  --arg owner "$owner_plugin_name" \
  --arg ownerSource "./plugins/$owner_plugin_name" \
  --argjson includeOwner "$include_owner_plugin" \
  '{name:$name,interface:{displayName:"Tailrocks Acceptance"},plugins:([{name:$plugin,source:$source,policy:{installation:"AVAILABLE",authentication:"ON_INSTALL"},category:"Developer Tools"}] + (if $includeOwner then [{name:$owner,source:$ownerSource,policy:{installation:"AVAILABLE",authentication:"ON_INSTALL"},category:"Developer Tools"}] else [] end))}' \
  >"$marketplace_manifest"
marketplace_name=$(jq -er '.name | strings | select(length > 0)' "$marketplace_manifest")
plugin_id="$plugin_name@$marketplace_name"
codex_plugin_cache_marketplace="$codex_plugin_cache_root/$marketplace_name"
if [ "$plugin_name" = "$marketplace_name" ] || \
  [ "$(jq -er '.name' "$marketplace_manifest")" != "$marketplace_name" ]; then
  echo "BLOCKED: temporary marketplace identity failed self-verification" >&2
  exit 2
fi
case "$plugin_name:$marketplace_name" in
  *[!a-z0-9:-]*|:*) echo "BLOCKED: local Codex plugin identity is not a safe cache/config key" >&2; exit 2 ;;
esac
if ! diff -qr "$repo_root/.codex-plugin" "$marketplace_plugin_root/.codex-plugin" >/dev/null || \
  ! diff -qr "$repo_root/skills" "$marketplace_plugin_root/skills" >/dev/null; then
  echo "BLOCKED: temporary Codex plugin copy differs from the selected repository" >&2
  exit 2
fi
export XDG_STATE_HOME="$work/xdg-state"
if [ -e "$codex_plugin_cache_marketplace" ]; then
  echo "BLOCKED: this unique Codex acceptance marketplace already has a caller-home plugin cache; it was left untouched: $codex_plugin_cache_marketplace" >&2
  exit 2
fi
codex_user_config_before=absent
if [ -f "$codex_user_config" ]; then codex_user_config_before=$(record_hash "$codex_user_config"); fi
codex_plugin_cache_snapshot_ready=1
codex_home_mode=persisted-login-in-explicit-CODEX_HOME-with-ambient-OPENAI_API_KEY-excluded
auth_report="$work/codex-auth.txt"
if ! run_codex_cli "$codex_command_home" "$codex_home" "$codex_task_tmpdir" "" base login status >"$auth_report" 2>&1 ||
  ! grep -F -q 'Logged in' "$auth_report"; then
  echo "BLOCKED: sanitized Codex CLI did not report a persisted login; no model run or pass is recorded" >&2
  cat "$auth_report" >&2
  exit 2
fi

real_git=$(command -v git)
real_find=$(command -v find)
export TAILROCKS_REAL_GIT="$real_git"
export TAILROCKS_REAL_FIND="$real_find"
export TAILROCKS_GIT_SHIM_LOG="$XDG_STATE_HOME/git-shim.log"
export TAILROCKS_GH_FIXTURE_DIR="$work/gh-fixture"
export TAILROCKS_GH_FIXTURE_LOG="$XDG_STATE_HOME/gh-shim.log"
export TAILROCKS_REAL_RG="$(command -v rg 2>/dev/null || true)"
export TAILROCKS_REAL_FD="$(command -v fd 2>/dev/null || command -v fdfind 2>/dev/null || true)"
export TAILROCKS_REAL_LOCATE="$(command -v locate 2>/dev/null || true)"
export TAILROCKS_REAL_MDFIND="$(command -v mdfind 2>/dev/null || true)"
export TAILROCKS_ENV_POLICY_CANARY_LOG="$XDG_STATE_HOME/env-policy-canary.log"
TAILROCKS_ACCEPTANCE_TOKEN_CANARY="tailrocks-acceptance-token-canary-$marketplace_suffix"
export TAILROCKS_ACCEPTANCE_TOKEN_CANARY
cp "$repo_root/tests/fixtures/git-no-push.sh" "$shim_dir/git"
cp "$repo_root/tests/fixtures/gh-stub.sh" "$shim_dir/gh"
cp "$repo_root/tests/fixtures/find-block-host-scan.sh" "$shim_dir/find"
cp "$repo_root/tests/fixtures/find-block-host-scan.sh" "$shim_dir/rg"
cp "$repo_root/tests/fixtures/find-block-host-scan.sh" "$shim_dir/fd"
cp "$repo_root/tests/fixtures/find-block-host-scan.sh" "$shim_dir/fdfind"
cp "$repo_root/tests/fixtures/find-block-host-scan.sh" "$shim_dir/locate"
cp "$repo_root/tests/fixtures/find-block-host-scan.sh" "$shim_dir/mdfind"
chmod +x "$shim_dir/git" "$shim_dir/gh" "$shim_dir/find" "$shim_dir/rg" \
  "$shim_dir/fd" "$shim_dir/fdfind" "$shim_dir/locate" "$shim_dir/mdfind"
codex_cli_path="$shim_dir:$codex_cli_path"
cat >"$shim_dir/tailrocks-env-probe" <<'EOF'
#!/bin/sh
set -eu
if [ "${TAILROCKS_ACCEPTANCE_TOKEN_CANARY+x}" = x ]; then
  printf '%s\n' forwarded >"$TAILROCKS_ENV_POLICY_CANARY_LOG"
  echo 'the injected command-environment canary was forwarded' >&2
  exit 93
fi
printf '%s\n' absent >"$TAILROCKS_ENV_POLICY_CANARY_LOG"
printf '%s\n' 'injected command-environment canary absent'
EOF
chmod +x "$shim_dir/tailrocks-env-probe"
real_bun_bin=
owner_bun_shim_dir="$work/owner-bun-shim"
if [ -n "$owner_plugin_id" ]; then
  real_bun_bin=$(command -v bun 2>/dev/null || true)
  if [ -z "$real_bun_bin" ]; then
    echo "BLOCKED: pinned PR-owner fixture requires the installed Bun runtime" >&2
    exit 2
  fi
  mkdir -p "$owner_bun_shim_dir"
  cp "$repo_root/tests/fixtures/bun-argv-trace.sh" "$owner_bun_shim_dir/bun"
  chmod +x "$owner_bun_shim_dir/bun"
fi

# `codex exec` selects permission profiles through its per-invocation config
# layer. Deny the filesystem by default; reopen only the minimal runtime,
# active disposable work roots, the isolated temp root, and exact read-only
# fixture/plugin inputs. `.git` is writable only inside active work roots.
toml_quote_path() {
  jq -nr --arg value "$1" '$value | @json'
}

paths_overlap() {
  overlap_left=$1
  overlap_right=$2
  case "$overlap_left" in
    "$overlap_right"|"$overlap_right"/*) return 0 ;;
  esac
  case "$overlap_right" in
    "$overlap_left"|"$overlap_left"/*) return 0 ;;
  esac
  return 1
}

resolve_executable_path() {
  resolved_executable=$1
  case "$resolved_executable" in
    /*) ;;
    *) return 1 ;;
  esac
  resolve_hops=0
  while [ -L "$resolved_executable" ]; do
    resolve_hops=$((resolve_hops + 1))
    [ "$resolve_hops" -le 40 ] || return 1
    resolved_link=$(readlink "$resolved_executable") || return 1
    case "$resolved_link" in
      /*) resolved_executable=$resolved_link ;;
      *)
        resolved_parent=$(CDPATH= cd -- "$(dirname -- "$resolved_executable")/$(dirname -- "$resolved_link")" && pwd -P) || return 1
        resolved_executable="$resolved_parent/$(basename -- "$resolved_link")"
        ;;
    esac
  done
  resolved_parent=$(CDPATH= cd -- "$(dirname -- "$resolved_executable")" && pwd -P) || return 1
  printf '%s/%s\n' "$resolved_parent" "$(basename -- "$resolved_executable")"
}

append_exact_read_path() {
  read_path=$1
  [ -n "$read_path" ] || return 0
  case "$read_path" in
    /*) ;;
    *) echo "BLOCKED: executable path is not absolute: $read_path" >&2; return 2 ;;
  esac
  if [ -f "$read_path" ]; then
    read_path=$(resolve_executable_path "$read_path") || {
      echo "BLOCKED: could not resolve executable path: $1" >&2
      return 2
    }
  else
    echo "BLOCKED: configured read-only executable is missing: $read_path" >&2
    return 2
  fi
  read_path_key=$(toml_quote_path "$read_path")
  codex_filesystem_entries="$codex_filesystem_entries,$read_path_key=\"read\""
}

codex_filesystem_entries='{":root"="deny",":minimal"="read",":workspace_roots"={"."="write",".git"="write"},":slash_tmp"="deny",":tmpdir"="write"'
for codex_read_root in "$shim_dir" "$TAILROCKS_GH_FIXTURE_DIR"; do
  codex_read_root_key=$(toml_quote_path "$codex_read_root")
  codex_filesystem_entries="$codex_filesystem_entries,$codex_read_root_key=\"read\""
done
for codex_tool_path in "$real_git" "$real_find" "$TAILROCKS_REAL_RG" "$TAILROCKS_REAL_FD" \
  "$TAILROCKS_REAL_LOCATE" "$TAILROCKS_REAL_MDFIND" "$(command -v jq 2>/dev/null || true)"; do
  append_exact_read_path "$codex_tool_path"
done
if [ -n "$owner_plugin_id" ]; then
  codex_read_root_key=$(toml_quote_path "$owner_bun_shim_dir")
  codex_filesystem_entries="$codex_filesystem_entries,$codex_read_root_key=\"read\""
  append_exact_read_path "$repo_root/tests/fixtures/gh-stub.sh"
  append_exact_read_path "$repo_root/tests/fixtures/git-no-push.sh"
  append_exact_read_path "$real_bun_bin"
fi

append_shell_environment_value() {
  environment_name=$1
  environment_value=$2
  environment_name_toml=$(toml_quote_path "$environment_name")
  environment_value_toml=$(toml_quote_path "$environment_value")
  if [ -n "$codex_shell_environment_entries" ]; then
    codex_shell_environment_entries="$codex_shell_environment_entries,"
  fi
  codex_shell_environment_entries="$codex_shell_environment_entries$environment_name_toml=$environment_value_toml"
}

install_project_local_plugins() {
  project_root=$1
  project_plugin_root="$project_root/plugins/$plugin_name"
  project_owner_root=
  if [ -n "$owner_plugin_id" ]; then project_owner_root="$project_root/plugins/$owner_plugin_name"; fi
  project_marketplace="$project_root/.agents/plugins/marketplace.json"
  project_codex_config="$project_root/.codex/config.toml"
  project_marker="$project_root/.agents/plugins/.tailrocks-acceptance-$marketplace_suffix"
  project_key=$(basename "$project_root" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g')
  expected_marketplace="$work/expected-marketplace-$project_key.json"
  expected_codex_config="$work/expected-codex-config-$project_key.toml"
  expected_project_marker="$work/expected-project-marker-$project_key"
  project_git_exclude=$(git -C "$project_root" rev-parse --git-path info/exclude)
  case "$project_git_exclude" in
    /*) ;;
    *) project_git_exclude="$project_root/$project_git_exclude" ;;
  esac
  jq -n \
    --arg name "$marketplace_name" \
    --arg plugin "$plugin_name" \
    --arg source "./plugins/$plugin_name" \
    --arg owner "$owner_plugin_name" \
    --arg ownerSource "./plugins/$owner_plugin_name" \
    --argjson includeOwner "$include_owner_plugin" \
    '{name:$name,interface:{displayName:"Tailrocks Acceptance"},plugins:([{name:$plugin,source:{source:"local",path:$source},policy:{installation:"AVAILABLE",authentication:"ON_INSTALL"},category:"Developer Tools"}] + (if $includeOwner then [{name:$owner,source:{source:"local",path:$ownerSource},policy:{installation:"AVAILABLE",authentication:"ON_INSTALL"},category:"Developer Tools"}] else [] end))}' \
    >"$expected_marketplace"
  {
    printf '# tailrocks-acceptance project-local config %s\n' "$marketplace_suffix"
    printf '[plugins."%s"]\n' "$plugin_id"
    printf 'enabled = true\n'
    if [ -n "$owner_plugin_id" ]; then
      printf '\n[plugins."%s"]\n' "$owner_plugin_id"
      printf 'enabled = true\n'
    fi
  } >"$expected_codex_config"
  printf 'tailrocks-acceptance:%s:%s:%s\n' "$work" "$project_root" "$plugin_id${owner_plugin_id:+:$owner_plugin_id}" >"$expected_project_marker"
  project_paths_exist=0
  for project_path in "$project_marketplace" "$project_codex_config" "$project_plugin_root" "$project_marker"; do
    if [ -e "$project_path" ]; then project_paths_exist=1; fi
  done
  if [ -n "$project_owner_root" ] && [ -e "$project_owner_root" ]; then project_paths_exist=1; fi
  if [ "$project_paths_exist" = "0" ]; then
    mkdir -p "$project_root/plugins" "$project_root/.agents/plugins" "$project_root/.codex"
    cp -R "$marketplace_plugin_root" "$project_plugin_root"
    if [ -n "$owner_plugin_id" ]; then
      [ ! -e "$project_owner_root" ] || {
        echo "BLOCKED: disposable Codex project has a pre-existing owner plugin path: $project_owner_root" >&2
        return 2
      }
      cp -R "$owner_plugin_root" "$project_owner_root"
    fi
    cp "$expected_marketplace" "$project_marketplace"
    cp "$expected_codex_config" "$project_codex_config"
    cp "$expected_project_marker" "$project_marker"
  else
    if [ ! -f "$project_marker" ] || ! cmp -s "$expected_project_marker" "$project_marker" || \
      [ ! -f "$project_marketplace" ] || ! cmp -s "$expected_marketplace" "$project_marketplace" || \
      [ ! -f "$project_codex_config" ] || ! cmp -s "$expected_codex_config" "$project_codex_config" || \
      [ ! -d "$project_plugin_root" ] || ! diff -qr "$marketplace_plugin_root" "$project_plugin_root" >/dev/null; then
      echo "BLOCKED: disposable Codex project has unowned or changed plugin/config paths; they were left untouched: $project_root" >&2
      return 2
    fi
    if [ -n "$owner_plugin_id" ]; then
      project_owner_root="$project_root/plugins/$owner_plugin_name"
      if [ ! -d "$project_owner_root" ] || ! diff -qr "$owner_plugin_root" "$project_owner_root" >/dev/null; then
        echo "BLOCKED: disposable Codex project PR-owner path is unowned or changed; it was left untouched: $project_owner_root" >&2
        return 2
      fi
    fi
  fi
  if ! diff -qr "$marketplace_plugin_root" "$project_plugin_root" >/dev/null; then
    echo "BLOCKED: project-local Codex plugin copy differs from pinned source: $project_plugin_root" >&2
    return 2
  fi
  if [ -n "$owner_plugin_id" ] && ! diff -qr "$owner_plugin_root" "$project_owner_root" >/dev/null; then
    echo "BLOCKED: project-local PR-owner copy differs from pinned source: $project_owner_root" >&2
    return 2
  fi
  case "$project_git_exclude" in
    "$work"/*) ;;
    *) echo "BLOCKED: disposable project Git exclude path is outside fixture root: $project_git_exclude" >&2; return 2 ;;
  esac
  for project_ignore in '/.agents/plugins/marketplace.json' '/.codex/config.toml' "/.agents/plugins/.tailrocks-acceptance-$marketplace_suffix" "/plugins/$plugin_name/"; do
    grep -F -x -q -- "$project_ignore" "$project_git_exclude" || printf '%s\n' "$project_ignore" >>"$project_git_exclude"
  done
  if [ -n "$owner_plugin_id" ]; then
    project_ignore="/plugins/$owner_plugin_name/"
    grep -F -x -q -- "$project_ignore" "$project_git_exclude" || printf '%s\n' "$project_ignore" >>"$project_git_exclude"
  fi
  jq -e --arg name "$marketplace_name" --arg plugin "$plugin_name" \
    '.name == $name and any(.plugins[]; .name == $plugin and .source.source == "local" and .source.path == ("./plugins/" + $plugin))' \
    "$project_marketplace" >/dev/null
  test -f "$project_codex_config"
  test -d "$project_plugin_root/skills/repo-merge"
  record "project_local_plugin_marketplace=$project_marketplace"
  record "project_local_plugin_id=$plugin_id"
  record "project_trust_override=per-invocation-only"
}

record() {
  printf '%s\n' "$*" >>"$evidence"
}

record "case_selector=$selected_case"

probe_codex_sandbox() {
  probe_permission_base=$1
  probe_cwd=$2
  probe_filesystem=$3
  probe_label=$4
  probe_add_dir_roots_file=$5
  probe_writable_scan_roots_file=$6
  probe_nc=$(command -v nc 2>/dev/null || true)
  if [ -z "$probe_nc" ]; then
    echo 'BLOCKED: effective Codex sandbox probe requires nc for a local-only network canary' >&2
    return 2
  fi
  probe_root=$(mktemp -d "$codex_tmp_root/tailrocks-codex-sandbox-probe.XXXXXX")
  probe_root=$(CDPATH= cd -- "$probe_root" && pwd -P)
  case "$probe_root" in
    "$codex_tmp_root"/tailrocks-codex-sandbox-probe.*) ;;
    *) echo "BLOCKED: Codex sandbox probe temp escaped its exact temporary parent: $probe_root" >&2; return 2 ;;
  esac
  case "$probe_root" in
    "$work"|"$work"/*) echo "BLOCKED: Codex sandbox probe temp overlaps acceptance fixtures: $probe_root" >&2; return 2 ;;
  esac
  sandbox_probe_root=$probe_root
  sandbox_probe_owned=1
  sandbox_probe_marker="$probe_root/.tailrocks-codex-sandbox-probe-owned"
  printf 'tailrocks-codex-sandbox-probe:%s\n' "$probe_root" >"$sandbox_probe_marker"
  probe_outside="$probe_root/outside"
  mkdir -p "$probe_outside"
  probe_read_path="$probe_outside/read-canary.txt"
  probe_write_path="$probe_outside/write-canary.txt"
  probe_project_path="$probe_cwd/.tailrocks-sandbox-probe-$marketplace_suffix"
  probe_tmp_path="$codex_task_tmpdir/sandbox-probe-$marketplace_suffix"
  probe_trace="$work/$probe_label.codex-sandbox-probe.log"
  probe_listener_log="$probe_root/network-listener.log"
  if [ -e "$probe_read_path" ] || [ -e "$probe_write_path" ] ||
    [ -e "$probe_project_path" ] || [ -e "$probe_tmp_path" ] || [ -e "$probe_trace" ]; then
    echo 'BLOCKED: a unique effective-sandbox probe canary path already exists; it was left untouched' >&2
    return 2
  fi
  printf 'tailrocks-read-canary-%s\n' "$marketplace_suffix" >"$probe_read_path"
  probe_network_nonce="tailrocks-network-canary-$marketplace_suffix-$$"
  probe_label_hash=$(printf '%s' "$probe_label" | cksum | awk '{print $1}')
  probe_port=$((20000 + (($$ + probe_label_hash) % 40000)))
  probe_listener_ready=0
  probe_listener_attempt=0
  while [ "$probe_listener_attempt" -lt 32 ]; do
    "$probe_nc" -lk 127.0.0.1 "$probe_port" >"$probe_listener_log" 2>&1 &
    sandbox_probe_listener_pid=$!
    sleep 0.1
    if kill -0 "$sandbox_probe_listener_pid" 2>/dev/null; then
      printf '%s\n' "$probe_network_nonce" | "$probe_nc" -w 1 127.0.0.1 "$probe_port" >/dev/null 2>&1 || true
      probe_listener_wait=0
      while [ "$probe_listener_wait" -lt 10 ]; do
        if grep -F -q "$probe_network_nonce" "$probe_listener_log"; then
          probe_listener_ready=1
          break
        fi
        sleep 0.1
        probe_listener_wait=$((probe_listener_wait + 1))
      done
    fi
    if [ "$probe_listener_ready" = "1" ] && kill -0 "$sandbox_probe_listener_pid" 2>/dev/null; then
      break
    fi
    kill "$sandbox_probe_listener_pid" 2>/dev/null || true
    wait "$sandbox_probe_listener_pid" 2>/dev/null || true
    sandbox_probe_listener_pid=
    probe_port=$((20000 + ((probe_port - 19999) % 40000)))
    probe_listener_attempt=$((probe_listener_attempt + 1))
  done
  if [ "$probe_listener_ready" != "1" ] || [ -z "$sandbox_probe_listener_pid" ]; then
    echo 'BLOCKED: could not bind and independently verify a local network-canary listener' >&2
    return 2
  fi
  while IFS= read -r probe_add_dir_root; do
    [ -n "$probe_add_dir_root" ] || continue
    if grep -F -x -q "$probe_add_dir_root" "$probe_writable_scan_roots_file"; then
      continue
    fi
    probe_add_dir_key=$(toml_quote_path "$probe_add_dir_root")
    probe_add_dir_git_key=$(toml_quote_path "$probe_add_dir_root/.git")
    probe_filesystem="$probe_filesystem,$probe_add_dir_key=\"write\",$probe_add_dir_git_key=\"write\""
  done <"$probe_add_dir_roots_file"
  record "codex_sandbox_probe_listener=verified-local-only:$probe_port; case=$probe_label; outside_read=$probe_read_path; outside_write=$probe_write_path"
  probe_script='
if /bin/cat "$1/read-canary.txt" >/dev/null 2>&1; then
  echo READ_ALLOWED
  exit 41
fi
echo READ_DENIED
if /usr/bin/touch "$1/write-canary.txt" >/dev/null 2>&1; then
  echo WRITE_ALLOWED
  exit 42
fi
echo WRITE_DENIED
if /usr/bin/nc -z -w 1 127.0.0.1 "$2" >/dev/null 2>&1; then
  echo NETWORK_ALLOWED
  exit 43
fi
echo NETWORK_DENIED
if printf "%s\n" workspace-write >"$3" 2>/dev/null && [ "$(/bin/cat "$3" 2>/dev/null)" = workspace-write ]; then
  echo PROJECT_WRITE_ALLOWED
else
  echo PROJECT_WRITE_FAILED
  exit 44
fi
if printf "%s\n" tmp-write >"$4" 2>/dev/null && [ "$(/bin/cat "$4" 2>/dev/null)" = tmp-write ]; then
  echo TMP_WRITE_ALLOWED
else
  echo TMP_WRITE_FAILED
  exit 45
fi
'
  if run_codex_cli "$codex_command_home" "$codex_command_home" "$codex_task_tmpdir" "" base \
    sandbox \
    -c "permissions.$codex_permission_profile.extends=\"$probe_permission_base\"" \
    -c "permissions.$codex_permission_profile.filesystem=$probe_filesystem" \
    -c "permissions.$codex_permission_profile.network.enabled=false" \
    --permission-profile "$codex_permission_profile" \
    -C "$probe_cwd" --log-denials -- /bin/sh -c "$probe_script" \
    tailrocks-sandbox-probe "$probe_outside" "$probe_port" "$probe_project_path" "$probe_tmp_path" \
    >"$probe_trace" 2>&1; then
    probe_status=0
  else
    probe_status=$?
  fi
  if [ "$probe_status" -ne 0 ]; then
    echo "BLOCKED: Codex effective sandbox canaries failed (sandbox exit $probe_status); no skill prompt was sent" >&2
    cat "$probe_trace" >&2
    return 2
  fi
  for expected_probe_output in READ_DENIED WRITE_DENIED NETWORK_DENIED PROJECT_WRITE_ALLOWED TMP_WRITE_ALLOWED; do
    if ! grep -F -x -q "$expected_probe_output" "$probe_trace"; then
      echo "BLOCKED: Codex sandbox probe did not observe $expected_probe_output; no skill prompt was sent" >&2
      cat "$probe_trace" >&2
      return 2
    fi
  done
  if ! grep -F -q "(cat) file-read-data $probe_read_path" "$probe_trace" ||
    ! grep -F -q "(touch) file-write-create $probe_write_path" "$probe_trace" ||
    ! grep -F -q "(nc) network-outbound remote:*:$probe_port" "$probe_trace"; then
    echo 'BLOCKED: Codex sandbox denial log lacked an exact outside-read, outside-write, or live-network denial event; no skill prompt was sent' >&2
    cat "$probe_trace" >&2
    return 2
  fi
  if [ -e "$probe_write_path" ] ||
    [ "$(cat "$probe_project_path" 2>/dev/null || true)" != workspace-write ] ||
    [ "$(cat "$probe_tmp_path" 2>/dev/null || true)" != tmp-write ]; then
    echo 'BLOCKED: Codex sandbox canary state did not match denied-outside/allowed-inside results; no skill prompt was sent' >&2
    cat "$probe_trace" >&2
    return 2
  fi
  rm -f -- "$probe_project_path" "$probe_tmp_path"
  record "codex_sandbox_probe=passed-before-run-agent-prompt; outside-read=denied; outside-write=denied; live-loopback-network=denied; project-and-task-tmp-writes=allowed; event-log=$probe_trace"
  kill "$sandbox_probe_listener_pid" 2>/dev/null || true
  wait "$sandbox_probe_listener_pid" 2>/dev/null || true
  sandbox_probe_listener_pid=
}

record "client=$codex_version"
record "plugin=$plugin_id"
record "plugin_manifest_sha256=$(record_hash "$repo_root/.codex-plugin/plugin.json")"
record "repo_merge_skill_sha256=$(record_hash "$repo_root/skills/repo-merge/SKILL.md")"
record "acceptance_script_sha256=$(record_hash "$repo_root/tests/agent-acceptance.sh")"
record "local_only=true"
record "codex_model_api_network=authenticated client calls required; generated-shell network disabled; GitHub reads use synthetic fixture shims"
record "codex_outer_environment=env-i allowlist HOME/CODEX_HOME/PATH/TMPDIR/locale/TERM/GIT_OPTIONAL_LOCKS=0; exact fixture shims only for exec; PROBE_PATH only for permission probes; persisted login only; ambient OPENAI_API_KEY and unrelated variables omitted"
record "codex_child_shell_environment_policy=inherit:none;explicit-allowlist;secret-name-filters-enabled"
record "fixture_mutation_shims=Git push and GitHub mutation refused; API reads are synthetic local fixtures, not hosted evidence"
record "codex_home_mode=$codex_home_mode"
record "xdg_state_home=$XDG_STATE_HOME"
record "codex_permission_profile=$codex_permission_profile"
record "codex_permission_profile_base=:workspace"
record "codex_task_tmpdir=$codex_task_tmpdir"
record "codex_exec_ephemeral=true"
record "marketplace_name=$marketplace_name"
record "codex_user_config_baseline=$codex_user_config_before"
record "codex_cache_identity=$codex_plugin_cache_marketplace"
record 'caller_config_and_unrelated_plugins=untouched; Codex may create the exact unique local marketplace cache, which this runner retains and never auto-deletes'
record "project_plugin_installation=repo-local-marketplace-and-project-config"
record "lifecycle_owner_plugin=$owner_plugin_id"
record "lifecycle_owner_revision=$owner_plugin_sha"
record "lifecycle_owner_global_mutation=none"

run_agent() {
  label=$1
  cwd=$2
  permission_base=$3
  prompt=$4
  if [ "$#" -ge 5 ]; then
    scan_root=$5
    shift 5
  else
    scan_root=$cwd
    shift 4
  fi
  canonical_work=$(CDPATH= cd -- "$work" && pwd -P)
  canonical_cwd=$(CDPATH= cd -- "$cwd" && pwd -P)
  canonical_scan_root=$(CDPATH= cd -- "$scan_root" && pwd -P)
  canonical_xdg_state_home=$(CDPATH= cd -- "$XDG_STATE_HOME" && pwd -P)
  case "$canonical_cwd" in
    "$canonical_work"/*) ;;
    *)
      echo "BLOCKED: Codex project root is outside the owned fixture temp root: $canonical_cwd" >&2
      return 2
      ;;
  esac
  case "$canonical_scan_root" in
    "$canonical_work"/*) ;;
    *)
      echo "BLOCKED: Codex scan root is outside the owned fixture temp root: $canonical_scan_root" >&2
      return 2
      ;;
  esac
  if [ "$permission_base" != ":workspace" ]; then
    echo "BLOCKED: Codex acceptance profile must extend the literal :workspace base" >&2
    return 2
  fi
  canonical_task_tmpdir=$(CDPATH= cd -- "$codex_task_tmpdir" && pwd -P)
  case "$canonical_task_tmpdir" in
    "$canonical_work"/*) ;;
    *)
      echo "BLOCKED: Codex TMPDIR is outside the owned fixture root: $canonical_task_tmpdir" >&2
      return 2
      ;;
  esac
  case "$canonical_xdg_state_home" in
    "$canonical_work"/*) ;;
    *)
      echo "BLOCKED: Codex handoff state is outside the owned fixture root: $canonical_xdg_state_home" >&2
      return 2
      ;;
  esac
  all_work_case=0
  case "$label" in
    all-work-coverage|retention-guards|all-work-resolved-retention|recover-unfinished-goal) all_work_case=1 ;;
  esac
  if [ "$all_work_case" = "1" ]; then
    for authorized_root in "$canonical_cwd" "$canonical_xdg_state_home" "$canonical_task_tmpdir" \
      "$canonical_cwd/plugins" "$canonical_cwd/.agents/plugins" "$canonical_cwd/.codex"; do
      if paths_overlap "$authorized_root" "$canonical_scan_root"; then
        echo "BLOCKED: all-work writable path overlaps its read-only scan root: $authorized_root" >&2
        return 2
      fi
    done
  fi
  writable_scan_root_count=0
  writable_scan_roots_file="$work/$label.writable-scan-roots"
  if [ -e "$writable_scan_roots_file" ]; then
    echo "BLOCKED: duplicate writable-scan-root manifest path: $writable_scan_roots_file" >&2
    return 2
  fi
  : >"$writable_scan_roots_file"
  while [ "$#" -ge 2 ] && [ "$1" = "--writable-scan-descendant" ]; do
    shift
    writable_scan_root=$1
    shift
    if [ "$label" != "all-work-resolved-retention" ] || [ "$all_work_case" != "1" ]; then
      echo 'BLOCKED: writable scan descendants are limited to the dedicated normal-cleanup retention fixture' >&2
      return 2
    fi
    if [ ! -d "$writable_scan_root" ] || [ -L "$writable_scan_root" ]; then
      echo "BLOCKED: writable scan descendant is missing or a symlink: $writable_scan_root" >&2
      return 2
    fi
    canonical_writable_scan_root=$(CDPATH= cd -- "$writable_scan_root" && pwd -P)
    case "$canonical_writable_scan_root" in
      "$canonical_work"/*) ;;
      *) echo "BLOCKED: writable scan descendant is outside the owned fixture root: $canonical_writable_scan_root" >&2; return 2 ;;
    esac
    case "$canonical_writable_scan_root" in
      "$canonical_scan_root"/*) ;;
      *) echo "BLOCKED: writable scan root must be a strict child of the read-only scan root: $canonical_writable_scan_root" >&2; return 2 ;;
    esac
    case "$canonical_writable_scan_root" in
      *'
'*) echo 'BLOCKED: writable scan descendant paths cannot contain newlines' >&2; return 2 ;;
    esac
    if [ ! -d "$canonical_writable_scan_root/.git" ] || [ -L "$canonical_writable_scan_root/.git" ]; then
      echo "BLOCKED: writable scan descendant must be an independent clone, not a linked worktree: $canonical_writable_scan_root" >&2
      return 2
    fi
    writable_git_root=$(git -C "$canonical_writable_scan_root" rev-parse --show-toplevel 2>/dev/null) || {
      echo "BLOCKED: writable scan descendant is not a Git repository: $canonical_writable_scan_root" >&2
      return 2
    }
    writable_git_root=$(CDPATH= cd -- "$writable_git_root" && pwd -P)
    writable_git_dir=$(git -C "$canonical_writable_scan_root" rev-parse --absolute-git-dir 2>/dev/null) || return 2
    writable_git_dir=$(CDPATH= cd -- "$writable_git_dir" && pwd -P)
    if [ "$writable_git_root" != "$canonical_writable_scan_root" ] ||
      [ "$writable_git_dir" != "$canonical_writable_scan_root/.git" ]; then
      echo "BLOCKED: writable scan descendant does not own its exact repository and .git roots: $canonical_writable_scan_root" >&2
      return 2
    fi
    while IFS= read -r existing_writable_scan_root; do
      if paths_overlap "$canonical_writable_scan_root" "$existing_writable_scan_root"; then
        echo "BLOCKED: writable scan descendants overlap: $canonical_writable_scan_root and $existing_writable_scan_root" >&2
        return 2
      fi
    done <"$writable_scan_roots_file"
    printf '%s\n' "$canonical_writable_scan_root" >>"$writable_scan_roots_file"
    record "explicit_writable_scan_descendant=$canonical_writable_scan_root"
    set -- "$@" "$canonical_writable_scan_root"
    writable_scan_root_count=$((writable_scan_root_count + 1))
  done
  artifact_root_count=$(($# - writable_scan_root_count))
  if [ "$all_work_case" = "1" ]; then
    record "scan_root_root_write_authorized=false"
  fi
  last="$work/$label.final.txt"
  trace="$work/$label.trace.log"
  if [ ! -d "$canonical_xdg_state_home" ]; then
    echo "BLOCKED: isolated Codex handoff root does not exist: $canonical_xdg_state_home" >&2
    return 2
  fi
  record "case=$label"
  record "cwd=$canonical_cwd"
  record "launch_shell_cwd=$canonical_work"
  record "permission_profile=$codex_permission_profile"
  record "permission_profile_base=$permission_base"
  record "scan_root=$canonical_scan_root"
  record "explicit_writable_root=$canonical_cwd"
  record "explicit_writable_root=$canonical_xdg_state_home"
  record "tmpdir=$canonical_task_tmpdir"
  run_filesystem_config="$codex_filesystem_entries"
  if [ "$canonical_scan_root" != "$canonical_cwd" ]; then
    if paths_overlap "$canonical_cwd" "$canonical_scan_root"; then
      echo "BLOCKED: Codex scan root overlaps a writable project root: $canonical_cwd" >&2
      return 2
    fi
    scan_root_key=$(toml_quote_path "$canonical_scan_root")
    run_filesystem_config="$run_filesystem_config,$scan_root_key=\"read\""
    record "scan_root_access=read-only"
  else
    record "scan_root_access=current-workspace"
  fi
  agent_path="$shim_dir:$PATH"
  bun_argv_log=
  if [ "$label" = "blocked-review-ci-with-real-owners" ]; then
    if [ -z "$real_bun_bin" ]; then
      echo "BLOCKED: owner fixture cannot trace Bun because the real runtime was not resolved" >&2
      return 2
    fi
    agent_path="$owner_bun_shim_dir:$agent_path"
    bun_argv_log="$canonical_xdg_state_home/$label.bun-argv.jsonl"
  fi

  # Canonicalize artifact roots while retaining each argument boundary.
  # Explicit scan descendants occupy a separate positional segment.
  artifact_index=0
  artifact_roots_file="$work/$label.artifact-roots"
  if [ -e "$artifact_roots_file" ]; then
    echo "BLOCKED: duplicate artifact-root manifest path: $artifact_roots_file" >&2
    return 2
  fi
  : >"$artifact_roots_file"
  effective_add_dir_roots_file="$work/$label.effective-add-dir-roots"
  if [ -e "$effective_add_dir_roots_file" ]; then
    echo "BLOCKED: duplicate effective add-dir manifest path: $effective_add_dir_roots_file" >&2
    return 2
  fi
  printf '%s\n' "$canonical_xdg_state_home" >"$effective_add_dir_roots_file"
  while [ "$artifact_index" -lt "$artifact_root_count" ]; do
    artifact_root=$1
    shift
    if [ ! -d "$artifact_root" ]; then
      echo "BLOCKED: explicit Codex artifact root is not an existing directory: $artifact_root" >&2
      return 2
    fi
    canonical_artifact_root=$(CDPATH= cd -- "$artifact_root" && pwd -P)
    case "$canonical_artifact_root" in
      "$canonical_work"/*) ;;
      *)
        echo "BLOCKED: Codex artifact root is outside the owned fixture root: $canonical_artifact_root" >&2
        return 2
        ;;
    esac
    if [ "$all_work_case" = "1" ] && paths_overlap "$canonical_artifact_root" "$canonical_scan_root"; then
      echo "BLOCKED: all-work writable artifact path overlaps its read-only scan root: $canonical_artifact_root" >&2
      return 2
    fi
    if [ "$all_work_case" = "1" ]; then
      for scoped_root in "$canonical_cwd" "$canonical_xdg_state_home" "$canonical_task_tmpdir" \
        "$canonical_cwd/plugins" "$canonical_cwd/.agents/plugins" "$canonical_cwd/.codex"; do
        if paths_overlap "$canonical_artifact_root" "$scoped_root"; then
          echo "BLOCKED: all-work artifact root overlaps another writable root: $canonical_artifact_root" >&2
          return 2
        fi
      done
      while IFS= read -r existing_artifact_root; do
        if paths_overlap "$canonical_artifact_root" "$existing_artifact_root"; then
          echo "BLOCKED: all-work artifact roots overlap: $canonical_artifact_root and $existing_artifact_root" >&2
          return 2
        fi
      done <"$artifact_roots_file"
    fi
    while IFS= read -r existing_writable_scan_root; do
      if paths_overlap "$canonical_artifact_root" "$existing_writable_scan_root"; then
        echo "BLOCKED: artifact root overlaps an explicitly writable scan descendant: $canonical_artifact_root" >&2
        return 2
      fi
    done <"$writable_scan_roots_file"
    printf '%s\n' "$canonical_artifact_root" >>"$artifact_roots_file"
    record "explicit_writable_root=$canonical_artifact_root"
    set -- "$@" "$canonical_artifact_root"
    artifact_index=$((artifact_index + 1))
  done
  total_add_dir_roots=$((writable_scan_root_count + artifact_root_count))
  add_dir_index=0
  while [ "$add_dir_index" -lt "$total_add_dir_roots" ]; do
    authorized_root=$1
    shift
    if [ "$add_dir_index" -lt "$writable_scan_root_count" ]; then
      authorized_root_key=$(toml_quote_path "$authorized_root")
      authorized_git_key=$(toml_quote_path "$authorized_root/.git")
      run_filesystem_config="$run_filesystem_config,$authorized_root_key=\"write\",$authorized_git_key=\"write\""
      record "explicit_writable_root=$authorized_root"
      printf '%s\n' "$authorized_root" >>"$effective_add_dir_roots_file"
      set -- "$@" --add-dir "$authorized_root"
    else
      case "$authorized_root" in
        "$canonical_cwd"|"$canonical_scan_root"|"$canonical_xdg_state_home") ;;
        *)
          printf '%s\n' "$authorized_root" >>"$effective_add_dir_roots_file"
          set -- "$@" --add-dir "$authorized_root"
          ;;
      esac
    fi
    add_dir_index=$((add_dir_index + 1))
  done
  run_filesystem_config="$run_filesystem_config}"

  probe_codex_sandbox "$permission_base" "$canonical_cwd" "$run_filesystem_config" "$label" \
    "$effective_add_dir_roots_file" "$writable_scan_roots_file"

  install_project_local_plugins "$canonical_cwd"

  record "prompt_content=omitted"
  record "outer_codex_environment=env-i; child_shell_environment_policy=inherit:none with explicit allowlist"
  # Do not pass --sandbox or mutate caller config. The custom profile denies
  # broad filesystem reads, disables local command networking, restores .git
  # only beneath active disposable roots, confines temp writes to .tmp, and
  # limits generated shell processes to an explicit safe environment.
  codex_shell_environment_entries=
  append_shell_environment_value PATH "$agent_path"
  append_shell_environment_value HOME "$codex_command_home"
  append_shell_environment_value TMPDIR "$canonical_task_tmpdir"
  append_shell_environment_value XDG_STATE_HOME "$canonical_xdg_state_home"
  append_shell_environment_value XDG_CONFIG_HOME "$codex_task_tmpdir/xdg-config"
  append_shell_environment_value XDG_CACHE_HOME "$codex_task_tmpdir/xdg-cache"
  append_shell_environment_value XDG_DATA_HOME "$codex_task_tmpdir/xdg-data"
  append_shell_environment_value GIT_OPTIONAL_LOCKS 0
  append_shell_environment_value GIT_CONFIG_NOSYSTEM 1
  append_shell_environment_value GIT_CONFIG_GLOBAL "$codex_command_home/.gitconfig"
  append_shell_environment_value LANG C
  append_shell_environment_value LC_ALL C
  append_shell_environment_value TAILROCKS_REAL_GIT "$real_git"
  append_shell_environment_value TAILROCKS_REAL_FIND "$real_find"
  append_shell_environment_value TAILROCKS_GIT_SHIM_LOG "$TAILROCKS_GIT_SHIM_LOG"
  append_shell_environment_value TAILROCKS_GH_FIXTURE_DIR "$TAILROCKS_GH_FIXTURE_DIR"
  append_shell_environment_value TAILROCKS_GH_FIXTURE_LOG "$TAILROCKS_GH_FIXTURE_LOG"
  append_shell_environment_value TAILROCKS_REAL_RG "$TAILROCKS_REAL_RG"
  append_shell_environment_value TAILROCKS_REAL_FD "$TAILROCKS_REAL_FD"
  append_shell_environment_value TAILROCKS_REAL_LOCATE "$TAILROCKS_REAL_LOCATE"
  append_shell_environment_value TAILROCKS_REAL_MDFIND "$TAILROCKS_REAL_MDFIND"
  append_shell_environment_value TAILROCKS_ENV_POLICY_CANARY_LOG "$TAILROCKS_ENV_POLICY_CANARY_LOG"
  if [ "${GH_FIXTURE_KIND+x}" = x ]; then
    append_shell_environment_value GH_FIXTURE_KIND "$GH_FIXTURE_KIND"
  fi
  if [ "${TAILROCKS_GH_FIXTURE_REPO+x}" = x ]; then
    append_shell_environment_value TAILROCKS_GH_FIXTURE_REPO "$TAILROCKS_GH_FIXTURE_REPO"
  fi
  if [ "${TAILROCKS_BLOCK_FIND+x}" = x ]; then
    append_shell_environment_value TAILROCKS_BLOCK_FIND "$TAILROCKS_BLOCK_FIND"
  fi
  if [ "${TAILROCKS_FIND_SHIM_LOG+x}" = x ]; then
    append_shell_environment_value TAILROCKS_FIND_SHIM_LOG "$TAILROCKS_FIND_SHIM_LOG"
  fi
  if [ -n "$bun_argv_log" ]; then
    append_shell_environment_value TAILROCKS_REAL_BUN "$real_bun_bin"
    append_shell_environment_value TAILROCKS_BUN_ARGV_LOG "$bun_argv_log"
    append_shell_environment_value TAILROCKS_OWNER_PLUGIN_ROOT "$TAILROCKS_OWNER_PLUGIN_ROOT"
    append_shell_environment_value TAILROCKS_OWNER_EXPECTED_SHA "$TAILROCKS_OWNER_EXPECTED_SHA"
    append_shell_environment_value TAILROCKS_OWNER_EXPECTED_CWD "$TAILROCKS_OWNER_EXPECTED_CWD"
    append_shell_environment_value TAILROCKS_OWNER_RECEIPTS_LOG "$TAILROCKS_OWNER_RECEIPTS_LOG"
    append_shell_environment_value TAILROCKS_OWNER_CAPTURE_ROOT "$TAILROCKS_OWNER_CAPTURE_ROOT"
    append_shell_environment_value TAILROCKS_OWNER_WORK_ROOT "$TAILROCKS_OWNER_WORK_ROOT"
    append_shell_environment_value TAILROCKS_OWNER_GH_SHIM "$TAILROCKS_OWNER_GH_SHIM"
    append_shell_environment_value TAILROCKS_OWNER_GH_SHIM_SOURCE "$TAILROCKS_OWNER_GH_SHIM_SOURCE"
    append_shell_environment_value TAILROCKS_OWNER_GIT_SHIM "$TAILROCKS_OWNER_GIT_SHIM"
    append_shell_environment_value TAILROCKS_OWNER_GIT_SHIM_SOURCE "$TAILROCKS_OWNER_GIT_SHIM_SOURCE"
    append_shell_environment_value TAILROCKS_OWNER_EXPECTED_REPOSITORY "$TAILROCKS_OWNER_EXPECTED_REPOSITORY"
    append_shell_environment_value TAILROCKS_OWNER_EXPECTED_PR "$TAILROCKS_OWNER_EXPECTED_PR"
    append_shell_environment_value TAILROCKS_OWNER_EXPECTED_HEAD "$TAILROCKS_OWNER_EXPECTED_HEAD"
    append_shell_environment_value TAILROCKS_OWNER_EXPECTED_BASE "$TAILROCKS_OWNER_EXPECTED_BASE"
    append_shell_environment_value TAILROCKS_OWNER_EXPECTED_MERGE_BASE "$TAILROCKS_OWNER_EXPECTED_MERGE_BASE"
  fi
  set -- exec --ephemeral \
    --strict-config \
    --ignore-user-config \
    -c "default_permissions=\"$codex_permission_profile\"" \
    -c "permissions.$codex_permission_profile.extends=\"$permission_base\"" \
    -c "permissions.$codex_permission_profile.filesystem=$run_filesystem_config" \
    -c "permissions.$codex_permission_profile.network.enabled=false" \
    -c "projects.\"$canonical_cwd\".trust_level=\"trusted\"" \
    -c 'shell_environment_policy.inherit="none"' \
    -c 'shell_environment_policy.ignore_default_excludes=false' \
    -c "shell_environment_policy.set={$codex_shell_environment_entries}" \
    --cd "$canonical_cwd" --add-dir "$canonical_xdg_state_home" "$@"
  # Writes stay on the cwd, isolated handoff, validated artifacts, and only
  # explicit independent-clone descendants added for retention cleanup.
  set -- "$@" -o "$last" "$prompt"
  if [ -n "$bun_argv_log" ]; then : >"$bun_argv_log"; fi
  command_status=0
  if [ -n "$bun_argv_log" ]; then
    if (
      CDPATH= cd -- "$canonical_work" &&
        run_codex_cli "$codex_command_home" "$codex_home" "$canonical_task_tmpdir" "" fixture "$@" >"$trace" 2>&1
    ); then
      :
    else
      command_status=$?
    fi
  elif (
    CDPATH= cd -- "$canonical_work" &&
      run_codex_cli "$codex_command_home" "$codex_home" "$canonical_task_tmpdir" "" fixture "$@" >"$trace" 2>&1
  ); then
    :
  else
    command_status=$?
  fi
  if [ "$command_status" -eq 0 ]; then
    record "exit_status=0"
  else
    record "exit_status=$command_status"
    echo "Codex acceptance case failed: $label (exit $command_status); inspect the trace below" >&2
    tail -n 100 "$trace" >&2
    return "$command_status"
  fi
  if [ ! -f "$last" ]; then
    echo "Codex produced no final message for $label" >&2
    return 1
  fi
}

make_repo() {
  repo=$1
  mkdir -p "$repo"
  git init -q -b main "$repo"
  git -C "$repo" config user.name 'Disposable Fixture'
  git -C "$repo" config user.email fixture@example.invalid
}

commit_all() {
  repo=$1
  message=$2
  git -C "$repo" add -A
  git -C "$repo" commit -qm "$message"
}

branch_file() {
  repo=$1
  branch=$2
  file=$3
  content=$4
  git -C "$repo" checkout -q -b "$branch" main
  printf '%s\n' "$content" >"$repo/$file"
  commit_all "$repo" "fixture $branch"
  git -C "$repo" checkout -q main
}

snapshot_refs() {
  repo=$1
  out=$2
  git -C "$repo" for-each-ref --format='%(refname) %(objectname)' refs | LC_ALL=C sort >"$out"
}

assert_same_refs() {
  repo=$1
  expected=$2
  actual="$work/$(basename "$expected").actual"
  snapshot_refs "$repo" "$actual"
  if ! cmp -s "$expected" "$actual"; then
    echo "fixture refs changed unexpectedly in $repo" >&2
    diff -u "$expected" "$actual" >&2 || true
    return 1
  fi
}

assert_refs_preserved_except() {
  repo=$1
  expected=$2
  changed_ref=$3
  while IFS=' ' read -r ref oid; do
    [ "$ref" = "$changed_ref" ] && continue
    actual_oid=$(git -C "$repo" rev-parse --verify "$ref" 2>/dev/null) || {
      echo "pre-existing ref disappeared unexpectedly: $ref" >&2
      return 1
    }
    if [ "$actual_oid" != "$oid" ]; then
      echo "pre-existing ref changed unexpectedly: $ref" >&2
      return 1
    fi
  done <"$expected"
}

snapshot_source_state() {
  repo=$1
  prefix=$2
  snapshot_refs "$repo" "$prefix.refs"
  GIT_OPTIONAL_LOCKS=0 git -C "$repo" status --porcelain=v2 --branch --untracked-files=all >"$prefix.status"
  git -C "$repo" diff --binary >"$prefix.unstaged"
  git -C "$repo" diff --cached --binary >"$prefix.staged"
  git_dir=$(git -C "$repo" rev-parse --absolute-git-dir)
  cp "$git_dir/index" "$prefix.index"
  : >"$prefix.files"
  (
    cd "$repo"
    find . -type f ! -path './.git/*' ! -name .git -print | LC_ALL=C sort
  ) | while IFS= read -r relative_path; do
    path=${relative_path#./}
    printf '%s %s\n' "$path" "$(record_hash "$repo/$path")"
  done >"$prefix.files"
}

assert_same_source_state() {
  repo=$1
  prefix=$2
  actual="$prefix.after"
  snapshot_source_state "$repo" "$actual"
  for suffix in refs status unstaged staged index files; do
    if ! cmp -s "$prefix.$suffix" "$actual.$suffix"; then
      echo "unfinished source state changed unexpectedly: $repo ($suffix)" >&2
      diff -u "$prefix.$suffix" "$actual.$suffix" >&2 || true
      return 1
    fi
  done
}

assert_json_final() {
  file=$1
  filter=$2
  if ! jq -e "$filter" "$file" >/dev/null 2>&1; then
    echo "Codex final response failed acceptance shape: $file" >&2
    cat "$file" >&2
    return 1
  fi
}

. "$repo_root/tests/fixtures/all-work-resolved-retention.sh"

if [ "$selected_case" = "all" ]; then
# Main landing through the installed skill.
main_repo="$work/main-fixture"
make_repo "$main_repo"
printf 'base\n' >"$main_repo/README.md"
commit_all "$main_repo" 'fixture base'
main_before=$(git -C "$main_repo" rev-parse refs/heads/main)
branch_file "$main_repo" feature/main-fix main-feature.txt 'landed-on-main'
source_main_before=$(git -C "$main_repo" rev-parse refs/heads/feature/main-fix)
git -C "$main_repo" checkout -q -b release/preview main
preview_before=$(git -C "$main_repo" rev-parse refs/heads/release/preview)
main_refs_before="$work/main-refs.before"
snapshot_refs "$main_repo" "$main_refs_before"
run_agent main-landing "$main_repo" :workspace \
  'Run tailrocks-env-probe once before changing anything. Its successful output means the injected API/cloud-token canary was absent from this generated shell. Then use $tailrocks-repository-skills:repo-merge --local-only --cleanup=none feature/main-fix. This disposable repository has no remote. The omitted target must mean the literal main branch, never current HEAD or a remote default. Actually land the justified change on main, retain the source branch, make no network calls, and report only JSON: {"outcome":"landed-local","target_branch":"main","target_oid":"<oid>"}.'
test "$(cat "$TAILROCKS_ENV_POLICY_CANARY_LOG")" = absent
test "$(git -C "$main_repo" rev-parse refs/heads/main)" != "$main_before"
test "$(git -C "$main_repo" rev-parse refs/heads/feature/main-fix)" = "$source_main_before"
test "$(git -C "$main_repo" rev-parse --abbrev-ref HEAD)" = 'release/preview'
test "$(git -C "$main_repo" rev-parse refs/heads/release/preview)" = "$preview_before"
assert_refs_preserved_except "$main_repo" "$main_refs_before" refs/heads/main
test "$(git -C "$main_repo" show refs/heads/main:main-feature.txt)" = 'landed-on-main'
git -C "$main_repo" show-ref --verify --quiet refs/heads/feature/main-fix
assert_json_final "$work/main-landing.final.txt" '.outcome == "landed-local" and .target_branch == "main" and (.target_oid | type == "string" and length == 40)'
main_target_after=$(git -C "$main_repo" rev-parse refs/heads/main)
handoff_dir="$XDG_STATE_HOME/tailrocks/repo-merge/runs"
handoff_count=$(find "$handoff_dir" -type f -name '*.md' -print | wc -l | tr -d ' ')
test "$handoff_count" = 1
main_handoff=$(find "$handoff_dir" -type f -name '*.md' -print | sed -n '1p')
case "$main_handoff" in
  "$handoff_dir"/*.md) ;;
  *) echo "repo-merge handoff is outside its isolated XDG state root: $main_handoff" >&2; exit 1 ;;
esac
case "$main_handoff" in
  "$main_repo"/*) echo 'repo-merge handoff was written inside the fixture repository' >&2; exit 1 ;;
esac
grep -F -q 'feature/main-fix' "$main_handoff"
grep -F -q 'refs/heads/feature/main-fix' "$main_handoff"
grep -F -q "$source_main_before" "$main_handoff"
grep -F -q 'refs/heads/main' "$main_handoff"
grep -F -q "$main_target_after" "$main_handoff"
grep -Ei -q 'decision|action|landed-local' "$main_handoff"
grep -Ei -q 'test|validation' "$main_handoff"
grep -Ei -q 'CI|review' "$main_handoff"
grep -Ei -q 'cleanup' "$main_handoff"
grep -Ei -q 'blocker|next action' "$main_handoff"
record "verified=isolated XDG handoff created once outside fixture; exact request/source/main OIDs, decisions, validation, CI/review, cleanup, blocker/next action recorded at $main_handoff"
record 'verified=main target advanced; source retained; tree content independently checked'
record 'verified=generated shell environment omitted injected token canary'

# Multi-source non-main landing covers partial, equivalent, reverted, cleanup=none,
# and a no-op rerun. Fixture setup writes only disposable local history.
release_repo="$work/release-fixture"
make_repo "$release_repo"
printf 'core\n' >"$release_repo/capability.txt"
printf 'disabled\n' >"$release_repo/search.feature"
printf 'release/next requires search.feature=enabled\n' >"$release_repo/REQUIREMENTS.txt"
commit_all "$release_repo" 'fixture base'
release_main_before=$(git -C "$release_repo" rev-parse refs/heads/main)
branch_file "$release_repo" feature/auth auth.feature 'auth-enabled'
branch_file "$release_repo" feature/logging logging.feature 'structured-logging'
git -C "$release_repo" checkout -q -b feature/partial main
printf 'core\nexisting-target-line\nsource-only-line\n' >"$release_repo/capability.txt"
commit_all "$release_repo" 'fixture partial source'
git -C "$release_repo" checkout -q main
branch_file "$release_repo" feature/already already.txt 'already-present'
branch_file "$release_repo" feature/reverted search.feature 'enabled'
git -C "$release_repo" checkout -q -b release/next main
printf 'release-only\n' >"$release_repo/release-only.txt"
printf 'core\nexisting-target-line\n' >"$release_repo/capability.txt"
printf 'already-present\n' >"$release_repo/already.txt"
commit_all "$release_repo" 'fixture target already contains independent partial work'
printf 'enabled\n' >"$release_repo/search.feature"
commit_all "$release_repo" 'fixture prior equivalent search behavior'
prior_search_oid=$(git -C "$release_repo" rev-parse HEAD)
printf 'disabled\n' >"$release_repo/search.feature"
printf 'reverted target commit %s; requirement remains enabled\n' "$prior_search_oid" >"$release_repo/revert-record.txt"
commit_all "$release_repo" 'Revert prior equivalent search behavior'
git -C "$release_repo" checkout -q main
release_before=$(git -C "$release_repo" rev-parse refs/heads/release/next)
auth_before=$(git -C "$release_repo" rev-parse refs/heads/feature/auth)
logging_before=$(git -C "$release_repo" rev-parse refs/heads/feature/logging)
partial_before=$(git -C "$release_repo" rev-parse refs/heads/feature/partial)
already_before=$(git -C "$release_repo" rev-parse refs/heads/feature/already)
reverted_before=$(git -C "$release_repo" rev-parse refs/heads/feature/reverted)
release_refs_before="$work/release-refs.before"
snapshot_refs "$release_repo" "$release_refs_before"
run_agent non-main-multi-source "$release_repo" :workspace \
  'Use $tailrocks-repository-skills:repo-merge --local-only --cleanup=none --target-branch=release/next feature/auth feature/logging feature/partial feature/already feature/reverted. Land only justified source improvements onto release/next. Preserve release-only.txt and leave main unchanged. The target already contains part of feature/partial, all of feature/already, and had equivalent feature/reverted behavior that was explicitly reverted even though REQUIREMENTS.txt still requires it. Do not duplicate existing-target-line or already-present. Preserve every source ref because cleanup is none. Return JSON with outcome landed-local and the exact target branch/OID.'
test "$(git -C "$release_repo" rev-parse refs/heads/main)" = "$release_main_before"
test "$(git -C "$release_repo" rev-parse refs/heads/release/next)" != "$release_before"
test "$(git -C "$release_repo" rev-parse refs/heads/feature/auth)" = "$auth_before"
test "$(git -C "$release_repo" rev-parse refs/heads/feature/logging)" = "$logging_before"
test "$(git -C "$release_repo" rev-parse refs/heads/feature/partial)" = "$partial_before"
test "$(git -C "$release_repo" rev-parse refs/heads/feature/already)" = "$already_before"
test "$(git -C "$release_repo" rev-parse refs/heads/feature/reverted)" = "$reverted_before"
assert_refs_preserved_except "$release_repo" "$release_refs_before" refs/heads/release/next
test "$(git -C "$release_repo" show refs/heads/release/next:auth.feature)" = 'auth-enabled'
test "$(git -C "$release_repo" show refs/heads/release/next:logging.feature)" = 'structured-logging'
git -C "$release_repo" show refs/heads/release/next:capability.txt | grep -F -q 'source-only-line'
git -C "$release_repo" show refs/heads/release/next:capability.txt | grep -F -c 'existing-target-line' | grep -F -q '1'
git -C "$release_repo" show refs/heads/release/next:already.txt | grep -F -c 'already-present' | grep -F -q '1'
test "$(git -C "$release_repo" show refs/heads/release/next:search.feature)" = 'enabled'
test "$(git -C "$release_repo" show refs/heads/release/next:release-only.txt)" = 'release-only'
assert_json_final "$work/non-main-multi-source.final.txt" '.outcome == "landed-local" and .target_branch == "release/next" and (.target_oid | type == "string" and length == 40)'
record 'verified=multi-source non-main target advanced; main unchanged; partial/equivalent/reverted semantics and cleanup=none independently checked'

release_after_first=$(git -C "$release_repo" rev-parse refs/heads/release/next)
refs_before_rerun="$work/release-refs.before-rerun"
snapshot_refs "$release_repo" "$refs_before_rerun"
run_agent non-main-noop-rerun "$release_repo" :workspace \
  'Repeat the exact completed request: $tailrocks-repository-skills:repo-merge --local-only --cleanup=none --target-branch=release/next feature/auth feature/logging feature/partial feature/already feature/reverted. Verify the current target and report an idempotent no-op. Do not create a commit, branch, PR, or delete any source. Return JSON with outcome noop-local and the exact existing target OID.'
test "$(git -C "$release_repo" rev-parse refs/heads/release/next)" = "$release_after_first"
assert_same_refs "$release_repo" "$refs_before_rerun"
assert_json_final "$work/non-main-noop-rerun.final.txt" '.outcome == "noop-local" and .target_branch == "release/next" and .target_oid == "'"$release_after_first"'"'
record 'verified=no-op rerun preserved target OID and every branch ref'

# Audit-only must leave the target, source ref, and working tree untouched.
audit_repo="$work/audit-fixture"
make_repo "$audit_repo"
printf 'base\n' >"$audit_repo/README.md"
commit_all "$audit_repo" 'fixture base'
branch_file "$audit_repo" feature/audit audit.txt 'audit-only-source'
audit_before="$work/audit-refs.before"
snapshot_refs "$audit_repo" "$audit_before"
run_agent audit-only "$audit_repo" :workspace \
  'Use $tailrocks-repository-skills:repo-merge --audit-only --target-branch=main feature/audit. Inspect only. Do not edit files, refs, create commits or branches, contact a remote, or clean anything. Return JSON with outcome audit-only, target_branch main, the exact observed target_oid, and mutations: [].'
assert_same_refs "$audit_repo" "$audit_before"
test -z "$(git -C "$audit_repo" status --porcelain)"
assert_json_final "$work/audit-only.final.txt" '.outcome == "audit-only" and .target_branch == "main" and (.mutations | length == 0)'
record 'verified=audit-only preserved all refs and the clean tree'

# An empty source set is a usage error, never an implicit all-work cleanup.
no_source_repo="$work/no-source-fixture"
make_repo "$no_source_repo"
printf '*.local\n' >"$no_source_repo/.gitignore"
printf 'no-source base\n' >"$no_source_repo/README.md"
commit_all "$no_source_repo" 'fixture no-source base'
printf 'valuable untracked state\n' >"$no_source_repo/untracked.keep"
printf 'valuable ignored state\n' >"$no_source_repo/valuable.local"
no_source_before="$work/no-source-state.before"
snapshot_source_state "$no_source_repo" "$no_source_before"
no_source_find_log="$XDG_STATE_HOME/no-source-find.log"
: >"$no_source_find_log"
TAILROCKS_BLOCK_FIND=1
TAILROCKS_FIND_SHIM_LOG="$no_source_find_log"
export TAILROCKS_BLOCK_FIND TAILROCKS_FIND_SHIM_LOG
run_agent empty-selectors "$no_source_repo" :workspace \
  'Invoke $tailrocks-repository-skills:repo-merge --local-only --cleanup=resolved --target-branch=main with no source selectors. This is an empty-arguments/no-source request. Return a usage-error JSON result and stop before scanning, discovering, or cleaning anything. Do not reinterpret the empty source set as --all-work. Required JSON: {"outcome":"usage-error","cleanup":"not-run","scan_started":false}.'
assert_same_source_state "$no_source_repo" "$no_source_before"
test ! -s "$no_source_find_log"
assert_json_final "$work/empty-selectors.final.txt" '.outcome == "usage-error" and .cleanup == "not-run" and .scan_started == false'
no_source_sentinel_log="$XDG_STATE_HOME/no-source-sentinel-find.log"
: >"$no_source_sentinel_log"
TAILROCKS_FIND_SHIM_LOG="$no_source_sentinel_log"
export TAILROCKS_FIND_SHIM_LOG
run_agent no-source-sentinel "$no_source_repo" :workspace \
  'Use $tailrocks-repository-skills:repo-merge --no-source --local-only --cleanup=resolved --target-branch=main. Treat --no-source as an empty source request, never as --all-work or global cleanup. Reject with usage-error JSON and do not scan or mutate.'
assert_same_source_state "$no_source_repo" "$no_source_before"
test ! -s "$no_source_sentinel_log"
assert_json_final "$work/no-source-sentinel.final.txt" '.outcome == "usage-error" and .cleanup == "not-run" and .scan_started == false'
unset TAILROCKS_BLOCK_FIND TAILROCKS_FIND_SHIM_LOG
record 'verified=empty/no-source requests returned usage error without host discovery, global scan, cleanup, or local-state changes'

# Resume one target-bound, audit-only handoff from the isolated XDG state root.
resume_repo="$work/resume-fixture"
make_repo "$resume_repo"
printf 'resume base\n' >"$resume_repo/README.md"
commit_all "$resume_repo" 'fixture resume base'
git -C "$resume_repo" checkout -q -b release/next main
printf 'release target\n' >"$resume_repo/RELEASE.txt"
commit_all "$resume_repo" 'fixture release target'
resume_target_before=$(git -C "$resume_repo" rev-parse refs/heads/release/next)
git -C "$resume_repo" checkout -q -b feature/resume main
printf 'unfinished source\n' >"$resume_repo/resume-source.txt"
commit_all "$resume_repo" 'fixture resume source'
resume_source_before=$(git -C "$resume_repo" rev-parse refs/heads/feature/resume)
git -C "$resume_repo" checkout -q release/next
resume_refs_before="$work/resume-refs.before"
snapshot_refs "$resume_repo" "$resume_refs_before"
resume_run_dir="$XDG_STATE_HOME/tailrocks/repo-merge/runs"
mkdir -p "$resume_run_dir"
cat >"$resume_run_dir/resume-fixture.md" <<EOF
# repo-merge progress handoff

- Run ID: resume-fixture
- Original request and authority: user explicitly requested an audit-only comparison of feature/resume into release/next.
- Repository: $resume_repo
- Exact target: branch release/next; ref refs/heads/release/next; observed OID $resume_target_before.
- Exact source set: feature/resume; ref refs/heads/feature/resume; observed OID $resume_source_before.
- Decisions/actions: bound one local repository and one target; no mutation performed.
- Tests run/results: fixture refs captured; audit and target-relative comparison remain pending.
- Review, CI, and landing: not applicable to this audit-only local run.
- Cleanup status/results: disabled; cleanup=none.
- Recovery location: none.
- Blockers: none recorded.
- Deterministic next action: refresh the same source and target identities, then perform the requested audit-only comparison.
EOF
TAILROCKS_BLOCK_FIND=1
TAILROCKS_FIND_SHIM_LOG="$XDG_STATE_HOME/resume-find.log"
export TAILROCKS_BLOCK_FIND TAILROCKS_FIND_SHIM_LOG
run_agent resume-audit "$resume_repo" :workspace \
  'Use $tailrocks-repository-skills:repo-merge --resume resume-fixture with no new selectors or target override. Resume the recorded audit-only run from the isolated XDG handoff, refresh its exact source and release/next target OIDs, and do not mutate or clean anything. Return JSON with outcome audit-only, target_branch release/next, target_oid, source_oid, and resumed_run_id resume-fixture.'
assert_same_refs "$resume_repo" "$resume_refs_before"
test "$(git -C "$resume_repo" rev-parse refs/heads/release/next)" = "$resume_target_before"
test "$(git -C "$resume_repo" rev-parse refs/heads/feature/resume)" = "$resume_source_before"
test -s "$resume_run_dir/resume-fixture.md"
test ! -s "$XDG_STATE_HOME/resume-find.log"
unset TAILROCKS_BLOCK_FIND TAILROCKS_FIND_SHIM_LOG
assert_json_final "$work/resume-audit.final.txt" '.outcome == "audit-only" and .target_branch == "release/next" and .target_oid == "'"$resume_target_before"'" and .source_oid == "'"$resume_source_before"'" and .resumed_run_id == "resume-fixture"'
record 'verified=resume refreshed exact target/source in isolated XDG state; no new selectors or refs changed'

# Dirty/valuable ignored state and an active writer must remain recoverable.
retention_root="$work/retention"
retention_repo="$retention_root/repository"
dirty_copy="$retention_root/dirty-copy"
active_copy="$retention_root/active-copy"
mkdir -p "$retention_root"
make_repo "$retention_repo"
printf '*.local\n' >"$retention_repo/.gitignore"
printf 'base\n' >"$retention_repo/README.md"
printf 'committed user notes\n' >"$retention_repo/user-notes.txt"
commit_all "$retention_repo" 'fixture base'
git -C "$retention_repo" remote add origin https://github.com/acme/retention-fixture.git
git -C "$retention_repo" branch release/next
branch_file "$retention_repo" feature/dirty dirty-feature.txt 'dirty-source-work'
branch_file "$retention_repo" feature/active active-feature.txt 'active-source-work'
git -C "$retention_repo" checkout -q release/next
printf 'dirty-source-work\n' >"$retention_repo/dirty-feature.txt"
printf 'active-source-work\n' >"$retention_repo/active-feature.txt"
commit_all "$retention_repo" 'fixture target behavior snapshot'
git -C "$retention_repo" checkout -q release/next
git clone -q --local --no-hardlinks "$retention_repo" "$dirty_copy"
git -C "$dirty_copy" branch release/next origin/release/next
git -C "$dirty_copy" checkout -q -b feature/dirty origin/feature/dirty
printf 'tracked dirty retention marker\n' >"$dirty_copy/user-notes.txt"
printf 'untracked retention marker\n' >"$dirty_copy/untracked.notes"
printf 'valuable ignored retention marker\n' >"$dirty_copy/valuable.local"
git clone -q --local --no-hardlinks "$retention_repo" "$active_copy"
git -C "$active_copy" branch release/next origin/release/next
git -C "$active_copy" checkout -q -b feature/active origin/feature/active
active_source_before=$(git -C "$active_copy" rev-parse HEAD)
(
  while [ ! -f "$writer_stop" ]; do
    printf 'active writer marker\n' >>"$active_copy/active-writer.log"
    sleep 1
  done
) >/dev/null 2>&1 &
writer_pid=$!
printf '%s\n' "$writer_pid" >"$retention_root/writer.pid"
attempt=0
while [ ! -s "$active_copy/active-writer.log" ] && [ "$attempt" -lt 10 ]; do
  sleep 1
  attempt=$((attempt + 1))
done
test -s "$active_copy/active-writer.log"
active_writer_bytes_before=$(wc -c <"$active_copy/active-writer.log" | tr -d '[:space:]')
dirty_refs_before="$work/dirty-copy-refs.before"
snapshot_refs "$dirty_copy" "$dirty_refs_before"
dirty_source_before="$work/dirty-copy-state.before"
snapshot_source_state "$dirty_copy" "$dirty_source_before"
active_refs_before="$work/active-copy-refs.before"
snapshot_refs "$active_copy" "$active_refs_before"
active_status_before=$(git -C "$active_copy" status --porcelain=v2 --branch --untracked-files=all)
active_feature_hash_before=$(record_hash "$active_copy/active-feature.txt")
retention_target_before=$(git -C "$retention_repo" rev-parse refs/heads/release/next)
retention_runner="$work/retention-runner"
mkdir -p "$retention_runner"
run_agent retention-guards "$retention_runner" :workspace \
  "Use \$tailrocks-repository-skills:repo-merge --repo=acme/retention-fixture --all-work --audit-only --target-branch=release/next with no source selectors. The only authorized scan root is $retention_root. Discover matching repository copies and worktrees from that root; inspect their refs, tracked/untracked/ignored changes, and active-writer indicators. This audit cannot authorize recovery or cleanup. Report any resolved source candidates, but do not mutate or stop writers. This fixture-only inventory is scoped to the declared root; do not claim host-wide coverage. Return JSON with outcome audit-only, target_oid, scan_roots, discovered_resources[{path,refs,tracked_paths,untracked_paths,ignored_paths}], retained_resources with exact reasons, coverage_complete:false, and coverage_gaps." "$retention_root"
kill -0 "$writer_pid" 2>/dev/null || {
  echo "the active fixture writer was stopped by the agent" >&2
  exit 1
}
active_writer_state=$(ps -p "$writer_pid" -o stat= 2>/dev/null | tr -d '[:space:]' || true)
case "$active_writer_state" in
  ''|*Z*)
    echo "the active fixture writer is not running (state: ${active_writer_state:-missing})" >&2
    exit 1
    ;;
esac
active_writer_bytes_after=$(wc -c <"$active_copy/active-writer.log" | tr -d '[:space:]')
if [ "$active_writer_bytes_after" -le "$active_writer_bytes_before" ]; then
  echo "the active fixture writer did not advance its marker after agent execution" >&2
  exit 1
fi
test -d "$dirty_copy" && test -d "$active_copy"
test "$(git -C "$dirty_copy" show HEAD:user-notes.txt)" = 'committed user notes'
grep -F -q 'tracked dirty retention marker' "$dirty_copy/user-notes.txt"
grep -F -q 'untracked retention marker' "$dirty_copy/untracked.notes"
grep -F -q 'valuable ignored retention marker' "$dirty_copy/valuable.local"
grep -F -q 'active writer marker' "$active_copy/active-writer.log"
test "$(git -C "$active_copy" rev-parse HEAD)" = "$active_source_before"
assert_same_refs "$dirty_copy" "$dirty_refs_before"
assert_same_refs "$active_copy" "$active_refs_before"
assert_same_source_state "$dirty_copy" "$dirty_source_before"
test "$(git -C "$active_copy" status --porcelain=v2 --branch --untracked-files=all)" = "$active_status_before"
test "$(record_hash "$active_copy/active-feature.txt")" = "$active_feature_hash_before"
test "$(git -C "$retention_repo" rev-parse refs/heads/release/next)" = "$retention_target_before"
assert_json_final "$work/retention-guards.final.txt" \
  '.outcome == "audit-only" and .target_oid == "'"$retention_target_before"'" and .coverage_complete == false and .scan_roots == ["'"$retention_root"'"] and
   ([.discovered_resources[] | select(.path == "'"$retention_repo"'") | .refs[] | select(.ref == "refs/heads/release/next" and .oid == "'"$retention_target_before"'")] | length == 1) and
   ([.discovered_resources[] | select(.path == "'"$dirty_copy"'") | .refs[] | select(.ref == "refs/heads/feature/dirty" and .oid == "'"$(git -C "$dirty_copy" rev-parse refs/heads/feature/dirty)"'")] | length == 1) and
   ([.discovered_resources[] | select(.path == "'"$active_copy"'") | .refs[] | select(.ref == "refs/heads/feature/active" and .oid == "'"$active_source_before"'")] | length == 1) and
  ([.retained_resources[] | select(.path == "'"$dirty_copy"'") | .reason] | .[0] | test("dirty|untracked|ignored"; "i")) and
   ([.retained_resources[] | select(.path == "'"$active_copy"'") | .reason] | .[0] | test("active|writer|in progress"; "i")) and
   ([.discovered_resources[] | select(.path == "'"$dirty_copy"'") | .ignored_paths | index("valuable.local")] | .[0] != null) and
   (.coverage_gaps | length > 0)'
record 'verified=all-work audit reported dirty/ignored and actively written source clones; cleanup retention is unproven because scan root is read-only'
: >"$writer_stop"
wait "$writer_pid" 2>/dev/null || true
writer_pid=

run_all_work_resolved_retention_case

# All-work audit is bounded by Codex's disposable workspace/add-dir sandbox.
all_root="$work/all-work-root"
all_repo="$all_root/canonical"
related_clone="$all_root/related-clone"
linked_worktree="$all_root/linked-worktree"
unrelated_repo="$all_root/unrelated-same-name"
all_runner="$work/all-work-runner"
mkdir -p "$all_root"
make_repo "$all_repo"
printf 'all-work fixture\n' >"$all_repo/README.md"
commit_all "$all_repo" 'fixture base'
branch_file "$all_repo" feature/scan scan-source.txt 'scan-source-work'
git -C "$all_repo" worktree add -q -b feature/worktree "$linked_worktree" main
printf 'linked worktree dirty marker\n' >"$linked_worktree/worktree-dirty.txt"
git clone -q --local --no-hardlinks "$all_repo" "$related_clone"
git -C "$all_repo" remote add origin https://github.com/acme/all-work.git
git -C "$related_clone" remote set-url origin https://github.com/acme/all-work.git
git -C "$related_clone" checkout -q -b feature/scan origin/feature/scan
printf 'related clone untracked marker\n' >"$related_clone/clone-untracked.txt"
mkdir -p "$all_runner"
make_repo "$unrelated_repo"
git -C "$unrelated_repo" remote add origin https://github.com/acme/unrelated.git
printf 'unrelated identity control\n' >"$unrelated_repo/README.md"
commit_all "$unrelated_repo" 'unrelated control'
all_state_before="$work/all-work-canonical.before"
snapshot_source_state "$all_repo" "$all_state_before"
related_state_before="$work/all-work-related.before"
snapshot_source_state "$related_clone" "$related_state_before"
worktree_state_before="$work/all-work-worktree.before"
snapshot_source_state "$linked_worktree" "$worktree_state_before"
canonical_refs_json=$(git -C "$all_repo" for-each-ref --format='{"ref":"%(refname)","oid":"%(objectname)"}' refs | jq -s 'sort_by(.ref)')
related_refs_json=$(git -C "$related_clone" for-each-ref --format='{"ref":"%(refname)","oid":"%(objectname)"}' refs | jq -s 'sort_by(.ref)')
worktree_refs_json=$(git -C "$linked_worktree" for-each-ref --format='{"ref":"%(refname)","oid":"%(objectname)"}' refs | jq -s 'sort_by(.ref)')
run_agent all-work-coverage "$all_runner" :workspace \
  "Use \$tailrocks-repository-skills:repo-merge --repo=acme/all-work --all-work --audit-only --target-branch=main. The only authorized scan root is $all_root. Discover every matching repository copy and worktree from repository identity under that root. Return strict JSON with fixture_root_complete:true, coverage_complete:false, exact scan_roots, discovered_resources[{path,refs:[{ref,oid}],dirty,untracked_paths}], excluded_resources[{path,reason}], and nonempty coverage_gaps because host-wide roots are intentionally outside this fixture's scope. Do not claim host-wide coverage. Do not mutate anything." "$all_root"
assert_same_source_state "$all_repo" "$all_state_before"
assert_same_source_state "$related_clone" "$related_state_before"
assert_same_source_state "$linked_worktree" "$worktree_state_before"
test -f "$related_clone/clone-untracked.txt"
test -f "$linked_worktree/worktree-dirty.txt"
assert_json_final "$work/all-work-coverage.final.txt" \
  '.outcome == "audit-only" and .fixture_root_complete == true and .coverage_complete == false and .scan_roots == ["'"$all_root"'"] and (.coverage_gaps | length > 0) and
   ([.discovered_resources[] | select(.path == "'"$all_repo"'") | .refs] | .[0] == '"$(printf '%s' "$canonical_refs_json")"') and
   ([.discovered_resources[] | select(.path == "'"$all_repo"'") | .dirty] | .[0] == false) and
   ([.discovered_resources[] | select(.path == "'"$related_clone"'") | .refs] | .[0] == '"$(printf '%s' "$related_refs_json")"') and
   ([.discovered_resources[] | select(.path == "'"$related_clone"'") | .dirty] | .[0] == true) and
   ([.discovered_resources[] | select(.path == "'"$related_clone"'") | .untracked_paths | index("clone-untracked.txt")] | .[0] != null) and
   ([.discovered_resources[] | select(.path == "'"$linked_worktree"'") | .refs] | .[0] == '"$(printf '%s' "$worktree_refs_json")"') and
   ([.discovered_resources[] | select(.path == "'"$linked_worktree"'") | .dirty] | .[0] == true) and
   ([.discovered_resources[] | select(.path == "'"$linked_worktree"'") | .untracked_paths | index("worktree-dirty.txt")] | .[0] != null) and
   ([.discovered_resources[] | select(.path == "'"$unrelated_repo"'")] | length == 0) and
   ([.excluded_resources[] | select(.path == "'"$unrelated_repo"'") | .reason] | .[0] | test("identity"; "i"))'
record 'verified=all-work audit accounted for canonical clone, related clone, linked worktree, dirty marker and explicit unrelated control; no refs changed'

# Recover a plainly documented unfinished goal into a distinct branch based on
# the selected target. The dirty source clone is an immutable recovery source.
recovery_root="$work/recovery-scope"
recovery_repo="$recovery_root/canonical"
unfinished_copy="$recovery_root/unfinished-copy"
recovery_candidate="$work/recovery-candidate"
recovery_proof="$work/recovery-restore-proof"
mkdir -p "$recovery_root" "$recovery_proof"
make_repo "$recovery_repo"
printf '*.local\n' >"$recovery_repo/.gitignore"
printf 'mode=standard\ntarget=generic\n' >"$recovery_repo/worker.ini"
printf 'durability=volatile\n' >"$recovery_repo/queue.ini"
printf 'base\n' >"$recovery_repo/README.md"
commit_all "$recovery_repo" 'fixture recovery base'
recovery_main_before=$(git -C "$recovery_repo" rev-parse refs/heads/main)
git -C "$recovery_repo" checkout -q -b release/next main
printf 'mode=standard\ntarget=release-next\n' >"$recovery_repo/worker.ini"
printf 'release/next requires mode=release and durable queue\n' >"$recovery_repo/REQUIREMENTS.txt"
commit_all "$recovery_repo" 'fixture release target requirements'
recovery_target_before=$(git -C "$recovery_repo" rev-parse refs/heads/release/next)
git -C "$recovery_repo" checkout -q main
branch_file "$recovery_repo" feature/non-target non-target.txt 'must-survive-recovery'
recovery_non_target_before=$(git -C "$recovery_repo" rev-parse refs/heads/feature/non-target)
git -C "$recovery_repo" checkout -q main
git -C "$recovery_repo" remote add origin https://github.com/acme/recovery-fixture.git
git clone -q --local --no-hardlinks "$recovery_repo" "$recovery_candidate"
git -C "$recovery_candidate" remote set-url origin https://github.com/acme/recovery-fixture.git
git -C "$recovery_candidate" checkout -q -b release/next origin/release/next
recovery_candidate_target_before=$(git -C "$recovery_candidate" rev-parse refs/heads/release/next)
test "$recovery_candidate_target_before" = "$recovery_target_before"
recovery_candidate_main_before=$(git -C "$recovery_candidate" rev-parse refs/heads/main)
recovery_candidate_refs_before="$work/recovery-candidate-refs.before"
snapshot_refs "$recovery_candidate" "$recovery_candidate_refs_before"
git clone -q --local --no-hardlinks "$recovery_repo" "$unfinished_copy"
git -C "$unfinished_copy" checkout -q -b work/unfinished-goal origin/main
cat >"$unfinished_copy/WORK_ITEM.md" <<'EOF'
# Unfinished goal: release worker mode

The `release/next` requirement is to set `worker.ini` to `mode=release` and
`queue.ini` to `durability=durable`. Preserve the selected target's own
`target=release-next` setting. The current work is incomplete and must be
recovered from this working copy into a separate candidate based on the exact
`release/next` target. Do not rewrite the original work copy.
EOF
commit_all "$unfinished_copy" 'record unfinished release-worker goal'
printf 'mode=release\ntarget=generic\n' >"$unfinished_copy/worker.ini"
printf 'durability=durable\n' >"$unfinished_copy/queue.ini"
git -C "$unfinished_copy" add queue.ini
printf 'acceptance notes for recovered release worker\n' >"$unfinished_copy/proof-notes.txt"
printf 'valuable ignored recovery cache\n' >"$unfinished_copy/recovery-cache.local"
unfinished_head_before=$(git -C "$unfinished_copy" rev-parse HEAD)
unfinished_state_before="$work/unfinished-source.before"
snapshot_source_state "$unfinished_copy" "$unfinished_state_before"
recovery_refs_before="$work/recovery-repo-refs.before"
snapshot_refs "$recovery_repo" "$recovery_refs_before"
run_agent recover-unfinished-goal "$recovery_candidate" :workspace \
  "Use \$tailrocks-repository-skills:repo-merge --all-work --local-only --cleanup=none --target-branch=release/next. The only authorized source scan root is $recovery_root; treat it as read-only. Discover eligible repositories, source-local goals, and recovery evidence only through the installed skill within that root; do not assume or name candidate paths or object IDs. The repository selected for this invocation is the independent writable target candidate. Recover only a clearly attributable unfinished goal whose acceptance criteria still apply to release/next. First snapshot and restore-test all unique source data, including refs/HEAD, index, staged and unstaged changes, untracked work, and valuable ignored files, under the supplied recovery artifact root. Compare the restored state and bytes before importing anything. Re-read the current exact release/next ref and object ID immediately before creating a new target-based branch; preserve target behavior and apply only the explicit goal. Keep discovered original sources entirely read-only; make no recovery action there. If source provenance or snapshot/restore is incomplete, stop blocked and retain everything. Return JSON with outcome landed-local, target_branch release/next, exact target_oid, candidate_branch, recovered_goal:true, restore_test:passed, restore_test_path, and snapshot_path." "$recovery_root" "$recovery_proof"
test -d "$unfinished_copy"
test "$(git -C "$unfinished_copy" rev-parse HEAD)" = "$unfinished_head_before"
assert_same_source_state "$unfinished_copy" "$unfinished_state_before"
assert_same_refs "$recovery_repo" "$recovery_refs_before"
test "$(git -C "$recovery_repo" rev-parse refs/heads/release/next)" = "$recovery_target_before"
test "$(git -C "$recovery_repo" rev-parse refs/heads/main)" = "$recovery_main_before"
test "$(git -C "$recovery_repo" rev-parse refs/heads/feature/non-target)" = "$recovery_non_target_before"
test "$(git -C "$recovery_candidate" rev-parse refs/heads/release/next)" != "$recovery_candidate_target_before"
test "$(git -C "$recovery_candidate" rev-parse refs/heads/main)" = "$recovery_candidate_main_before"
assert_refs_preserved_except "$recovery_candidate" "$recovery_candidate_refs_before" refs/heads/release/next
test "$(git -C "$recovery_candidate" show refs/heads/release/next:worker.ini)" = "$(printf 'mode=release\ntarget=release-next')"
test "$(git -C "$recovery_candidate" show refs/heads/release/next:queue.ini)" = 'durability=durable'
test "$(git -C "$recovery_candidate" show refs/heads/release/next:REQUIREMENTS.txt)" = 'release/next requires mode=release and durable queue'
recovery_target_after=$(git -C "$recovery_candidate" rev-parse refs/heads/release/next)
candidate_branch=$(jq -r '.candidate_branch // empty' "$work/recover-unfinished-goal.final.txt")
case "$candidate_branch" in
  refs/heads/*) candidate_ref=$candidate_branch; candidate_name=${candidate_branch#refs/heads/} ;;
  *) candidate_name=$candidate_branch; candidate_ref="refs/heads/$candidate_branch" ;;
esac
test -n "$candidate_name"
test "$candidate_name" != main
test "$candidate_name" != release/next
git -C "$recovery_candidate" check-ref-format "$candidate_ref" >/dev/null
git -C "$recovery_candidate" show-ref --verify --quiet "$candidate_ref"
if grep -F -q "$candidate_ref " "$recovery_candidate_refs_before"; then
  echo "recovery candidate was not a new target-based ref: $candidate_ref" >&2
  exit 1
fi
git -C "$recovery_candidate" merge-base --is-ancestor "$recovery_candidate_target_before" "$candidate_ref"
git -C "$recovery_candidate" merge-base --is-ancestor "$candidate_ref" refs/heads/release/next
test "$(git -C "$recovery_candidate" show "$candidate_ref:worker.ini")" = "$(printf 'mode=release\ntarget=release-next')"
test "$(git -C "$recovery_candidate" show "$candidate_ref:queue.ini")" = 'durability=durable'
test -d "$recovery_proof/restore-test"
cmp -s "$unfinished_state_before.refs" "$recovery_proof/snapshot/source-refs.txt"
cmp -s "$unfinished_state_before.status" "$recovery_proof/snapshot/source-status.txt"
test "$(git -C "$recovery_proof/restore-test" rev-parse HEAD)" = "$unfinished_head_before"
git -C "$recovery_proof/restore-test" diff --binary >"$work/recovery-restore-unstaged.actual"
git -C "$recovery_proof/restore-test" diff --cached --binary >"$work/recovery-restore-staged.actual"
git -C "$recovery_proof/restore-test" diff --cached --binary >"$work/recovery-restore-staged.expected"
cmp -s "$unfinished_state_before.unstaged" "$work/recovery-restore-unstaged.actual"
cmp -s "$unfinished_state_before.staged" "$work/recovery-restore-staged.actual"
git -C "$unfinished_copy" ls-files --stage >"$work/recovery-source-index-entries"
git -C "$recovery_proof/restore-test" ls-files --stage >"$work/recovery-restore-index-entries"
cmp -s "$work/recovery-source-index-entries" "$work/recovery-restore-index-entries"
test "$(git -C "$unfinished_copy" status --porcelain=v2 --branch --untracked-files=all)" = "$(git -C "$recovery_proof/restore-test" status --porcelain=v2 --branch --untracked-files=all)"
cmp -s "$unfinished_copy/proof-notes.txt" "$recovery_proof/snapshot/untracked/proof-notes.txt"
cmp -s "$unfinished_copy/recovery-cache.local" "$recovery_proof/snapshot/ignored/recovery-cache.local"
cmp -s "$unfinished_copy/proof-notes.txt" "$recovery_proof/restore-test/proof-notes.txt"
cmp -s "$unfinished_copy/recovery-cache.local" "$recovery_proof/restore-test/recovery-cache.local"
cmp -s "$unfinished_copy/worker.ini" "$recovery_proof/restore-test/worker.ini"
cmp -s "$unfinished_copy/queue.ini" "$recovery_proof/restore-test/queue.ini"
cmp -s "$unfinished_state_before.index" "$recovery_proof/snapshot/source-index.bin"
cmp -s "$unfinished_state_before.staged" "$recovery_proof/snapshot/staged.patch"
cmp -s "$unfinished_state_before.unstaged" "$recovery_proof/snapshot/unstaged.patch"
assert_json_final "$work/recover-unfinished-goal.final.txt" '.outcome == "landed-local" and .target_branch == "release/next" and (.candidate_branch | type == "string" and length > 0) and .recovered_goal == true and .restore_test == "passed"'
test "$(jq -r '.candidate_branch' "$work/recover-unfinished-goal.final.txt")" = "$candidate_branch"
test "$(jq -r '.target_oid' "$work/recover-unfinished-goal.final.txt")" = "$recovery_target_after"
test "$(jq -r '.restore_test_path' "$work/recover-unfinished-goal.final.txt")" = "$recovery_proof/restore-test"
test "$(jq -r '.snapshot_path' "$work/recover-unfinished-goal.final.txt")" = "$recovery_proof/snapshot"
record 'verified=dirty source stayed byte/ref/index identical; snapshot restored staged/unstaged/untracked/ignored data; new target-based candidate outside source roots advanced release/next'

# cleanup=resolved must route to its separate owner, snapshot and restore-test
# the selected source, then remove only that selected source ref.
cleanup_root="$work/cleanup-resolved-scope"
cleanup_repo="$cleanup_root/repository"
cleanup_proof="$work/cleanup-recovery-proof"
cleanup_bundle="$cleanup_proof/feature-resolved.bundle"
cleanup_restore="$cleanup_proof/restore-test"
mkdir -p "$cleanup_root" "$cleanup_proof"
make_repo "$cleanup_repo"
printf 'base\n' >"$cleanup_repo/README.md"
commit_all "$cleanup_repo" 'fixture cleanup base'
cleanup_main_before=$(git -C "$cleanup_repo" rev-parse refs/heads/main)
git -C "$cleanup_repo" checkout -q -b release/next main
printf 'release/next\n' >"$cleanup_repo/RELEASE.txt"
commit_all "$cleanup_repo" 'fixture cleanup target'
cleanup_target_before=$(git -C "$cleanup_repo" rev-parse refs/heads/release/next)
git -C "$cleanup_repo" checkout -q main
branch_file "$cleanup_repo" feature/resolved resolved.txt 'selected-source-content'
cleanup_source_before=$(git -C "$cleanup_repo" rev-parse refs/heads/feature/resolved)
branch_file "$cleanup_repo" feature/non-target non-target.txt 'preserve-non-target'
cleanup_non_target_before=$(git -C "$cleanup_repo" rev-parse refs/heads/feature/non-target)
branch_file "$cleanup_repo" feature/preserved preserved.txt 'preserve-other-source'
cleanup_preserved_before=$(git -C "$cleanup_repo" rev-parse refs/heads/feature/preserved)
git -C "$cleanup_repo" checkout -q main
run_agent resolved-cleanup "$cleanup_repo" :workspace \
  "Use \$tailrocks-repository-skills:repo-merge --local-only --cleanup=resolved --target-branch=release/next feature/resolved. This explicitly authorizes deleting only refs/heads/feature/resolved in this disposable repository, after its justified change is locally landed on exact release/next. Use repo-merge's local cleanup finalization procedure; do not programmatically invoke the standalone manual-only cleanup skill. Before deletion create a full Git bundle snapshot at $cleanup_bundle, restore it into a disposable repository at $cleanup_restore, and verify the restored refs/heads/feature/resolved OID and resolved.txt byte-for-byte match the original source OID $cleanup_source_before. Only after that real restore test and fresh identity recheck may local finalization remove the selected feature/resolved ref. Preserve main, the release/next target, feature/non-target, feature/preserved, and both recovery artifacts. No remote writes. Return JSON with outcome landed-local, exact target branch/OID, restore_test passed, snapshot_path, restored_source_oid, and deleted_refs containing only refs/heads/feature/resolved." "$cleanup_root" "$cleanup_proof"
test "$(git -C "$cleanup_repo" rev-parse refs/heads/main)" = "$cleanup_main_before"
test "$(git -C "$cleanup_repo" rev-parse refs/heads/feature/non-target)" = "$cleanup_non_target_before"
test "$(git -C "$cleanup_repo" rev-parse refs/heads/feature/preserved)" = "$cleanup_preserved_before"
test "$(git -C "$cleanup_repo" rev-parse refs/heads/release/next)" != "$cleanup_target_before"
if git -C "$cleanup_repo" show-ref --verify --quiet refs/heads/feature/resolved; then
  echo 'resolved cleanup left the selected source ref present' >&2
  exit 1
fi
test "$(git -C "$cleanup_repo" show refs/heads/release/next:resolved.txt)" = 'selected-source-content'
test "$(git -C "$cleanup_repo" show refs/heads/release/next:RELEASE.txt)" = 'release/next'
test -s "$cleanup_bundle"
git bundle verify "$cleanup_bundle" >"$work/cleanup-bundle-verify.txt" 2>&1
git bundle list-heads "$cleanup_bundle" | awk -v oid="$cleanup_source_before" '$1 == oid && $2 == "refs/heads/feature/resolved" { found = 1 } END { exit !found }'
test -d "$cleanup_restore"
test "$(git -C "$cleanup_restore" rev-parse refs/heads/feature/resolved)" = "$cleanup_source_before"
test "$(git -C "$cleanup_restore" show refs/heads/feature/resolved:resolved.txt)" = 'selected-source-content'
cleanup_target_after=$(git -C "$cleanup_repo" rev-parse refs/heads/release/next)
assert_json_final "$work/resolved-cleanup.final.txt" '.outcome == "landed-local" and .target_branch == "release/next" and .restore_test == "passed" and .deleted_refs == ["refs/heads/feature/resolved"]'
test "$(jq -r '.target_oid' "$work/resolved-cleanup.final.txt")" = "$cleanup_target_after"
test "$(jq -r '.snapshot_path' "$work/resolved-cleanup.final.txt")" = "$cleanup_bundle"
test "$(jq -r '.restored_source_oid' "$work/resolved-cleanup.final.txt")" = "$cleanup_source_before"
record 'verified=selected-source deletion and restore test independently observed; distinct cleanup-owner invocation not independently receipted'

# A deterministic, local GitHub API fixture supplies two pages (including a
# draft). The installed skill must freeze both pages for a /pulls selector.
selector_repo="$work/pagination-fixture"
make_repo "$selector_repo"
printf 'selector fixture\n' >"$selector_repo/README.md"
commit_all "$selector_repo" 'fixture base'
branch_file "$selector_repo" feature/paged-one paged-one.txt 'page-one-source'
branch_file "$selector_repo" feature/paged-two paged-two.txt 'page-two-source'
git -C "$selector_repo" remote add origin https://github.com/acme/fixture.git
page1_oid=$(git -C "$selector_repo" rev-parse refs/heads/feature/paged-one)
page2_oid=$(git -C "$selector_repo" rev-parse refs/heads/feature/paged-two)
main_oid=$(git -C "$selector_repo" rev-parse refs/heads/main)
mkdir -p "$TAILROCKS_GH_FIXTURE_DIR/pagination"
jq -n --arg head "$page1_oid" --arg base "$main_oid" '[{number:41,state:"open",draft:false,head:{ref:"feature/paged-one",sha:$head,repo:{full_name:"acme/fixture"}},base:{ref:"main",sha:$base,repo:{full_name:"acme/fixture"}}}]' >"$TAILROCKS_GH_FIXTURE_DIR/pagination/page1.json"
jq -n --arg head "$page2_oid" --arg base "$main_oid" '[{number:42,state:"open",draft:true,head:{ref:"feature/paged-two",sha:$head,repo:{full_name:"acme/fixture"}},base:{ref:"main",sha:$base,repo:{full_name:"acme/fixture"}}}]' >"$TAILROCKS_GH_FIXTURE_DIR/pagination/page2.json"
selector_refs_before="$work/pagination-refs.before"
snapshot_refs "$selector_repo" "$selector_refs_before"
GH_FIXTURE_KIND=pagination
export GH_FIXTURE_KIND
: >"$TAILROCKS_GH_FIXTURE_LOG"
run_agent selector-pagination "$selector_repo" :workspace \
  'Use $tailrocks-repository-skills:repo-merge --audit-only --target-branch=main https://github.com/acme/fixture/pulls?state=open&page=2. The installed gh client returns synthetic local fixture data only; this proves selector handling, not live GitHub state. The page=2 presentation parameter must not truncate listing membership. Return JSON with outcome audit-only, selected_prs:[{number,head_ref,head_oid,base_ref,base_oid}], included_drafts:[42], and pagination_complete:true.'
assert_same_refs "$selector_repo" "$selector_refs_before"
grep -F -q '41' "$work/selector-pagination.final.txt"
grep -F -q '42' "$work/selector-pagination.final.txt"
grep -F -q -- '--paginate' "$TAILROCKS_GH_FIXTURE_LOG" || \
  grep -F -q -- '--limit' "$TAILROCKS_GH_FIXTURE_LOG"
assert_json_final "$work/selector-pagination.final.txt" \
  '.outcome == "audit-only" and ([.selected_prs[] | select(.number == 41 and .head_ref == "feature/paged-one" and .head_oid == "'"$page1_oid"'" and .base_ref == "main" and .base_oid == "'"$main_oid"'")] | length == 1) and ([.selected_prs[] | select(.number == 42 and .head_ref == "feature/paged-two" and .head_oid == "'"$page2_oid"'" and .base_ref == "main" and .base_oid == "'"$main_oid"'")] | length == 1) and (.included_drafts | index(42)) != null and .pagination_complete == true'
record 'verified=local API pagination fixture selected both PR pages and retained the draft; no refs changed'

# Mixed branch/PR selectors and a paginated /branches/all URL retain exact
# identity while all selection comes from the fixture API.
selector_mix_repo="$work/mixed-selector-fixture"
make_repo "$selector_mix_repo"
printf 'mixed selector base\n' >"$selector_mix_repo/README.md"
commit_all "$selector_mix_repo" 'fixture mixed-selector base'
branch_file "$selector_mix_repo" feature/mixed-one mixed-one.txt 'mixed-branch-one'
branch_file "$selector_mix_repo" feature/mixed-two mixed-two.txt 'mixed-branch-two'
git -C "$selector_mix_repo" remote add origin https://github.com/acme/fixture.git
mix_main_oid=$(git -C "$selector_mix_repo" rev-parse refs/heads/main)
mix_one_oid=$(git -C "$selector_mix_repo" rev-parse refs/heads/feature/mixed-one)
mix_two_oid=$(git -C "$selector_mix_repo" rev-parse refs/heads/feature/mixed-two)
mkdir -p "$TAILROCKS_GH_FIXTURE_DIR/selector-mix"
jq -n --arg one "$mix_one_oid" --arg two "$mix_two_oid" \
  --arg main "$mix_main_oid" \
  '[{name:"main",protected:true,commit:{sha:$main}},{name:"feature/mixed-one",commit:{sha:$one}}]' >"$TAILROCKS_GH_FIXTURE_DIR/selector-mix/branches-page1.json"
jq -n --arg two "$mix_two_oid" \
  '[{name:"feature/mixed-two",commit:{sha:$two}}]' >"$TAILROCKS_GH_FIXTURE_DIR/selector-mix/branches-page2.json"
jq -n --arg head "$mix_one_oid" --arg base "$mix_main_oid" \
  '{number:43,state:"open",draft:false,head:{ref:"feature/mixed-one",sha:$head,repo:{full_name:"acme/fixture"}},base:{ref:"main",sha:$base,repo:{full_name:"acme/fixture"}}}' \
  >"$TAILROCKS_GH_FIXTURE_DIR/selector-mix/pr43.json"
jq -n --arg head "$mix_two_oid" --arg base "$mix_main_oid" \
  '{number:44,state:"open",draft:false,head:{ref:"feature/mixed-two",sha:$head,repo:{full_name:"acme/fixture"}},base:{ref:"main",sha:$base,repo:{full_name:"acme/fixture"}}}' \
  >"$TAILROCKS_GH_FIXTURE_DIR/selector-mix/pr44.json"
jq -n --arg head "$mix_two_oid" --arg base "$mix_main_oid" \
  '{number:45,state:"open",draft:false,head:{ref:"feature/mixed-two",sha:$head,repo:{full_name:"acme/fixture"}},base:{ref:"main",sha:$base,repo:{full_name:"acme/fixture"}}}' \
  >"$TAILROCKS_GH_FIXTURE_DIR/selector-mix/pr45.json"
selector_mix_before="$work/mixed-selector-refs.before"
snapshot_refs "$selector_mix_repo" "$selector_mix_before"
GH_FIXTURE_KIND=selector-mix
export GH_FIXTURE_KIND
: >"$TAILROCKS_GH_FIXTURE_LOG"
run_agent selector-mixed-branches-prs "$selector_mix_repo" :workspace \
  'Use $tailrocks-repository-skills:repo-merge --audit-only --target-branch=main feature/mixed-one 44 #45 https://github.com/acme/fixture/pull/43 https://github.com/acme/fixture/branches/all?page=2. This is one mixed selector set: branch name, bare positive PR number, #N PR, PR URL, and paginated branch listing. Resolve exact head/base refs and OIDs, ignore page=2 as presentation only, fetch both /branches/all pages, exclude main as the selected target, and freeze membership. Deduplicate canonical source membership by head repository, ref, and OID; retain every originating selector in canonical_sources.selector_origins and keep one selected_prs record per PR with its full head/base provenance. This fixture uses synthetic local API data only. Return JSON with outcome audit-only, target:{ref,oid}, canonical_sources:[{head_repository,head_ref,head_oid,selector_origins}], selected_branches:[{ref,oid}], selected_prs:[{number,head_ref,head_oid,base_ref,base_oid}], pagination_complete:true. Make no writes.'
assert_same_refs "$selector_mix_repo" "$selector_mix_before"
grep -F -q '/branches/all' "$TAILROCKS_GH_FIXTURE_LOG"
grep -E -q 'pulls/43|pr view 43' "$TAILROCKS_GH_FIXTURE_LOG"
grep -E -q 'pulls/44|pr view 44' "$TAILROCKS_GH_FIXTURE_LOG"
grep -E -q 'pulls/45|pr view 45' "$TAILROCKS_GH_FIXTURE_LOG"
grep -F -q -- '--paginate' "$TAILROCKS_GH_FIXTURE_LOG" || grep -F -q -- '--limit' "$TAILROCKS_GH_FIXTURE_LOG"
assert_json_final "$work/selector-mixed-branches-prs.final.txt" \
  '.outcome == "audit-only" and .target == {ref:"main",oid:"'"$mix_main_oid"'"} and
   .selected_branches == [{ref:"feature/mixed-one",oid:"'"$mix_one_oid"'"},{ref:"feature/mixed-two",oid:"'"$mix_two_oid"'"}] and
   (.canonical_sources | length == 2) and
   ([.canonical_sources[] | select(.head_repository == "acme/fixture" and .head_ref == "feature/mixed-one" and .head_oid == "'"$mix_one_oid"'")] | length == 1) and
   ([.canonical_sources[] | select(.head_repository == "acme/fixture" and .head_ref == "feature/mixed-one") | .selector_origins | sort] | .[0] == ["feature/mixed-one","https://github.com/acme/fixture/branches/all?page=2","https://github.com/acme/fixture/pull/43"]) and
   ([.canonical_sources[] | select(.head_repository == "acme/fixture" and .head_ref == "feature/mixed-two" and .head_oid == "'"$mix_two_oid"'")] | length == 1) and
   ([.canonical_sources[] | select(.head_repository == "acme/fixture" and .head_ref == "feature/mixed-two") | .selector_origins | sort] | .[0] == ["#45","44","https://github.com/acme/fixture/branches/all?page=2"]) and
   (.selected_prs | length == 3) and
   ([.selected_prs[] | select(.number == 43 and .head_ref == "feature/mixed-one" and .head_oid == "'"$mix_one_oid"'" and .base_ref == "main" and .base_oid == "'"$mix_main_oid"'")] | length == 1) and
   ([.selected_prs[] | select(.number == 44 and .head_ref == "feature/mixed-two" and .head_oid == "'"$mix_two_oid"'" and .base_ref == "main" and .base_oid == "'"$mix_main_oid"'")] | length == 1) and
   ([.selected_prs[] | select(.number == 45 and .head_ref == "feature/mixed-two" and .head_oid == "'"$mix_two_oid"'" and .base_ref == "main" and .base_oid == "'"$mix_main_oid"'")] | length == 1) and .pagination_complete == true'
record 'verified=mixed branch, bare PR, #N PR, PR URL, and paginated /branches/all resolved through synthetic fixture API; no refs changed or live hosted evidence claimed'

# Synthetic selector credentials/query/fragment must not enter the result or
# the only handoff created by this isolated, read-only case.
redaction_state="$work/redaction-state"
mkdir -p "$redaction_state"
XDG_STATE_HOME=$redaction_state
export XDG_STATE_HOME
redaction_refs_before="$work/redaction-refs.before"
snapshot_refs "$selector_mix_repo" "$redaction_refs_before"
redaction_user='fixture-user-marker-7H2K'
redaction_password='fixture-password-marker-3J9M'
redaction_query='fixture-query-marker-5V2Q'
redaction_fragment='fixture-fragment-marker-8N6C'
redaction_selector="https://${redaction_user}:${redaction_password}@github.com/acme/fixture/pull/43?access_token=${redaction_query}#${redaction_fragment}"
: >"$TAILROCKS_GH_FIXTURE_LOG"
run_agent redaction-probe "$selector_mix_repo" :workspace \
  "Use \$tailrocks-repository-skills:repo-merge --audit-only --target-branch=main $redaction_selector. Treat userinfo, query, and fragment as sensitive synthetic canaries, not credentials. Resolve this selector through the local fixture only. Record only the canonical repository and PR identity in the isolated handoff; do not echo raw selector components or canary values. Return JSON with outcome audit-only and exactly selected PR #43 with its head/base refs and OIDs. Make no writes." \
  "$selector_mix_repo"
assert_same_refs "$selector_mix_repo" "$redaction_refs_before"
redaction_handoff_dir="$XDG_STATE_HOME/tailrocks/repo-merge/runs"
redaction_handoff_count=$(find "$redaction_handoff_dir" -type f -name '*.md' -print | wc -l | tr -d ' ')
test "$redaction_handoff_count" = 1
redaction_handoff=$(find "$redaction_handoff_dir" -type f -name '*.md' -print | sed -n '1p')
test -s "$redaction_handoff"
grep -F -q 'acme/fixture' "$redaction_handoff"
grep -F -q '43' "$redaction_handoff"
assert_json_final "$work/redaction-probe.final.txt" \
  '.outcome == "audit-only" and ([.selected_prs[] | select(.number == 43 and .head_ref == "feature/mixed-one" and .head_oid == "'"$mix_one_oid"'" and .base_ref == "main" and .base_oid == "'"$mix_main_oid"'")] | length == 1) and (.selected_prs | length == 1)'
for redaction_artifact in "$work/redaction-probe.final.txt" "$redaction_handoff"; do
  for redaction_marker in "$redaction_user" "$redaction_password" "$redaction_query" "$redaction_fragment"; do
    if grep -F -q -- "$redaction_marker" "$redaction_artifact"; then
      echo "synthetic selector secret leaked into $redaction_artifact" >&2
      exit 1
    fi
  done
done
if grep -E -q 'fixture-(user|password|query|fragment)-marker|access_token=|@github\.com|#fixture-fragment' "$redaction_handoff"; then
  echo "raw selector userinfo/query/fragment leaked into isolated handoff: $redaction_handoff" >&2
  exit 1
fi
record 'verified=synthetic selector userinfo/query/fragment canaries absent from local result and isolated handoff; fixture-only, no refs changed'
fi
XDG_STATE_HOME="$work/xdg-state"
export XDG_STATE_HOME

# Pending CI and a blocking review must prevent any local landing. All GitHub
# reads use the disposable shim; every Git push is refused by its shim.
blocked_repo="$work/blocked-review-ci-fixture"
make_repo "$blocked_repo"
printf 'base\n' >"$blocked_repo/README.md"
commit_all "$blocked_repo" 'fixture base'
mkdir -p "$blocked_repo/tests"
branch_file "$blocked_repo" feature/blocked tests/blocked.txt 'candidate-with-pending-gates'
git -C "$blocked_repo" remote add origin https://github.com/acme/blocked-fixture.git
git -C "$blocked_repo" checkout -q feature/blocked
blocked_main_before=$(git -C "$blocked_repo" rev-parse refs/heads/main)
blocked_source_before=$(git -C "$blocked_repo" rev-parse refs/heads/feature/blocked)
blocked_merge_base=$(git -C "$blocked_repo" merge-base refs/heads/main refs/heads/feature/blocked)
test "$(git -C "$blocked_repo" rev-parse HEAD)" = "$blocked_source_before"
mkdir -p "$TAILROCKS_GH_FIXTURE_DIR/blocked"
jq -n --arg head "$blocked_source_before" --arg base "$blocked_main_before" \
  '{number:77,state:"open",draft:false,reviewDecision:"CHANGES_REQUESTED",head:{ref:"feature/blocked",sha:$head,repo:{full_name:"acme/blocked-fixture"}},base:{ref:"main",sha:$base,repo:{full_name:"acme/blocked-fixture"}}}' \
  >"$TAILROCKS_GH_FIXTURE_DIR/blocked/pr.json"
jq -n --arg sha "$blocked_source_before" \
  '[{id:101,user:{login:"fixture-reviewer"},state:"CHANGES_REQUESTED",commit_id:$sha,body:"Blocking fixture review"}]' \
  >"$TAILROCKS_GH_FIXTURE_DIR/blocked/reviews.json"
jq -n --arg sha "$blocked_source_before" \
  '{check_runs:[{name:"required-ci",head_sha:$sha,status:"in_progress",conclusion:null}]}' \
  >"$TAILROCKS_GH_FIXTURE_DIR/blocked/checks.json"
rm -f "$TAILROCKS_GH_FIXTURE_LOG"
GH_FIXTURE_KIND=blocked
export GH_FIXTURE_KIND
TAILROCKS_GH_FIXTURE_REPO="$blocked_repo"
export TAILROCKS_GH_FIXTURE_REPO
blocked_refs_before="$work/blocked-refs.before"
snapshot_refs "$blocked_repo" "$blocked_refs_before"
blocked_status_before=$(git -C "$blocked_repo" status --porcelain=v2 --branch --untracked-files=all)
single_pr_find_log="$XDG_STATE_HOME/single-pr-find.log"
: >"$single_pr_find_log"
TAILROCKS_BLOCK_FIND=1
TAILROCKS_FIND_SHIM_LOG="$single_pr_find_log"
export TAILROCKS_BLOCK_FIND TAILROCKS_FIND_SHIM_LOG
: >"$TAILROCKS_GH_FIXTURE_LOG"
if [ "$selected_case" = "all" ]; then
  run_agent single-pr-audit-no-path-discovery-command "$blocked_repo" :workspace \
    'Use $tailrocks-repository-skills:repo-merge --repo=acme/blocked-fixture --audit-only --target-branch=main #77. The contract says a targeted PR must not trigger host discovery. This is scoped contract evidence only: PATH calls to find, rg, fd, fdfind, locate, and mdfind are blocked and logged; this does not prove absence of ls, du, shell globbing, Git enumeration, absolute scanner paths, or recursive grep. Read only this PR and its required review/check evidence through the synthetic local gh fixture; this is not live hosted evidence. Return JSON with outcome audit-only, pr 77, source_ref, head_oid, base_ref, base_oid, target_oid, review_decision CHANGES_REQUESTED, and required_ci pending. Do not mutate anything.'
  assert_same_refs "$blocked_repo" "$blocked_refs_before"
  test "$(git -C "$blocked_repo" status --porcelain=v2 --branch --untracked-files=all)" = "$blocked_status_before"
  test ! -s "$single_pr_find_log"
  grep -E -q 'pulls/77|pr view 77' "$TAILROCKS_GH_FIXTURE_LOG"
  assert_json_final "$work/single-pr-audit-no-path-discovery-command.final.txt" \
    '.outcome == "audit-only" and .pr == 77 and .source_ref == "refs/heads/feature/blocked" and .head_oid == "'"$blocked_source_before"'" and .base_ref == "refs/heads/main" and .base_oid == "'"$blocked_main_before"'" and .target_oid == "'"$blocked_main_before"'" and .review_decision == "CHANGES_REQUESTED" and .required_ci == "pending"'
  record 'scoped_contract_evidence=single targeted PR made zero PATH calls to find, rg, fd, fdfind, locate, or mdfind; not proof against ls, du, shell globbing, Git enumeration, absolute scanner paths, or recursive grep'
else
  record 'case=single-pr-audit-no-path-discovery-command; prompt skipped by explicit blocked-owner-preflight selector'
fi
unset TAILROCKS_BLOCK_FIND TAILROCKS_FIND_SHIM_LOG

: >"$TAILROCKS_GH_FIXTURE_LOG"
if [ -n "$owner_plugin_id" ]; then
  owner_preflight_root="$work/owner-preflight-artifacts"
  mkdir -p "$owner_preflight_root/captures"
  TAILROCKS_OWNER_PLUGIN_ROOT="$blocked_repo/plugins/$owner_plugin_name"
  TAILROCKS_OWNER_EXPECTED_SHA="$owner_plugin_sha"
  TAILROCKS_OWNER_EXPECTED_CWD="$blocked_repo"
  TAILROCKS_OWNER_RECEIPTS_LOG="$owner_preflight_root/receipts.jsonl"
  TAILROCKS_OWNER_CAPTURE_ROOT="$owner_preflight_root/captures"
  TAILROCKS_OWNER_WORK_ROOT="$work"
  TAILROCKS_OWNER_GH_SHIM="$shim_dir/gh"
  TAILROCKS_OWNER_GH_SHIM_SOURCE="$repo_root/tests/fixtures/gh-stub.sh"
  TAILROCKS_OWNER_GIT_SHIM="$shim_dir/git"
  TAILROCKS_OWNER_GIT_SHIM_SOURCE="$repo_root/tests/fixtures/git-no-push.sh"
  TAILROCKS_OWNER_EXPECTED_REPOSITORY=acme/blocked-fixture
  TAILROCKS_OWNER_EXPECTED_PR=77
  TAILROCKS_OWNER_EXPECTED_HEAD="$blocked_source_before"
  TAILROCKS_OWNER_EXPECTED_BASE="$blocked_main_before"
  TAILROCKS_OWNER_EXPECTED_MERGE_BASE="$blocked_merge_base"
  run_agent blocked-review-ci-with-real-owners "$blocked_repo" :workspace \
    "Use \$tailrocks-review-pr 77 first for the read-only review, then \$tailrocks-merge-pr 77 --no-poll so the pinned merge owner runs its actual guarded preflight. The project-local installation includes both skills and pinned plugin $owner_plugin_id from $pr_skills_root at $owner_plugin_sha. Bind the exact local fixture PR 77: repository acme/blocked-fixture, source refs/heads/feature/blocked at $blocked_source_before, base refs/heads/main at $blocked_main_before, merge base $blocked_merge_base, target main. The synthetic GH fixture returns CHANGES_REQUESTED review and required-ci pending; collect those actual owner inputs. The changed path tests/blocked.txt is a normal-risk test file. No high-risk confirmation is authorized or needed. The merge skill must use --no-poll, stop at the pending required check, and must not invoke merge-pr.ts or mutate, approve, push, close, or merge. Return strict JSON with outcome blocked, evidence_class local-fixture-with-actual-pinned-owner-preflight-receipt, exact PR/head/base/target, review decision, required check, worklist status, high-risk status, and blockers." \
    "$blocked_repo" "$owner_preflight_root"
  assert_json_final "$work/blocked-review-ci-with-real-owners.final.txt" \
    '.outcome == "blocked" and .evidence_class == "local-fixture-with-actual-pinned-owner-preflight-receipt" and .pr == 77 and .source_ref == "refs/heads/feature/blocked" and .expected_head == "'"$blocked_source_before"'" and .base_ref == "refs/heads/main" and .expected_base == "'"$blocked_main_before"'" and .requested_target == "main" and .review_decision == "CHANGES_REQUESTED" and .required_checks[0].name == "required-ci" and .required_checks[0].bucket == "pending" and .worklist_status == "none-configured" and .high_risk_confirmation == "not-required" and ([.blocked_gates[] | ascii_downcase] | any(test("review|ci|check")))'
  grep -F -q 'required-ci' "$TAILROCKS_GH_FIXTURE_LOG"
  grep -F -q 'pr view 77' "$TAILROCKS_GH_FIXTURE_LOG"
  grep -F -q 'pr diff 77' "$TAILROCKS_GH_FIXTURE_LOG"
  grep -F -q '/pulls/77/reviews' "$TAILROCKS_GH_FIXTURE_LOG"
  grep -F -q '/pulls/77/comments' "$TAILROCKS_GH_FIXTURE_LOG"
  grep -F -q '/issues/77/comments' "$TAILROCKS_GH_FIXTURE_LOG"
  owner_bun_argv_log="$XDG_STATE_HOME/blocked-review-ci-with-real-owners.bun-argv.jsonl"
  test -s "$owner_bun_argv_log"
  jq -e -s --arg root "$blocked_repo" --arg bun "$real_bun_bin" '
    def script_argv($script): any(.argv[]; . == ("scripts/" + $script) or endswith("/scripts/" + $script));
    def option_value($argv; $option):
      ($argv | index($option)) as $index
      | if $index == null then null else $argv[$index + 1] end;
    [ .[] | select(script_argv("merge-preflight.ts")) ] as $preflight |
    [ .[] | select(script_argv("merge-pr.ts")) ] as $merge |
    ($preflight | length) == 1 and
    ($merge | length) == 0 and
    $preflight[0].executable == $bun and
    ($preflight[0].argv | index("--no-poll")) != null and
    option_value($preflight[0].argv; "--root") == $root and
    option_value($preflight[0].argv; "--pr") == "77"
  ' "$owner_bun_argv_log" >/dev/null
  sh "$repo_root/tests/fixtures/assert-owner-preflight.sh" \
    "$owner_bun_argv_log" \
    "$TAILROCKS_OWNER_RECEIPTS_LOG" \
    "$pr_skills_root" \
    "$TAILROCKS_OWNER_PLUGIN_ROOT" \
    "$owner_plugin_sha" \
    "$real_bun_bin" \
    "$blocked_repo" \
    acme/blocked-fixture \
    77 \
    feature/blocked \
    "$blocked_source_before" \
    main \
    "$blocked_main_before" \
    "$blocked_merge_base" \
    "$TAILROCKS_OWNER_CAPTURE_ROOT"
  record "owner_bun_argv_trace=$owner_bun_argv_log"
  record "owner_preflight_capture_root=$TAILROCKS_OWNER_CAPTURE_ROOT"
  record 'review_skill_request=tailrocks-review-pr 77; synthetic PR view/diff/review/comment endpoint traffic observed; native review-skill invocation not independently evidenced'
  record 'owner_bun_preflight_argv_invocations=1; owner_bun_merge_pr_argv_invocations=0; actual pinned-owner stdout/stderr/exit-status schema receipt verified as pending required-ci; GH review/CI inputs are synthetic local fixtures'
  case_name=blocked-review-ci-with-real-owners
else
  record 'blocked_owner_e2e=NOT RUN; TAILROCKS_PR_SKILLS_ROOT and TAILROCKS_PR_SKILLS_SHA absent; actual lifecycle owner path remains pending; synthetic GitHub fixture is not live CI/review evidence'
  run_agent blocked-review-ci-missing-owners "$blocked_repo" :workspace \
    'Use $tailrocks-repository-skills:repo-merge --repo=acme/blocked-fixture --target-branch=main --cleanup=none #77. The required tailrocks-pull-request-skills plugin with tailrocks-review-pr and tailrocks-merge-pr is intentionally unavailable in this isolated install. Fail closed before any landing with an explicit missing-owner blocker. Do not substitute gh, edit refs, create commits, push, approve, close, or merge. Return JSON with outcome blocked, blocked_gates containing lifecycle-owner-unavailable, and target_oid equal to the fixture main OID.'
  assert_json_final "$work/blocked-review-ci-missing-owners.final.txt" \
    '.outcome == "blocked" and .target_oid == "'"$blocked_main_before"'" and ([.blocked_gates[] | ascii_downcase] | any(test("lifecycle-owner-unavailable|owner unavailable|owner missing")))'
  case_name=blocked-review-ci-missing-owners
fi
assert_same_refs "$blocked_repo" "$blocked_refs_before"
test "$(git -C "$blocked_repo" status --porcelain=v2 --branch --untracked-files=all)" = "$blocked_status_before"
if grep -E -q '(^|[[:space:]])push([[:space:]]|$)' "$TAILROCKS_GIT_SHIM_LOG"; then
  echo "agent attempted a Git push; the fixture shim blocked it" >&2
  exit 1
fi
if grep -E -i -q '(^|[[:space:]])(merge|review|close|edit)([[:space:]]|$)|(^|[[:space:]])--method=(POST|PUT|PATCH|DELETE)([[:space:]]|$)|(^|[[:space:]])(--method|-X)[[:space:]]+(POST|PUT|PATCH|DELETE)([[:space:]]|$)|(^|[[:space:]])(POST|PUT|PATCH|DELETE)([[:space:]]|$)' "$TAILROCKS_GH_FIXTURE_LOG"; then
  echo "agent attempted a GitHub mutation; the fixture shim blocked it" >&2
  exit 1
fi
record "verified=$case_name; target/source refs and tree unchanged; GitHub and Git outward writes unavailable"

if [ -z "$owner_plugin_id" ]; then
  record 'result=blocked-local-fixture-acceptance; real PR-owner path not run; synthetic GitHub fixture is not live hosted evidence'
else
  record 'result=verified-local-installed-skill-acceptance-with-pinned-pr-owners; GitHub inputs are synthetic fixture data only and no live hosted evidence is claimed'
fi
if [ "$selected_case" = "all" ]; then
  completed_cases="main-default-landing,non-main-multi-source,partial,already-landed,reverted,no-op-rerun,audit-only,empty-selectors,no-source-sentinel,resume,dirty-and-ignored-retention,active-writer,all-work-scoped-coverage,all-work-normal-cleanup-retention,unfinished-goal-recovery-with-restore-test,cleanup-resolved-with-restore-test,pulls-pagination,mixed-branch-pr-branches-all,single-pr-no-path-discovery-command,$case_name"
else
  completed_cases=blocked-owner-preflight
fi
record "completed_cases=$completed_cases"
cat "$evidence"
if [ -z "$owner_plugin_id" ]; then
  echo "BLOCKED: disposable local fixture cases ran, but the actual pinned PR lifecycle-owner path was not configured; synthetic GitHub data is not live review/CI evidence" >&2
  exit 2
fi
echo "Installed Codex repo-merge acceptance: VERIFIED on disposable fixtures with pinned PR owners (case=$selected_case); GitHub reads were synthetic fixture data, not live hosted evidence."
