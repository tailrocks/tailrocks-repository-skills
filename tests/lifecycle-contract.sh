#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
composition="$repo_root/skills/shared/lifecycle-composition.md"
facade="$repo_root/skills/repo-merge/SKILL.md"
audit="$repo_root/skills/tailrocks-repository-audit/SKILL.md"
acceptance="$repo_root/tests/agent-acceptance.sh"
claude_install="$repo_root/tests/claude-install-acceptance.sh"
all_work_retention="$repo_root/tests/fixtures/all-work-resolved-retention.sh"

require_text() {
  file=$1
  text=$2
  if ! grep -F -q -- "$text" "$file"; then
    echo "lifecycle ownership contract missing from $file: $text" >&2
    exit 1
  fi
}

require_text "$composition" 'tailrocks-review-pr'
require_text "$composition" 'read-only'
require_text "$composition" 'merge-preflight.ts'
require_text "$composition" 'tailrocks-merge-pr'
require_text "$composition" 'merge-pr.ts'
require_text "$composition" 'exact PR'
require_text "$composition" 'expected head'
require_text "$composition" 'selected target'
require_text "$composition" 'review'
require_text "$composition" 'CI'
require_text "$composition" 'worklist'
require_text "$composition" 'high-risk'
require_text "$composition" 'before mutation'
require_text "$composition" 'the owner, or a fresh review is unavailable'
require_text "$composition" 'Never replace these owners with a direct'
require_text "$composition" 'gh pr merge'
require_text "$composition" 'atomically guard the exact selected base ref/name and OID during mutation'
require_text "$composition" '2b4f71f49fd27061e64d16b2b7f83d9bd2df5612'
require_text "$composition" 'Local-only fixture results are separate'

require_text "$facade" 'performs its read-only audit stage inline'
require_text "$facade" 'does not invoke that'
require_text "$facade" 'manual-only skill as a separate phase'
require_text "$facade" 'Perform the read-only audit stage inline'
require_text "$audit" 'disable-model-invocation: true'
require_text "$audit" 'user-invocable: true'

require_text "$acceptance" '--cd "$canonical_cwd" --add-dir "$canonical_xdg_state_home"'
require_text "$acceptance" 'codex_permission_profile="tailrocks_acceptance_$marketplace_suffix"'
require_text "$acceptance" 'permissions.$codex_permission_profile.extends=\"$permission_base\"'
require_text "$acceptance" 'permissions.$codex_permission_profile.filesystem=$run_filesystem_config'
require_text "$acceptance" 'permissions.$codex_permission_profile.network.enabled=false'
require_text "$acceptance" '--ignore-user-config'
require_text "$acceptance" 'projects.\"$canonical_cwd\".trust_level=\"trusted\"'
require_text "$acceptance" 'install_project_local_plugins "$canonical_cwd"'
require_text "$acceptance" 'repo-local-marketplace-and-project-config'
require_text "$acceptance" 'caller_config_and_unrelated_plugins=untouched; Codex may create the exact unique local marketplace cache, which this runner retains and never auto-deletes'
require_text "$acceptance" 'run_codex_cli()'
require_text "$acceptance" 'env -i \'
require_text "$acceptance" 'codex_outer_environment=env-i allowlist'
require_text "$acceptance" 'ambient OPENAI_API_KEY and unrelated variables omitted'
require_text "$acceptance" 'sanitized Codex CLI did not report a persisted login'
require_text "$acceptance" 'TAILROCKS_REAL_GIT="${TAILROCKS_REAL_GIT:-}"'
require_text "$acceptance" 'TAILROCKS_GH_FIXTURE_DIR="${TAILROCKS_GH_FIXTURE_DIR:-}"'
require_text "$acceptance" 'run_codex_cli "$codex_command_home" "$codex_home" "$canonical_task_tmpdir" "" fixture'
require_text "$acceptance" 'codex_plugin_cache_marketplace="$codex_plugin_cache_root/$marketplace_name"'
require_text "$acceptance" 'codex_filesystem_entries='
require_text "$acceptance" '":root"="deny"'
require_text "$acceptance" '":minimal"="read"'
require_text "$acceptance" '":workspace_roots"={"."="write",".git"="write"}'
require_text "$acceptance" '":slash_tmp"="deny"'
require_text "$acceptance" '":tmpdir"="write"'
require_text "$acceptance" 'append_shell_environment_value TMPDIR "$canonical_task_tmpdir"'
require_text "$acceptance" 'codex_task_tmpdir="$work/.tmp"'
require_text "$acceptance" 'mkdir -p "$codex_task_tmpdir" "$codex_command_home"'
require_text "$acceptance" 'CDPATH= cd -- "$canonical_work" &&'
require_text "$acceptance" 'case "$canonical_scan_root" in'
require_text "$acceptance" 'paths_overlap()'
require_text "$acceptance" 'BLOCKED: all-work writable path overlaps its read-only scan root:'
require_text "$acceptance" 'BLOCKED: Codex scan root overlaps a writable project root:'
require_text "$acceptance" 'while [ "$#" -ge 2 ] && [ "$1" = "--writable-scan-descendant" ]; do'
require_text "$acceptance" 'writable scan descendants are limited to the dedicated normal-cleanup retention fixture'
require_text "$acceptance" 'writable scan root must be a strict child of the read-only scan root:'
require_text "$acceptance" 'writable scan descendant must be an independent clone, not a linked worktree:'
require_text "$acceptance" 'BLOCKED: writable scan descendants overlap:'
require_text "$acceptance" 'run_filesystem_config="$run_filesystem_config,$authorized_root_key=\"write\",$authorized_git_key=\"write\""'
require_text "$acceptance" 'record "explicit_writable_scan_descendant=$canonical_writable_scan_root"'
require_text "$acceptance" 'for codex_read_root in "$shim_dir" "$TAILROCKS_GH_FIXTURE_DIR"; do'
require_text "$acceptance" 'record "explicit_writable_root=$canonical_cwd"'
require_text "$acceptance" 'record "explicit_writable_root=$canonical_xdg_state_home"'
require_text "$acceptance" 'record "explicit_writable_root=$canonical_artifact_root"'
require_text "$acceptance" 'while [ "$artifact_index" -lt "$artifact_root_count" ]; do'
require_text "$acceptance" 'set -- "$@" "$canonical_artifact_root"'
require_text "$acceptance" 'artifact_root_count=$(($# - writable_scan_root_count))'
require_text "$acceptance" 'run_filesystem_config="$run_filesystem_config,$scan_root_key=\"read\""'
require_text "$acceptance" 'scan_root_access=read-only'
require_text "$acceptance" 'Codex artifact root is outside the owned fixture root:'
require_text "$acceptance" 'all-work writable artifact path overlaps its read-only scan root:'
require_text "$acceptance" 'retaining Codex acceptance artifacts after failed run:'
require_text "$acceptance" 'active_writer_state=$(ps -p "$writer_pid" -o stat='
require_text "$acceptance" 'active_writer_bytes_after=$(wc -c'
require_text "$acceptance" 'codex_task_tmpdir/home'
require_text "$acceptance" "append_shell_environment_value HOME \"\$codex_command_home\""
require_text "$acceptance" "append_shell_environment_value PATH \"\$agent_path\""
require_text "$acceptance" "append_shell_environment_value TAILROCKS_ENV_POLICY_CANARY_LOG \"\$TAILROCKS_ENV_POLICY_CANARY_LOG\""
require_text "$acceptance" "append_shell_environment_value TAILROCKS_REAL_GIT \"\$real_git\""
require_text "$acceptance" "append_shell_environment_value TAILROCKS_GH_FIXTURE_LOG \"\$TAILROCKS_GH_FIXTURE_LOG\""
require_text "$acceptance" "-c 'shell_environment_policy.inherit=\"none\"'"
require_text "$acceptance" "-c 'shell_environment_policy.ignore_default_excludes=false'"
require_text "$acceptance" '-c "shell_environment_policy.set={$codex_shell_environment_entries}"'
require_text "$acceptance" 'TAILROCKS_ACCEPTANCE_TOKEN_CANARY="tailrocks-acceptance-token-canary-$marketplace_suffix"'
require_text "$acceptance" 'test "$(cat "$TAILROCKS_ENV_POLICY_CANARY_LOG")" = absent'
require_text "$acceptance" 'pinned_pr_skills_sha=2b4f71f49fd27061e64d16b2b7f83d9bd2df5612'
require_text "$acceptance" 'if [ -z "${TAILROCKS_PR_SKILLS_ROOT:-}" ]; then'
require_text "$acceptance" 'if [ "${TAILROCKS_PR_SKILLS_SHA:-}" != "$pinned_pr_skills_sha" ]; then'
require_text "$acceptance" 'TAILROCKS_PR_SKILLS_ROOT="$TAILROCKS_PR_SKILLS_ROOT" \'
require_text "$acceptance" 'TAILROCKS_PR_SKILLS_SHA="$pinned_pr_skills_sha" \'
require_text "$acceptance" 'sh "$repo_root/tests/claude-install-acceptance.sh"'
require_text "$acceptance" 'install-only; isolated auth is unavailable, so no model invocation'
if grep -E -i -q '(^|[;&|[:space:]])(claude|claude_bin)[[:space:]]+(auth|login|logout|setup-token|--model|--print|-p([[:space:]]|$)|plugin[[:space:]]+(remove|uninstall))|--plugin-dir' "$acceptance"; then
  echo 'Claude acceptance route must not invoke auth, model, plugin-dir, uninstall, or remove behavior' >&2
  exit 1
fi
if grep -F -q 'record "input=$prompt"' "$acceptance" ||
  grep -F -q 'artifact_roots=$*' "$acceptance" ||
  grep -F -q 'for artifact_root in $artifact_roots' "$acceptance"; then
  echo 'Codex acceptance must not retain raw prompts or flatten artifact-root argument boundaries' >&2
  exit 1
fi
if grep -F -q -- '--sandbox workspace-write' "$acceptance" ||
  grep -F -q -- 'sandbox_workspace_write' "$acceptance"; then
  echo 'Codex acceptance must use the inline permission profile, not legacy workspace-write config' >&2
  exit 1
fi
if grep -E -q '\$codex_bin"[[:space:]]+plugin[[:space:]]+(marketplace[[:space:]]+)?(add|remove|install|uninstall|list)' "$acceptance"; then
  echo 'Codex fixture must not mutate or inspect caller-global plugin state' >&2
  exit 1
fi
git_write_count=$(grep -oF '".git"="write"' "$acceptance" | wc -l | tr -d ' ')
if [ "$git_write_count" -ne 1 ]; then
  echo "Codex .git write permission must appear exactly once in the scoped profile; found $git_write_count" >&2
  exit 1
fi
require_text "$acceptance" 'scan_root_root_write_authorized=false'
require_text "$all_work_retention" '"$codex_task_tmpdir" "$all_work_resolved_probe_file" probe sandbox'
if grep -E -q '(^|[[:space:]])OPENAI_API_KEY=' "$acceptance" "$all_work_retention"; then
  echo 'Codex acceptance must not inject an API key into the outer CLI or sandbox environment' >&2
  exit 1
fi
if grep -E -q '\$codex_bin"[[:space:]]+(--version|login[[:space:]]+status|sandbox|exec)' "$acceptance" ||
  grep -F -q '"$codex_bin" sandbox' "$all_work_retention"; then
  echo 'every Codex CLI invocation must use the sanitized env -i wrapper' >&2
  exit 1
fi

git_command=git
merge_command=merge
if grep -E -q "(^|[;&|[:space:]])${git_command}[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?${merge_command}([[:space:]]|$)" "$acceptance"; then
  echo 'fixture setup must seed independent target commits; shell landing commands are forbidden' >&2
  exit 1
fi

require_text "$facade" 'tailrocks-review-pr'
require_text "$facade" 'tailrocks-merge-pr'
require_text "$facade" 'generic `repo-merge` request or coordinator instruction alone does not'
require_text "$facade" 'If either owner is not explicitly selected'
require_text "$facade" 'block remote landing but continue safe'
require_text "$facade" 'tailrocks-create-pr` is manual-only and may run only when the active user'
require_text "$facade" 'Before remote landing, also verify that the installed merge owner atomically'
require_text "$facade" 'block remote landing; separate preflight or'
require_text "$facade" 'Block only work that depends on an unmet prerequisite.'

echo "pull-request lifecycle ownership: SOURCE CONTRACT ONLY (no agent result claimed)"
