#!/bin/sh

# Normal-mode all-work retention case. Source this after agent-acceptance.sh's
# helper functions; call run_all_work_resolved_retention_case once.
all_work_resolved_probe_permissions() {
  all_work_resolved_probe_root="$work/all-work-resolved-permission-probe"
  all_work_resolved_probe_home="$all_work_resolved_probe_root/codex-home"
  all_work_resolved_probe_out="$all_work_resolved_probe_root/probe.out"
  mkdir -p "$all_work_resolved_probe_home" "$all_work_resolved_probe_root/cwd"

  all_work_resolved_probe_filesystem=$codex_filesystem_entries
  all_work_resolved_scan_key=$(toml_quote_path "$all_work_resolved_root")
  all_work_resolved_probe_filesystem="$all_work_resolved_probe_filesystem,$all_work_resolved_scan_key=\"read\""
  all_work_resolved_clean_key=$(toml_quote_path "$all_work_resolved_clean_copy")
  all_work_resolved_probe_filesystem="$all_work_resolved_probe_filesystem,$all_work_resolved_clean_key=\"write\""
  all_work_resolved_target_key=$(toml_quote_path "$all_work_resolved_target")
  all_work_resolved_state_key=$(toml_quote_path "$XDG_STATE_HOME")
  all_work_resolved_artifact_key=$(toml_quote_path "$all_work_resolved_cleanup_proof")
  all_work_resolved_probe_filesystem="$all_work_resolved_probe_filesystem,$all_work_resolved_target_key=\"write\",$all_work_resolved_state_key=\"write\",$all_work_resolved_artifact_key=\"write\"}"

  all_work_resolved_clean_probe_file="$all_work_resolved_clean_copy/.tailrocks-descendant-write-probe"
  if [ -e "$all_work_resolved_clean_probe_file" ]; then
    echo "BLOCKED: synthetic clean-clone permission probe already exists: $all_work_resolved_clean_probe_file" >&2
    return 2
  fi
  if ! run_codex_cli "$all_work_resolved_probe_home" "$all_work_resolved_probe_home" \
    "$codex_task_tmpdir" "$all_work_resolved_clean_probe_file" probe sandbox \
    --permission-profile "$codex_permission_profile" \
    --cd "$all_work_resolved_target" \
    --log-denials \
    -c "permissions.$codex_permission_profile.extends=\":workspace\"" \
    -c "permissions.$codex_permission_profile.filesystem=$all_work_resolved_probe_filesystem" \
    -c "permissions.$codex_permission_profile.network.enabled=false" \
    -- /bin/sh -c 'set -eu; printf "%s\\n" allowed >"$PROBE_PATH"' \
    >"$all_work_resolved_probe_out" 2>&1; then
    echo "BLOCKED: isolated Codex sandbox denied a write to the exact clean eligible clone: $all_work_resolved_clean_copy" >&2
    cat "$all_work_resolved_probe_out" >&2
    return 2
  fi
  test "$(cat "$all_work_resolved_clean_probe_file")" = allowed
  rm -f -- "$all_work_resolved_clean_probe_file"

  for all_work_resolved_probe_clone in \
    "$all_work_resolved_dirty_copy" \
    "$all_work_resolved_active_copy"; do
    all_work_resolved_probe_file="$all_work_resolved_probe_clone/.tailrocks-descendant-write-probe"
    if [ -e "$all_work_resolved_probe_file" ]; then
      echo "BLOCKED: synthetic read-only clone probe already exists: $all_work_resolved_probe_file" >&2
      return 2
    fi
    if run_codex_cli "$all_work_resolved_probe_home" "$all_work_resolved_probe_home" \
      "$codex_task_tmpdir" "$all_work_resolved_probe_file" probe sandbox \
      --permission-profile "$codex_permission_profile" \
      --cd "$all_work_resolved_target" \
      --log-denials \
      -c "permissions.$codex_permission_profile.extends=\":workspace\"" \
      -c "permissions.$codex_permission_profile.filesystem=$all_work_resolved_probe_filesystem" \
      -c "permissions.$codex_permission_profile.network.enabled=false" \
      -- /bin/sh -c 'set -eu; printf "%s\\n" forbidden >"$PROBE_PATH"' \
      >"$all_work_resolved_probe_out" 2>&1; then
      echo "BLOCKED: isolated Codex sandbox unexpectedly allowed a write to a retained clone: $all_work_resolved_probe_clone" >&2
      cat "$all_work_resolved_probe_out" >&2
      return 2
    fi
    if [ -e "$all_work_resolved_probe_file" ] ||
      ! grep -F -q "file-write-create $all_work_resolved_probe_file" "$all_work_resolved_probe_out"; then
      echo "BLOCKED: read-only clone write denial was not proved for $all_work_resolved_probe_clone" >&2
      cat "$all_work_resolved_probe_out" >&2
      return 2
    fi
  done

  all_work_resolved_denied_file="$all_work_resolved_root/.tailrocks-parent-write-probe"
  if [ -e "$all_work_resolved_denied_file" ]; then
    echo "BLOCKED: scan-root denial probe already exists: $all_work_resolved_denied_file" >&2
    return 2
  fi
  if run_codex_cli "$all_work_resolved_probe_home" "$all_work_resolved_probe_home" \
    "$codex_task_tmpdir" "$all_work_resolved_denied_file" probe sandbox \
    --permission-profile "$codex_permission_profile" \
    --cd "$all_work_resolved_target" \
    --log-denials \
    -c "permissions.$codex_permission_profile.extends=\":workspace\"" \
    -c "permissions.$codex_permission_profile.filesystem=$all_work_resolved_probe_filesystem" \
    -c "permissions.$codex_permission_profile.network.enabled=false" \
    -- /bin/sh -c 'set -eu; printf "%s\\n" denied >"$PROBE_PATH"' \
    >"$all_work_resolved_probe_out" 2>&1; then
    all_work_resolved_denial_status=0
  else
    all_work_resolved_denial_status=$?
  fi
  if [ "$all_work_resolved_denial_status" -eq 0 ] || [ -e "$all_work_resolved_denied_file" ] ||
    ! grep -F -q "file-write-create $all_work_resolved_denied_file" "$all_work_resolved_probe_out"; then
    echo "BLOCKED: exact scan-root write denial was not proved for $all_work_resolved_denied_file" >&2
    cat "$all_work_resolved_probe_out" >&2
    return 2
  fi
  record 'verified=isolated Codex sandbox without model invocation allowed writes only to the exact clean eligible clone; dirty and active-writer clone writes plus scan-parent writes were denied'
}

all_work_resolved_scan_membership() {
  all_work_resolved_scan_root=$1
  all_work_resolved_scan_output=$2
  all_work_resolved_scan_meta="$all_work_resolved_scan_output.git-metadata"
  all_work_resolved_scan_entry="$all_work_resolved_scan_output.entry"
  all_work_resolved_scan_refs="$all_work_resolved_scan_output.refs"
  all_work_resolved_scan_jsonl="$all_work_resolved_scan_output.jsonl"
  find "$all_work_resolved_scan_root" -name .git -prune -print | LC_ALL=C sort >"$all_work_resolved_scan_meta"
  : >"$all_work_resolved_scan_jsonl"
  while IFS= read -r all_work_resolved_git_marker; do
    case "$all_work_resolved_git_marker" in
      */.git) all_work_resolved_repo=${all_work_resolved_git_marker%/.git} ;;
      *) echo "membership rescan found an unrecognized Git metadata path: $all_work_resolved_git_marker" >&2; return 1 ;;
    esac
    all_work_resolved_repo_root=$("$TAILROCKS_REAL_GIT" -C "$all_work_resolved_repo" rev-parse --show-toplevel) || {
      echo "membership rescan found invalid repository metadata: $all_work_resolved_repo" >&2
      return 1
    }
    if [ "$all_work_resolved_repo_root" != "$all_work_resolved_repo" ]; then
      echo "membership rescan found a repository root mismatch: $all_work_resolved_repo" >&2
      return 1
    fi
    all_work_resolved_ref_json=$("$TAILROCKS_REAL_GIT" -C "$all_work_resolved_repo" \
      for-each-ref --format='{"ref":"%(refname)","oid":"%(objectname)"}' refs) || {
      echo "membership rescan cannot enumerate refs: $all_work_resolved_repo" >&2
      return 1
    }
    printf '%s\n' "$all_work_resolved_ref_json" | jq -s -c 'sort_by(.ref)' >"$all_work_resolved_scan_refs"
    jq -cn \
      --arg path "$all_work_resolved_repo" \
      --slurpfile refs "$all_work_resolved_scan_refs" \
      '{path:$path,refs:$refs[0]}' >>"$all_work_resolved_scan_jsonl"
  done <"$all_work_resolved_scan_meta"
  jq -s -c '.' "$all_work_resolved_scan_jsonl" >"$all_work_resolved_scan_entry"
  mv "$all_work_resolved_scan_entry" "$all_work_resolved_scan_output"
}

all_work_resolved_install_delete_guard() {
  all_work_resolved_guard_config="$XDG_STATE_HOME/all-work-resolved-delete-guard.json"
  all_work_resolved_git_shim_backup="$work/all-work-resolved-git-shim.before"
  jq -n \
    --arg repo "$all_work_resolved_clean_copy" \
    --arg source_ref refs/heads/feature/resolved \
    --arg source_oid "$all_work_resolved_source_oid" \
    --arg target_repo "$all_work_resolved_target" \
    --arg target_ref refs/heads/release/next \
    --arg target_base_oid "$all_work_resolved_target_before" \
    --arg source_origin "$all_work_resolved_remote" \
    --arg source_refs_before "$all_work_resolved_clean_refs_before" \
    --arg expected_readme 'base' \
    --arg expected_worker_ini "$(printf 'mode=release\ntarget=release-next')" \
    --arg expected_queue_ini 'durability=durable' \
    --arg expected_requirements 'release/next requires mode=release and target=release-next' \
    --arg expected_release_policy "$(printf 'cluster=west\nregion=production')" \
    --arg bundle "$all_work_resolved_bundle" \
    --arg restore "$all_work_resolved_restore" \
    '{repo:$repo,source_ref:$source_ref,source_oid:$source_oid,bundle:$bundle,restore:$restore,
      target_repo:$target_repo,target_ref:$target_ref,target_base_oid:$target_base_oid,target_expected_oid:null,
      source_origin:$source_origin,source_refs_before:$source_refs_before,expected_readme:$expected_readme,
      expected_worker_ini:$expected_worker_ini,expected_queue_ini:$expected_queue_ini,
      expected_requirements:$expected_requirements,expected_release_policy:$expected_release_policy}' \
    >"$all_work_resolved_guard_config"
  cp "$shim_dir/git" "$all_work_resolved_git_shim_backup"
  cat >"$shim_dir/git" <<'EOF'
#!/bin/sh
set -eu

all_work_resolved_guard_config="$XDG_STATE_HOME/all-work-resolved-delete-guard.json"
all_work_resolved_argv_json=$(printf '%s\n' "$@" | jq -R . | jq -s -c .)
printf '%s\n' "$all_work_resolved_argv_json" >>"$TAILROCKS_GIT_SHIM_LOG"

for all_work_resolved_arg do
  if [ "$all_work_resolved_arg" = push ]; then
    echo 'fixture git shim blocks every push' >&2
    exit 69
  fi
done

  all_work_resolved_operation=
  all_work_resolved_delete=0
  all_work_resolved_expect_ref=0
  all_work_resolved_delete_ref=
  all_work_resolved_delete_ref_count=0
  all_work_resolved_extra_delete_arg=
  all_work_resolved_ref_separator=0
  all_work_resolved_update_stdin=0
  all_work_resolved_previous=
  all_work_resolved_git_cwd=
  all_work_resolved_git_dir_override=0
for all_work_resolved_arg do
  if [ "$all_work_resolved_expect_ref" = 1 ]; then
    if [ "$all_work_resolved_arg" = -- ]; then
      all_work_resolved_ref_separator=1
      continue
    fi
    all_work_resolved_delete_ref_count=$((all_work_resolved_delete_ref_count + 1))
    if [ "$all_work_resolved_delete_ref_count" -eq 1 ]; then
      all_work_resolved_delete_ref=$all_work_resolved_arg
    elif [ "$all_work_resolved_operation" = update-ref ] && [ -z "$all_work_resolved_extra_delete_arg" ]; then
      all_work_resolved_extra_delete_arg=$all_work_resolved_arg
    fi
    continue
  fi
  if [ -n "$all_work_resolved_previous" ]; then
    case "$all_work_resolved_previous" in
      cwd) all_work_resolved_git_cwd=$all_work_resolved_arg ;;
    esac
    all_work_resolved_previous=
    continue
  fi
  case "$all_work_resolved_arg" in
    branch|update-ref) all_work_resolved_operation=$all_work_resolved_arg ;;
    -C) all_work_resolved_previous=cwd ;;
    --git-dir|--git-dir=*|--work-tree|--work-tree=*)
      all_work_resolved_git_dir_override=1
      ;;
    --stdin)
      if [ "$all_work_resolved_operation" = update-ref ]; then all_work_resolved_update_stdin=1; fi
      ;;
    --) all_work_resolved_ref_separator=1 ;;
    -d|-D|--delete)
      if [ "$all_work_resolved_operation" = branch ] || [ "$all_work_resolved_operation" = update-ref ]; then
        all_work_resolved_delete=1
        all_work_resolved_expect_ref=1
      fi
      ;;
    *) : ;;
  esac
done

if [ "$all_work_resolved_update_stdin" = 1 ]; then
  echo 'fixture guard blocks opaque update-ref --stdin mutations' >&2
  exit 70
fi

if [ "$all_work_resolved_delete" = 1 ]; then
  all_work_resolved_guard_repo=$(jq -er '.repo' "$all_work_resolved_guard_config")
  all_work_resolved_guard_ref=$(jq -er '.source_ref' "$all_work_resolved_guard_config")
  all_work_resolved_guard_oid=$(jq -er '.source_oid' "$all_work_resolved_guard_config")
  all_work_resolved_bundle=$(jq -er '.bundle' "$all_work_resolved_guard_config")
  all_work_resolved_restore=$(jq -er '.restore' "$all_work_resolved_guard_config")
  all_work_resolved_target_repo=$(jq -er '.target_repo' "$all_work_resolved_guard_config")
  all_work_resolved_target_ref=$(jq -er '.target_ref' "$all_work_resolved_guard_config")
  all_work_resolved_target_base_oid=$(jq -er '.target_base_oid' "$all_work_resolved_guard_config")
  all_work_resolved_target_expected_oid=$(jq -r '.target_expected_oid // empty' "$all_work_resolved_guard_config")
  all_work_resolved_expected_worker_ini=$(jq -er '.expected_worker_ini' "$all_work_resolved_guard_config")
  all_work_resolved_expected_queue_ini=$(jq -er '.expected_queue_ini' "$all_work_resolved_guard_config")
  all_work_resolved_expected_requirements=$(jq -er '.expected_requirements' "$all_work_resolved_guard_config")
  all_work_resolved_expected_release_policy=$(jq -er '.expected_release_policy' "$all_work_resolved_guard_config")
  all_work_resolved_guard_source_origin=$(jq -er '.source_origin' "$all_work_resolved_guard_config")
  all_work_resolved_guard_source_refs_before=$(jq -er '.source_refs_before' "$all_work_resolved_guard_config")
  all_work_resolved_expected_readme=$(jq -er '.expected_readme' "$all_work_resolved_guard_config")
  all_work_resolved_observed_target_file="$XDG_STATE_HOME/all-work-resolved-target-before-delete.json"
  if [ "$all_work_resolved_operation" != update-ref ] ||
    [ "$all_work_resolved_delete_ref" != "$all_work_resolved_guard_ref" ] ||
    [ "$all_work_resolved_delete_ref_count" -ne 2 ] ||
    [ "$all_work_resolved_extra_delete_arg" != "$all_work_resolved_guard_oid" ] ||
    [ "${all_work_resolved_git_dir_override:-0}" = 1 ]; then
    echo 'fixture guard requires update-ref deletion of the exact full ref with its expected OID' >&2
    exit 70
  fi
  all_work_resolved_git_cwd=${all_work_resolved_git_cwd:-$(pwd -P)}
  all_work_resolved_repo_root=$("$TAILROCKS_REAL_GIT" -C "$all_work_resolved_git_cwd" rev-parse --show-toplevel 2>/dev/null) || {
    echo 'fixture guard cannot resolve deletion repository identity' >&2
    exit 70
  }
  if [ "$all_work_resolved_repo_root" != "$all_work_resolved_guard_repo" ]; then
    echo "fixture guard blocks deletion outside exact eligible clone: $all_work_resolved_repo_root" >&2
    exit 70
  fi
  all_work_resolved_current_oid=$("$TAILROCKS_REAL_GIT" -C "$all_work_resolved_guard_repo" rev-parse --verify "$all_work_resolved_guard_ref") || {
    echo 'fixture guard requires selected source ref to exist immediately before deletion' >&2
    exit 70
  }
  if [ "$all_work_resolved_current_oid" != "$all_work_resolved_guard_oid" ]; then
    echo 'fixture guard blocks deletion because selected source OID changed' >&2
    exit 70
  fi
  if [ ! -s "$all_work_resolved_bundle" ] || [ ! -d "$all_work_resolved_restore" ]; then
    echo 'fixture guard requires a bundle snapshot and restore-test before deletion' >&2
    exit 70
  fi
  "$TAILROCKS_REAL_GIT" bundle verify "$all_work_resolved_bundle" >/dev/null 2>&1 || {
    echo 'fixture guard requires a verified Git bundle before deletion' >&2
    exit 70
  }
  "$TAILROCKS_REAL_GIT" bundle list-heads "$all_work_resolved_bundle" |
    awk -v oid="$all_work_resolved_guard_oid" -v ref="$all_work_resolved_guard_ref" '$1 == oid && $2 == ref { found = 1 } END { exit !found }' || {
      echo 'fixture guard requires the bundle to preserve the exact selected source ref/OID' >&2
      exit 70
    }
  all_work_resolved_restored_oid=$("$TAILROCKS_REAL_GIT" -C "$all_work_resolved_restore" rev-parse --verify "$all_work_resolved_guard_ref") || {
    echo 'fixture guard requires a restored exact selected source ref' >&2
    exit 70
  }
  if [ "$all_work_resolved_restored_oid" != "$all_work_resolved_guard_oid" ]; then
    echo 'fixture guard found a restore-test source OID mismatch' >&2
    exit 70
  fi
  "$TAILROCKS_REAL_GIT" -C "$all_work_resolved_restore" checkout -q --detach "$all_work_resolved_guard_oid" || {
    echo 'fixture guard cannot materialize the verified restore-test source commit' >&2
    exit 70
  }
  for all_work_resolved_file in WORK_ITEM.md worker.ini queue.ini; do
    "$TAILROCKS_REAL_GIT" -C "$all_work_resolved_restore" show "$all_work_resolved_guard_ref:$all_work_resolved_file" |
      cmp -s - "$all_work_resolved_restore/$all_work_resolved_file" || {
        echo "fixture guard found a restore-test byte mismatch: $all_work_resolved_file" >&2
        exit 70
      }
  done

  if [ -n "$all_work_resolved_target_expected_oid" ]; then
    echo 'fixture guard refuses a second source deletion after target OID was bound' >&2
    exit 70
  fi
  all_work_resolved_target_current_oid=$("$TAILROCKS_REAL_GIT" -C "$all_work_resolved_target_repo" rev-parse --verify "$all_work_resolved_target_ref") || {
    echo 'fixture guard requires the exact target ref to exist immediately before source deletion' >&2
    exit 70
  }
  if [ "$all_work_resolved_target_current_oid" = "$all_work_resolved_target_base_oid" ]; then
    echo 'fixture guard blocks source deletion because target-relative work is not landed' >&2
    exit 70
  fi
  if [ "$("$TAILROCKS_REAL_GIT" -C "$all_work_resolved_target_repo" show "$all_work_resolved_target_current_oid:worker.ini")" != "$all_work_resolved_expected_worker_ini" ] ||
    [ "$("$TAILROCKS_REAL_GIT" -C "$all_work_resolved_target_repo" show "$all_work_resolved_target_current_oid:queue.ini")" != "$all_work_resolved_expected_queue_ini" ] ||
    [ "$("$TAILROCKS_REAL_GIT" -C "$all_work_resolved_target_repo" show "$all_work_resolved_target_current_oid:REQUIREMENTS.txt")" != "$all_work_resolved_expected_requirements" ] ||
    [ "$("$TAILROCKS_REAL_GIT" -C "$all_work_resolved_target_repo" show "$all_work_resolved_target_current_oid:release-policy.ini")" != "$all_work_resolved_expected_release_policy" ] ||
    [ "$("$TAILROCKS_REAL_GIT" -C "$all_work_resolved_target_repo" show "$all_work_resolved_target_current_oid:README.md")" != "$all_work_resolved_expected_readme" ]; then
    echo 'fixture guard blocks source deletion because the exact target OID lacks required resolved content or preserved target behavior' >&2
    exit 70
  fi
  all_work_resolved_source_origin=$("$TAILROCKS_REAL_GIT" -C "$all_work_resolved_guard_repo" remote get-url origin) || {
    echo 'fixture guard requires the source clone origin URL to remain available' >&2
    exit 70
  }
  if [ "$all_work_resolved_source_origin" != "$all_work_resolved_guard_source_origin" ]; then
    echo 'fixture guard blocks deletion because source clone origin changed' >&2
    exit 70
  fi
  all_work_resolved_source_status=$(GIT_OPTIONAL_LOCKS=0 "$TAILROCKS_REAL_GIT" -C "$all_work_resolved_guard_repo" \
    status --porcelain=v2 --untracked-files=all --ignored=matching) || {
    echo 'fixture guard cannot verify selected source cleanliness' >&2
    exit 70
  }
  if [ -n "$all_work_resolved_source_status" ]; then
    echo 'fixture guard blocks deletion because selected source has tracked, untracked, or ignored changes' >&2
    exit 70
  fi
  all_work_resolved_worktrees=$("$TAILROCKS_REAL_GIT" -C "$all_work_resolved_guard_repo" worktree list --porcelain) || {
    echo 'fixture guard cannot inspect all worktrees for selected branch ownership' >&2
    exit 70
  }
  if printf '%s\n' "$all_work_resolved_worktrees" |
    awk -v ref="$all_work_resolved_guard_ref" '$1 == "branch" && $2 == ref { found = 1 } END { exit !found }'; then
    echo 'fixture guard blocks deletion because selected source branch remains checked out in a worktree' >&2
    exit 70
  fi
  all_work_resolved_current_refs_json=$("$TAILROCKS_REAL_GIT" -C "$all_work_resolved_guard_repo" \
    for-each-ref --format='%(refname) %(objectname)' refs) || {
    echo 'fixture guard cannot verify the complete selected source ref inventory' >&2
    exit 70
  }
  all_work_resolved_current_refs="$XDG_STATE_HOME/all-work-resolved-source-refs-before-delete.txt"
  printf '%s\n' "$all_work_resolved_current_refs_json" | LC_ALL=C sort >"$all_work_resolved_current_refs"
  if ! cmp -s "$all_work_resolved_guard_source_refs_before" "$all_work_resolved_current_refs"; then
    echo 'fixture guard blocks deletion because source refs changed or include extra/opaque refs' >&2
    exit 70
  fi
  all_work_resolved_source_oid_before_delete=$("$TAILROCKS_REAL_GIT" -C "$all_work_resolved_guard_repo" rev-parse --verify "$all_work_resolved_guard_ref") || {
    echo 'fixture guard requires the exact selected source ref to exist immediately before deletion' >&2
    exit 70
  }
  if [ "$all_work_resolved_source_oid_before_delete" != "$all_work_resolved_guard_oid" ]; then
    echo 'fixture guard blocks deletion because selected source OID changed during snapshot and target verification' >&2
    exit 70
  fi
  all_work_resolved_target_oid_before_delete=$("$TAILROCKS_REAL_GIT" -C "$all_work_resolved_target_repo" rev-parse --verify "$all_work_resolved_target_ref") || {
    echo 'fixture guard requires the exact target ref to remain present immediately before source deletion' >&2
    exit 70
  }
  if [ "$all_work_resolved_target_oid_before_delete" != "$all_work_resolved_target_current_oid" ]; then
    echo 'fixture guard blocks source deletion because target ref moved during exact-OID content verification' >&2
    exit 70
  fi
  all_work_resolved_target_current_oid=$all_work_resolved_target_oid_before_delete
  all_work_resolved_guard_config_next="$all_work_resolved_guard_config.next"
  jq --arg target_oid "$all_work_resolved_target_current_oid" \
    '.target_expected_oid = $target_oid' "$all_work_resolved_guard_config" >"$all_work_resolved_guard_config_next"
  mv "$all_work_resolved_guard_config_next" "$all_work_resolved_guard_config"
  jq -n \
    --arg repo "$all_work_resolved_target_repo" \
    --arg ref "$all_work_resolved_target_ref" \
    --arg oid "$all_work_resolved_target_current_oid" \
    '{repo:$repo,ref:$ref,oid:$oid}' >"$all_work_resolved_observed_target_file"
  printf '%s %s bundle=%s restore=%s result=passed target=%s target_ref=%s target_oid=%s\n' \
    "$all_work_resolved_guard_repo" "$all_work_resolved_guard_ref" \
    "$all_work_resolved_bundle" "$all_work_resolved_restore" \
    "$all_work_resolved_target_repo" "$all_work_resolved_target_ref" "$all_work_resolved_target_current_oid" \
    >>"$XDG_STATE_HOME/all-work-resolved-delete-guard-passed.txt"
fi

exec "$TAILROCKS_REAL_GIT" "$@"
EOF
  chmod +x "$shim_dir/git"
}

run_all_work_resolved_retention_case() {
  : "${codex_bin:?Codex binary path must be set by agent-acceptance.sh}"
  : "${codex_permission_profile:?Codex permission profile must be set by agent-acceptance.sh}"
  : "${codex_filesystem_entries:?Codex filesystem profile must be set by agent-acceptance.sh}"
  : "${work:?acceptance work root must be set by agent-acceptance.sh}"
  : "${XDG_STATE_HOME:?isolated handoff root must be set by agent-acceptance.sh}"

  all_work_resolved_root="$work/all-work-resolved-retention-scan"
  all_work_resolved_seed="$work/all-work-resolved-seed"
  all_work_resolved_target="$work/all-work-resolved-target-candidate"
  all_work_resolved_clean_copy="$all_work_resolved_root/eligible-clean-copy"
  all_work_resolved_dirty_copy="$all_work_resolved_root/valuable-dirty-copy"
  all_work_resolved_active_copy="$all_work_resolved_root/active-writer-copy"
  all_work_resolved_cleanup_proof="$work/all-work-resolved-cleanup-proof"
  all_work_resolved_bundle="$all_work_resolved_cleanup_proof/feature-resolved.bundle"
  all_work_resolved_restore="$all_work_resolved_cleanup_proof/restore-test"
  all_work_resolved_remote=https://github.com/acme/all-work-resolved-retention.git
  all_work_resolved_label=all-work-resolved-retention

  mkdir -p "$all_work_resolved_root" "$all_work_resolved_cleanup_proof"
  make_repo "$all_work_resolved_seed"
  printf '*.local\n' >"$all_work_resolved_seed/.gitignore"
  printf 'base\n' >"$all_work_resolved_seed/README.md"
  printf 'mode=standard\ntarget=generic\n' >"$all_work_resolved_seed/worker.ini"
  printf 'durability=volatile\n' >"$all_work_resolved_seed/queue.ini"
  commit_all "$all_work_resolved_seed" 'fixture all-work base'
  git -C "$all_work_resolved_seed" checkout -q -b release/next main
  printf 'release/next requires mode=release and target=release-next\n' >"$all_work_resolved_seed/REQUIREMENTS.txt"
  printf 'mode=standard\ntarget=release-next\n' >"$all_work_resolved_seed/worker.ini"
  printf 'durability=volatile\n' >"$all_work_resolved_seed/queue.ini"
  printf 'cluster=west\nregion=production\n' >"$all_work_resolved_seed/release-policy.ini"
  commit_all "$all_work_resolved_seed" 'fixture release target behavior and requirements'
  all_work_resolved_target_seed_oid=$(git -C "$all_work_resolved_seed" rev-parse refs/heads/release/next)
  git -C "$all_work_resolved_seed" checkout -q main
  git -C "$all_work_resolved_seed" remote add origin "$all_work_resolved_remote"

  git clone -q --local --no-hardlinks "$all_work_resolved_seed" "$all_work_resolved_target"
  git -C "$all_work_resolved_target" remote set-url origin "$all_work_resolved_remote"
  git -C "$all_work_resolved_target" config user.name 'Disposable Fixture'
  git -C "$all_work_resolved_target" config user.email fixture@example.invalid
  git -C "$all_work_resolved_target" branch release/next origin/release/next
  git -C "$all_work_resolved_target" checkout -q release/next
  all_work_resolved_candidate_main_before=$(git -C "$all_work_resolved_target" rev-parse refs/heads/main)
  all_work_resolved_target_before=$(git -C "$all_work_resolved_target" rev-parse refs/heads/release/next)
  test "$all_work_resolved_target_before" = "$all_work_resolved_target_seed_oid"

  git clone -q --local --no-hardlinks "$all_work_resolved_seed" "$all_work_resolved_clean_copy"
  git -C "$all_work_resolved_clean_copy" remote set-url origin "$all_work_resolved_remote"
  git -C "$all_work_resolved_clean_copy" config user.name 'Disposable Fixture'
  git -C "$all_work_resolved_clean_copy" config user.email fixture@example.invalid
  git -C "$all_work_resolved_clean_copy" branch release/next origin/release/next
  git -C "$all_work_resolved_clean_copy" checkout -q -b feature/resolved main
  cat >"$all_work_resolved_clean_copy/WORK_ITEM.md" <<'EOF'
# Unfinished goal: release worker mode

This valid source-local goal applies to the exact `release/next` target.
Acceptance: `worker.ini` must use `mode=release`; retain the selected target's
`target=release-next`; `queue.ini` must use `durability=durable`. Do not
replace target-only policy or replay a stale whole branch.
EOF
  commit_all "$all_work_resolved_clean_copy" 'record release worker goal'
  printf 'mode=release\ntarget=generic\n' >"$all_work_resolved_clean_copy/worker.ini"
  printf 'durability=durable\n' >"$all_work_resolved_clean_copy/queue.ini"
  commit_all "$all_work_resolved_clean_copy" 'implement release worker goal'
  all_work_resolved_source_oid=$(git -C "$all_work_resolved_clean_copy" rev-parse refs/heads/feature/resolved)
  git -C "$all_work_resolved_clean_copy" checkout -q release/next
  git -C "$all_work_resolved_clean_copy" remote get-url origin | grep -F -x -q "$all_work_resolved_remote"

  git clone -q --local --no-hardlinks "$all_work_resolved_seed" "$all_work_resolved_dirty_copy"
  git -C "$all_work_resolved_dirty_copy" remote set-url origin "$all_work_resolved_remote"
  git -C "$all_work_resolved_dirty_copy" config user.name 'Disposable Fixture'
  git -C "$all_work_resolved_dirty_copy" config user.email fixture@example.invalid
  git -C "$all_work_resolved_dirty_copy" branch release/next origin/release/next
  git -C "$all_work_resolved_dirty_copy" checkout -q -b feature/dirty main
  printf 'committed valuable notes\n' >"$all_work_resolved_dirty_copy/user-notes.txt"
  commit_all "$all_work_resolved_dirty_copy" 'fixture valuable dirty-source base'
  all_work_resolved_dirty_source_oid=$(git -C "$all_work_resolved_dirty_copy" rev-parse refs/heads/feature/dirty)
  printf 'tracked dirty notes\n' >"$all_work_resolved_dirty_copy/user-notes.txt"
  printf 'untracked work in progress\n' >"$all_work_resolved_dirty_copy/untracked.notes"
  printf 'valuable ignored local output\n' >"$all_work_resolved_dirty_copy/valuable.local"

  git clone -q --local --no-hardlinks "$all_work_resolved_seed" "$all_work_resolved_active_copy"
  git -C "$all_work_resolved_active_copy" remote set-url origin "$all_work_resolved_remote"
  git -C "$all_work_resolved_active_copy" config user.name 'Disposable Fixture'
  git -C "$all_work_resolved_active_copy" config user.email fixture@example.invalid
  git -C "$all_work_resolved_active_copy" branch release/next origin/release/next
  git -C "$all_work_resolved_active_copy" checkout -q -b feature/active main
  printf 'active source work in progress\n' >"$all_work_resolved_active_copy/active-feature.txt"
  commit_all "$all_work_resolved_active_copy" 'fixture active source work'
  all_work_resolved_active_source_oid=$(git -C "$all_work_resolved_active_copy" rev-parse refs/heads/feature/active)

  all_work_resolved_clean_refs_before="$work/all-work-resolved-clean-refs.before"
  all_work_resolved_clean_state_before="$work/all-work-resolved-clean-state.before"
  all_work_resolved_dirty_state_before="$work/all-work-resolved-dirty-state.before"
  all_work_resolved_active_refs_before="$work/all-work-resolved-active-refs.before"
  all_work_resolved_active_state_before="$work/all-work-resolved-active-state.before"
  all_work_resolved_target_refs_before="$work/all-work-resolved-target-refs.before"
  snapshot_refs "$all_work_resolved_clean_copy" "$all_work_resolved_clean_refs_before"
  snapshot_source_state "$all_work_resolved_clean_copy" "$all_work_resolved_clean_state_before"
  snapshot_source_state "$all_work_resolved_dirty_copy" "$all_work_resolved_dirty_state_before"
  snapshot_refs "$all_work_resolved_active_copy" "$all_work_resolved_active_refs_before"
  snapshot_source_state "$all_work_resolved_active_copy" "$all_work_resolved_active_state_before"
  snapshot_refs "$all_work_resolved_target" "$all_work_resolved_target_refs_before"
  all_work_resolved_source_membership_before="$work/all-work-resolved-source-membership.before.json"
  all_work_resolved_target_membership_before="$work/all-work-resolved-target-membership.before.json"
  all_work_resolved_membership_before="$work/all-work-resolved-membership.before.json"
  all_work_resolved_scan_membership "$all_work_resolved_root" "$all_work_resolved_source_membership_before"
  all_work_resolved_scan_membership "$all_work_resolved_target" "$all_work_resolved_target_membership_before"
  jq -e --arg clean "$all_work_resolved_clean_copy" --arg dirty "$all_work_resolved_dirty_copy" \
    --arg active "$all_work_resolved_active_copy" \
    'map(.path) == ([$clean,$dirty,$active] | sort)' "$all_work_resolved_source_membership_before" >/dev/null || {
      echo 'independent initial scan found unexpected source-clone membership' >&2
      return 1
    }
  jq -e --arg target "$all_work_resolved_target" \
    'length == 1 and .[0].path == $target' "$all_work_resolved_target_membership_before" >/dev/null || {
      echo 'independent initial target scan did not resolve exactly the selected target candidate' >&2
      return 1
    }
  jq -s -c 'add | sort_by(.path)' \
    "$all_work_resolved_source_membership_before" "$all_work_resolved_target_membership_before" \
    >"$all_work_resolved_membership_before"
  all_work_resolved_clean_head_before=$(git -C "$all_work_resolved_clean_copy" rev-parse HEAD)
  all_work_resolved_clean_target_ref_before=$(git -C "$all_work_resolved_clean_copy" rev-parse refs/heads/release/next)
  all_work_resolved_dirty_status_before=$(cat "$all_work_resolved_dirty_state_before.status")
  all_work_resolved_active_status_before=$(cat "$all_work_resolved_active_state_before.status")
  all_work_resolved_active_feature_hash_before=$(record_hash "$all_work_resolved_active_copy/active-feature.txt")

  all_work_resolved_writer_stop="$work/all-work-resolved-stop-writer"
  all_work_resolved_writer_pid=
  writer_stop=$all_work_resolved_writer_stop
  writer_pid=
  (
    while [ ! -f "$all_work_resolved_writer_stop" ]; do
      printf 'active writer marker\n' >>"$all_work_resolved_active_copy/active-writer.log"
      sleep 1
    done
  ) >/dev/null 2>&1 &
  all_work_resolved_writer_pid=$!
  writer_pid=$all_work_resolved_writer_pid
  printf '%s\n' "$all_work_resolved_writer_pid" >"$work/all-work-resolved-writer.pid"
  all_work_resolved_attempt=0
  while [ ! -s "$all_work_resolved_active_copy/active-writer.log" ] && [ "$all_work_resolved_attempt" -lt 10 ]; do
    sleep 1
    all_work_resolved_attempt=$((all_work_resolved_attempt + 1))
  done
  test -s "$all_work_resolved_active_copy/active-writer.log"
  all_work_resolved_writer_prefix_before="$work/all-work-resolved-writer-prefix.before"
  cp "$all_work_resolved_active_copy/active-writer.log" "$all_work_resolved_writer_prefix_before"
  all_work_resolved_writer_bytes_before=$(wc -c <"$all_work_resolved_writer_prefix_before" | tr -d '[:space:]')
  all_work_resolved_active_state_before="$work/all-work-resolved-active-state.before"
  snapshot_source_state "$all_work_resolved_active_copy" "$all_work_resolved_active_state_before"
  all_work_resolved_active_status_before=$(cat "$all_work_resolved_active_state_before.status")
  all_work_resolved_active_feature_hash_before=$(record_hash "$all_work_resolved_active_copy/active-feature.txt")
  sed '/^active-writer\.log /d' "$all_work_resolved_active_state_before.files" >"$work/all-work-resolved-active-nonwriter.before"

  all_work_resolved_probe_permissions
  for all_work_resolved_repo in \
    "$all_work_resolved_clean_copy" \
    "$all_work_resolved_dirty_copy" \
    "$all_work_resolved_active_copy"; do
    test ! -e "$all_work_resolved_repo/.tailrocks-descendant-write-probe"
  done
  test ! -e "$all_work_resolved_root/.tailrocks-parent-write-probe"

  test "$(git -C "$all_work_resolved_target" rev-parse refs/heads/release/next)" = "$all_work_resolved_target_before"
  all_work_resolved_handoff_dir="$XDG_STATE_HOME/tailrocks/repo-merge/runs"
  all_work_resolved_handoffs_before="$work/all-work-resolved-handoffs.before"
  mkdir -p "$all_work_resolved_handoff_dir"
  find "$all_work_resolved_handoff_dir" -type f -name '*.md' -print | LC_ALL=C sort >"$all_work_resolved_handoffs_before"
  all_work_resolved_handoffs_before_count=$(wc -l <"$all_work_resolved_handoffs_before" | tr -d '[:space:]')
  : >>"$TAILROCKS_GIT_SHIM_LOG"
  all_work_resolved_git_log_lines_before=$(wc -l <"$TAILROCKS_GIT_SHIM_LOG" | tr -d '[:space:]')
  all_work_resolved_install_delete_guard
  mkdir -p "$work/all-work-resolved-runner"
  run_agent "$all_work_resolved_label" "$all_work_resolved_target" :workspace \
    "Use \$repo-merge --repo=acme/all-work-resolved-retention --all-work --local-only --cleanup=resolved --target-branch=release/next with no source selectors, together with \$tailrocks-repository-cleanup --repo=acme/all-work-resolved-retention --all-work --local-only --cleanup=resolved --target-branch=release/next selected only as repo-merge's final-phase owner in this same invocation. Repo-merge must first discover and select exact membership, then delegate only that exact selected source set to cleanup; never call cleanup as a separate independent operation or let it broaden membership. The only authorized scan root is $all_work_resolved_root; it contains a finite disposable fixture, not the host. Do not name or assume candidate paths or refs: discover identity and membership from the root. Compare each actual source implementation against the exact selected target and its requirements. Finish the valid clean source-local goal on the target candidate, preserving target-only policy and all better target behavior. Recheck canonical ownership, exact refs/OIDs, dependencies, and writers immediately before side effects. Before deleting any source, make a Git bundle at $all_work_resolved_bundle, verify it, restore-test it at $all_work_resolved_restore, verify refs and WORK_ITEM.md/worker.ini/queue.ini bytes, then re-read exact refs and OIDs. Invoke the selected cleanup owner only through repo-merge's final phase; do not bypass its guarded contract or invent an invocation receipt. The fixture Git guard will refuse any deletion except exact refs/heads/feature/resolved in its original clean source clone, and only after that real bundle/restore test passes. Never stop the active writer. Retain dirty/untracked/valuable ignored state and the active-writer clone unchanged with explicit reasons. After any cleanup, rediscover the same root and report initial and final membership. Keep coverage partial/false: roots beyond this one are not in scope and cannot be claimed complete. No remote writes. Return strict JSON with outcome partial; target_branch, target_base_oid and exact final target_oid; resolved_sources[{path,ref,source_oid,target_branch,target_base_oid,target_oid,disposition}]; cleanup{snapshot_path,restore_test_path,restore_test,deleted_refs}; retained_resources[{path,reason}]; membership:{initial:[{path,refs:[{ref,oid}]}],final:[{path,refs:[{ref,oid}]}]}; scan_roots; coverage_complete:false; coverage_gaps; handoff_path." \
    "$all_work_resolved_root" \
    --writable-scan-descendant "$all_work_resolved_clean_copy" \
    "$all_work_resolved_cleanup_proof"
  cp "$all_work_resolved_git_shim_backup" "$shim_dir/git"

  all_work_resolved_source_membership_after="$work/all-work-resolved-source-membership.after.json"
  all_work_resolved_target_membership_after="$work/all-work-resolved-target-membership.after.json"
  all_work_resolved_membership_after="$work/all-work-resolved-membership.after.json"
  all_work_resolved_scan_membership "$all_work_resolved_root" "$all_work_resolved_source_membership_after"
  all_work_resolved_scan_membership "$all_work_resolved_target" "$all_work_resolved_target_membership_after"
  jq -s -c 'add | sort_by(.path)' \
    "$all_work_resolved_source_membership_after" "$all_work_resolved_target_membership_after" \
    >"$all_work_resolved_membership_after"
  all_work_resolved_target_after=$("$TAILROCKS_REAL_GIT" -C "$all_work_resolved_target" rev-parse refs/heads/release/next)
  jq -e \
    --slurpfile initial "$all_work_resolved_membership_before" \
    --slurpfile final "$all_work_resolved_membership_after" \
    --arg clean "$all_work_resolved_clean_copy" \
    --arg target "$all_work_resolved_target" \
    --arg source_ref refs/heads/feature/resolved \
    --arg target_ref refs/heads/release/next \
    --arg target_oid "$all_work_resolved_target_after" \
    --arg dirty "$all_work_resolved_dirty_copy" \
    --arg active "$all_work_resolved_active_copy" \
    '
    ($initial[0] | map(.path)) == ([$clean,$dirty,$active,$target] | sort) and
     ($initial[0] | map(if .path == $clean then .refs = [.refs[] | select(.ref != $source_ref)]
                        elif .path == $target then .refs = [.refs[] | if .ref == $target_ref then .oid = $target_oid else . end]
                        else . end)) == $final[0]' >/dev/null || {
      echo 'independent post-cleanup repository/ref rescan found membership changes beyond the exact eligible source ref and selected target ref' >&2
      diff -u "$all_work_resolved_membership_before" "$all_work_resolved_membership_after" >&2 || true
      return 1
    }

  kill -0 "$all_work_resolved_writer_pid" 2>/dev/null || {
    echo 'the active all-work fixture writer was stopped by the agent' >&2
    return 1
  }
  all_work_resolved_writer_state=$(ps -p "$all_work_resolved_writer_pid" -o stat= 2>/dev/null | tr -d '[:space:]' || true)
  case "$all_work_resolved_writer_state" in
    ''|*Z*)
      echo "the active all-work fixture writer is not running (state: ${all_work_resolved_writer_state:-missing})" >&2
      return 1
      ;;
  esac
  all_work_resolved_writer_bytes_after=$(wc -c <"$all_work_resolved_active_copy/active-writer.log" | tr -d '[:space:]')
  if [ "$all_work_resolved_writer_bytes_after" -le "$all_work_resolved_writer_bytes_before" ]; then
    echo 'the active all-work fixture writer did not advance during agent execution' >&2
    return 1
  fi
  dd if="$all_work_resolved_active_copy/active-writer.log" bs=1 count="$all_work_resolved_writer_bytes_before" 2>/dev/null |
    cmp -s - "$all_work_resolved_writer_prefix_before"
  awk '!/^active writer marker$/ { bad = 1 } END { exit bad }' "$all_work_resolved_active_copy/active-writer.log"
  test -s "$XDG_STATE_HOME/all-work-resolved-delete-guard-passed.txt"
  all_work_resolved_delete_guard_count=$(wc -l <"$XDG_STATE_HOME/all-work-resolved-delete-guard-passed.txt" | tr -d '[:space:]')
  test "$all_work_resolved_delete_guard_count" = 1
  grep -F -q "$all_work_resolved_clean_copy refs/heads/feature/resolved $all_work_resolved_bundle $all_work_resolved_restore result=passed" \
    "$XDG_STATE_HOME/all-work-resolved-delete-guard-passed.txt"
  jq -e \
    --arg repo "$all_work_resolved_target" \
    --arg ref refs/heads/release/next \
    --arg oid "$all_work_resolved_target_after" \
    '.repo == $repo and .ref == $ref and .oid == $oid' \
    "$XDG_STATE_HOME/all-work-resolved-target-before-delete.json" >/dev/null || {
      echo 'fixture guard target OID observed immediately before source deletion differs from final target proof' >&2
      return 1
    }
  jq -e --arg oid "$all_work_resolved_target_after" \
    '.target_expected_oid == $oid' \
    "$XDG_STATE_HOME/all-work-resolved-delete-guard.json" >/dev/null || {
      echo 'fixture guard did not bind its expected target OID to the final target proof' >&2
      return 1
    }

  all_work_resolved_expected_clean_refs="$work/all-work-resolved-clean-refs.expected-after"
  grep -F -v 'refs/heads/feature/resolved ' "$all_work_resolved_clean_refs_before" >"$all_work_resolved_expected_clean_refs"
  snapshot_refs "$all_work_resolved_clean_copy" "$work/all-work-resolved-clean-refs.after"
  cmp -s "$all_work_resolved_expected_clean_refs" "$work/all-work-resolved-clean-refs.after" || {
    echo 'clean source clone changed refs beyond the one exact eligible source ref' >&2
    diff -u "$all_work_resolved_expected_clean_refs" "$work/all-work-resolved-clean-refs.after" >&2 || true
    return 1
  }
  test "$(git -C "$all_work_resolved_clean_copy" rev-parse HEAD)" = "$all_work_resolved_clean_head_before"
  test "$(git -C "$all_work_resolved_clean_copy" rev-parse refs/heads/release/next)" = "$all_work_resolved_clean_target_ref_before"
  snapshot_source_state "$all_work_resolved_clean_copy" "$all_work_resolved_clean_state_before.after"
  for all_work_resolved_suffix in status unstaged staged index files; do
    cmp -s "$all_work_resolved_clean_state_before.$all_work_resolved_suffix" "$all_work_resolved_clean_state_before.after.$all_work_resolved_suffix"
  done

  assert_same_source_state "$all_work_resolved_dirty_copy" "$all_work_resolved_dirty_state_before"
  test "$(git -C "$all_work_resolved_dirty_copy" rev-parse refs/heads/feature/dirty)" = "$all_work_resolved_dirty_source_oid"
  test "$(git -C "$all_work_resolved_dirty_copy" status --porcelain=v2 --branch --untracked-files=all)" = "$all_work_resolved_dirty_status_before"
  test "$(git -C "$all_work_resolved_dirty_copy" show HEAD:user-notes.txt)" = 'committed valuable notes'
  grep -F -q 'tracked dirty notes' "$all_work_resolved_dirty_copy/user-notes.txt"
  grep -F -q 'untracked work in progress' "$all_work_resolved_dirty_copy/untracked.notes"
  grep -F -q 'valuable ignored local output' "$all_work_resolved_dirty_copy/valuable.local"

  all_work_resolved_active_state_after="$work/all-work-resolved-active-state.after"
  snapshot_source_state "$all_work_resolved_active_copy" "$all_work_resolved_active_state_after"
  cmp -s "$all_work_resolved_active_state_before.status" "$all_work_resolved_active_state_after.status"
  cmp -s "$all_work_resolved_active_state_before.unstaged" "$all_work_resolved_active_state_after.unstaged"
  cmp -s "$all_work_resolved_active_state_before.staged" "$all_work_resolved_active_state_after.staged"
  cmp -s "$all_work_resolved_active_state_before.index" "$all_work_resolved_active_state_after.index"
  sed '/^active-writer\.log /d' "$all_work_resolved_active_state_after.files" >"$work/all-work-resolved-active-nonwriter.after"
  cmp -s "$work/all-work-resolved-active-nonwriter.before" "$work/all-work-resolved-active-nonwriter.after"
  assert_same_refs "$all_work_resolved_active_copy" "$all_work_resolved_active_refs_before"
  test "$(git -C "$all_work_resolved_active_copy" rev-parse HEAD)" = "$all_work_resolved_active_source_oid"
  test "$(git -C "$all_work_resolved_active_copy" status --porcelain=v2 --branch --untracked-files=all)" = "$all_work_resolved_active_status_before"
  test "$(record_hash "$all_work_resolved_active_copy/active-feature.txt")" = "$all_work_resolved_active_feature_hash_before"

  all_work_resolved_target_after=$(git -C "$all_work_resolved_target" rev-parse refs/heads/release/next)
  test "$all_work_resolved_target_after" != "$all_work_resolved_target_before"
  test "$(git -C "$all_work_resolved_target" rev-parse refs/heads/main)" = "$all_work_resolved_candidate_main_before"
  assert_refs_preserved_except "$all_work_resolved_target" "$all_work_resolved_target_refs_before" refs/heads/release/next
  grep -F -v 'refs/heads/release/next ' "$all_work_resolved_target_refs_before" >"$work/all-work-resolved-target-refs.expected"
  snapshot_refs "$all_work_resolved_target" "$work/all-work-resolved-target-refs.after"
  grep -F -v 'refs/heads/release/next ' "$work/all-work-resolved-target-refs.after" >"$work/all-work-resolved-target-refs.actual"
  cmp -s "$work/all-work-resolved-target-refs.expected" "$work/all-work-resolved-target-refs.actual"
  test "$(git -C "$all_work_resolved_target" show refs/heads/release/next:worker.ini)" = "$(printf 'mode=release\ntarget=release-next')"
  test "$(git -C "$all_work_resolved_target" show refs/heads/release/next:queue.ini)" = 'durability=durable'
  test "$(git -C "$all_work_resolved_target" show refs/heads/release/next:REQUIREMENTS.txt)" = 'release/next requires mode=release and target=release-next'
  test "$(git -C "$all_work_resolved_target" show refs/heads/release/next:release-policy.ini)" = "$(printf 'cluster=west\nregion=production')"
  test "$(git -C "$all_work_resolved_target" show refs/heads/release/next:README.md)" = 'base'

  git bundle verify "$all_work_resolved_bundle" >"$work/all-work-resolved-bundle-verify.txt" 2>&1
  git bundle list-heads "$all_work_resolved_bundle" |
    awk -v oid="$all_work_resolved_source_oid" '$1 == oid && $2 == "refs/heads/feature/resolved" { found = 1 } END { exit !found }'
  test "$(git -C "$all_work_resolved_restore" rev-parse refs/heads/feature/resolved)" = "$all_work_resolved_source_oid"
  for all_work_resolved_file in WORK_ITEM.md worker.ini queue.ini; do
    git -C "$all_work_resolved_restore" show "refs/heads/feature/resolved:$all_work_resolved_file" |
      cmp -s - "$all_work_resolved_restore/$all_work_resolved_file"
  done
  test "$(git -C "$all_work_resolved_restore" show refs/heads/feature/resolved:worker.ini)" = "$(printf 'mode=release\ntarget=generic')"
  test "$(git -C "$all_work_resolved_restore" show refs/heads/feature/resolved:queue.ini)" = 'durability=durable'

  all_work_resolved_handoffs_after="$work/all-work-resolved-handoffs.after"
  find "$all_work_resolved_handoff_dir" -type f -name '*.md' -print | LC_ALL=C sort >"$all_work_resolved_handoffs_after"
  all_work_resolved_handoffs_after_count=$(wc -l <"$all_work_resolved_handoffs_after" | tr -d '[:space:]')
  test "$all_work_resolved_handoffs_after_count" -eq $((all_work_resolved_handoffs_before_count + 1))
  comm -13 "$all_work_resolved_handoffs_before" "$all_work_resolved_handoffs_after" >"$work/all-work-resolved-handoff-new.txt"
  all_work_resolved_handoff=$(sed -n '1p' "$work/all-work-resolved-handoff-new.txt")
  case "$all_work_resolved_handoff" in
    "$all_work_resolved_handoff_dir"/*.md) ;;
    *) echo "all-work handoff escaped isolated XDG run directory: $all_work_resolved_handoff" >&2; return 1 ;;
  esac
  case "$all_work_resolved_handoff" in
    "$all_work_resolved_root"/*|"$all_work_resolved_target"/*|"$all_work_resolved_clean_copy"/*|"$all_work_resolved_dirty_copy"/*|"$all_work_resolved_active_copy"/*)
      echo 'all-work handoff was written inside a scanned source or target repository' >&2
      return 1
      ;;
  esac
  for all_work_resolved_member in \
    "$all_work_resolved_root" \
    "$all_work_resolved_target" \
    "$all_work_resolved_clean_copy" \
    "$all_work_resolved_dirty_copy" \
    "$all_work_resolved_active_copy"; do
    all_work_resolved_member_count=$(grep -F -o "$all_work_resolved_member" "$all_work_resolved_handoff" | wc -l | tr -d '[:space:]')
    if [ "$all_work_resolved_member_count" -lt 2 ]; then
      echo "all-work handoff did not record initial and final membership for $all_work_resolved_member" >&2
      return 1
    fi
  done
  grep -F -q "$all_work_resolved_source_oid" "$all_work_resolved_handoff"
  grep -F -q "$all_work_resolved_target_before" "$all_work_resolved_handoff"
  grep -F -q "$all_work_resolved_target_after" "$all_work_resolved_handoff"
  grep -Ei -q 'initial.*(membership|inventory|discovered)|initial (membership|inventory|discovered)' "$all_work_resolved_handoff"
  grep -Ei -q 'final.*(membership|inventory|discovered)|final (membership|inventory|discovered)' "$all_work_resolved_handoff"
  grep -Ei -q 'decision|action' "$all_work_resolved_handoff"
  grep -Ei -q 'test|validation' "$all_work_resolved_handoff"
  grep -Ei -q 'CI|review' "$all_work_resolved_handoff"
  grep -Ei -q 'landing|landed-local' "$all_work_resolved_handoff"
  grep -Ei -q 'cleanup|restore' "$all_work_resolved_handoff"
  grep -Ei -q 'coverage gap|coverage.*partial|coverage.*false|inaccessible root' "$all_work_resolved_handoff"
  grep -Ei -q 'active writer|writer.*active' "$all_work_resolved_handoff"
  grep -Ei -q 'dirty|untracked|ignored' "$all_work_resolved_handoff"

  all_work_resolved_git_log_lines_after=$(wc -l <"$TAILROCKS_GIT_SHIM_LOG" | tr -d '[:space:]')
  test "$all_work_resolved_git_log_lines_after" -gt "$all_work_resolved_git_log_lines_before"
  all_work_resolved_git_invocations="$work/all-work-resolved-git-invocations.jsonl"
  tail -n "+$((all_work_resolved_git_log_lines_before + 1))" "$TAILROCKS_GIT_SHIM_LOG" >"$all_work_resolved_git_invocations"
  jq -e -s --arg abs_ref refs/heads/feature/resolved --arg expected_oid "$all_work_resolved_source_oid" '
    def cas_delete:
      (index("update-ref") != null) and
      (index("-d") != null or index("--delete") != null) and
      (index($abs_ref) as $ref_index
       | $ref_index != null
       and .[$ref_index + 1] == $expected_oid
       and length == ($ref_index + 2));
    any(.[]; cas_delete) and
    all(.[];
      (index("branch") == null or
        (index("-d") == null and index("-D") == null and index("--delete") == null)) and
      (index("update-ref") == null or
        (index("-d") == null and index("--delete") == null) or cas_delete)
    )
  ' "$all_work_resolved_git_invocations" >/dev/null

  jq -e \
    --arg root "$all_work_resolved_root" \
    --arg target_before "$all_work_resolved_target_before" \
    --arg target_after "$all_work_resolved_target_after" \
    --arg clean "$all_work_resolved_clean_copy" \
    --arg source_ref refs/heads/feature/resolved \
    --arg source_oid "$all_work_resolved_source_oid" \
    --arg dirty "$all_work_resolved_dirty_copy" \
    --arg dirty_oid "$all_work_resolved_dirty_source_oid" \
    --arg active "$all_work_resolved_active_copy" \
    --arg active_oid "$all_work_resolved_active_source_oid" \
    --arg bundle "$all_work_resolved_bundle" \
    --arg restore "$all_work_resolved_restore" \
    --arg handoff "$all_work_resolved_handoff" \
    --slurpfile initial_membership "$all_work_resolved_membership_before" \
    --slurpfile final_membership "$all_work_resolved_membership_after" \
    '
      def canon_membership: map(.refs |= sort_by(.ref)) | sort_by(.path);
      .outcome == "partial" and
      .target_branch == "release/next" and
      .target_base_oid == $target_before and
      .target_oid == $target_after and
      .scan_roots == [$root] and
      .coverage_complete == false and (.coverage_gaps | length > 0) and
      ([.resolved_sources[] | select(.path == $clean and .ref == $source_ref and .source_oid == $source_oid and .target_branch == "release/next" and .target_base_oid == $target_before and .target_oid == $target_after and .disposition == "landed-local")] | length == 1) and
      .cleanup.snapshot_path == $bundle and
      .cleanup.restore_test_path == $restore and
      .cleanup.restore_test == "passed" and
      .cleanup.deleted_refs == [$source_ref] and
      (.membership.initial | canon_membership) == ($initial_membership[0] | canon_membership) and
      (.membership.final | canon_membership) == ($final_membership[0] | canon_membership) and
      ([.retained_resources[] | select(.path == $dirty) | .reason | test("dirty";"i") and test("untracked";"i") and test("ignored";"i")] | length == 1) and
      ([.retained_resources[] | select(.path == $active) | .reason | test("active";"i") and test("writer";"i")] | length == 1) and
      ([.membership.initial[] | select(.path == $clean and any(.refs[]; .ref == $source_ref and .oid == $source_oid))] | length == 1) and
      ([.membership.initial[] | select(.path == $dirty and any(.refs[]; .ref == "refs/heads/feature/dirty" and .oid == $dirty_oid))] | length == 1) and
      ([.membership.initial[] | select(.path == $active and any(.refs[]; .ref == "refs/heads/feature/active" and .oid == $active_oid))] | length == 1) and
      ([.membership.final[] | select(.path == $clean and ([.refs[] | select(.ref == $source_ref)] | length == 0))] | length == 1) and
      ([.membership.final[] | select(.path == $dirty and any(.refs[]; .ref == "refs/heads/feature/dirty" and .oid == $dirty_oid))] | length == 1) and
      ([.membership.final[] | select(.path == $active and any(.refs[]; .ref == "refs/heads/feature/active" and .oid == $active_oid))] | length == 1) and
      .handoff_path == $handoff
    ' "$work/$all_work_resolved_label.final.txt" >/dev/null || {
      echo 'normal-mode all-work retention response did not match exact source/target, cleanup, retention, coverage, and membership contract' >&2
      cat "$work/$all_work_resolved_label.final.txt" >&2
      return 1
    }

  : >"$all_work_resolved_writer_stop"
  wait "$all_work_resolved_writer_pid" 2>/dev/null || true
  writer_pid=
  record 'verified=normal all-work cleanup guarded by exact pre-delete restore test; release/next completed target-relatively; only eligible source ref removed; dirty and active clones retained; coverage partial'
  record 'verified=cleanup-owner invocation is not independently observable from Codex client trace; evidence proves installed-plugin composition and guarded ref result only'
}
