#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)

blocked() {
  echo "BLOCKED: $*" >&2
  exit 2
}

if [ -z "${TAILROCKS_PR_SKILLS_ROOT:-}" ]; then
  blocked "set TAILROCKS_PR_SKILLS_ROOT to the local tailrocks-pull-request-skills checkout"
fi
if [ -z "${TAILROCKS_PR_SKILLS_SHA:-}" ]; then
  blocked "set TAILROCKS_PR_SKILLS_SHA to the exact full commit SHA for the PR-lifecycle owner"
fi

case "$TAILROCKS_PR_SKILLS_SHA" in
  *[!0123456789abcdef]*|'') blocked "TAILROCKS_PR_SKILLS_SHA must be a lowercase full 40-character commit SHA" ;;
esac
[ "${#TAILROCKS_PR_SKILLS_SHA}" -eq 40 ] ||
  blocked "TAILROCKS_PR_SKILLS_SHA must be a lowercase full 40-character commit SHA"

pr_skills_root=$(CDPATH= cd -- "$TAILROCKS_PR_SKILLS_ROOT" && pwd -P) ||
  blocked "TAILROCKS_PR_SKILLS_ROOT is not an accessible directory"
pr_skills_head=$(git -C "$pr_skills_root" rev-parse --verify 'HEAD^{commit}') ||
  blocked "cannot read PR-lifecycle owner checkout HEAD"
[ "$pr_skills_head" = "$TAILROCKS_PR_SKILLS_SHA" ] ||
  blocked "PR-lifecycle owner HEAD $pr_skills_head differs from requested pin $TAILROCKS_PR_SKILLS_SHA"
[ -z "$(git -C "$pr_skills_root" status --porcelain=v1 --untracked-files=all)" ] ||
  blocked "PR-lifecycle owner checkout is dirty; refusing to install anything except the exact pinned tree"
[ -z "$(git -C "$pr_skills_root" status --porcelain=v1 --ignored=matching --untracked-files=all -- .claude-plugin skills scripts)" ] ||
  blocked "PR-lifecycle owner plugin source paths contain ignored or untracked data outside the pinned commit"

for required in \
  .claude-plugin/marketplace.json \
  .claude-plugin/plugin.json \
  skills/tailrocks-repository-merge/SKILL.md \
  skills/tailrocks-repository-audit/SKILL.md \
  skills/tailrocks-repository-cleanup/SKILL.md; do
  [ -s "$repo_root/$required" ] || blocked "repository plugin is missing required file: $required"
done
for required in \
  .claude-plugin/marketplace.json \
  .claude-plugin/plugin.json \
  skills/tailrocks-review-pr/SKILL.md \
  skills/tailrocks-merge-pr/SKILL.md \
  scripts/merge-preflight.ts \
  scripts/merge-pr.ts; do
  git -C "$pr_skills_root" cat-file -e "$pr_skills_head:$required" 2>/dev/null ||
    blocked "pinned PR-lifecycle owner is missing required path: $required"
  [ -s "$pr_skills_root/$required" ] ||
    blocked "checked-out PR-lifecycle owner is missing required file: $required"
done

claude_bin=$(command -v claude) || blocked "Claude Code CLI is not installed"
case "$claude_bin" in
  /*) ;;
  *) claude_bin=$(CDPATH= cd -- "$(dirname -- "$claude_bin")" && pwd -P)/$(basename -- "$claude_bin") ;;
esac
command -v jq >/dev/null 2>&1 || blocked "jq is required for native Claude install receipt checks"
command -v mktemp >/dev/null 2>&1 || blocked "mktemp is required for isolated Claude config"
command -v env >/dev/null 2>&1 || blocked "env is required to isolate Claude config and credentials"

repo_plugin_name=$(jq -er '.name' "$repo_root/.claude-plugin/plugin.json") ||
  blocked "repository plugin manifest has no valid name"
repo_marketplace=$(jq -er '.name' "$repo_root/.claude-plugin/marketplace.json") ||
  blocked "repository marketplace manifest has no valid name"
owner_plugin_name=$(jq -er '.name' "$pr_skills_root/.claude-plugin/plugin.json") ||
  blocked "pinned PR-lifecycle owner plugin manifest has no valid name"
owner_marketplace=$(jq -er '.name' "$pr_skills_root/.claude-plugin/marketplace.json") ||
  blocked "pinned PR-lifecycle owner marketplace manifest has no valid name"
[ "$repo_plugin_name" = "tailrocks-repository-skills" ] ||
  blocked "unexpected repository plugin name: $repo_plugin_name"
[ "$repo_marketplace" = "tailrocks-repository-skills" ] ||
  blocked "unexpected repository marketplace name: $repo_marketplace"
[ "$owner_plugin_name" = "tailrocks-pull-request-skills" ] ||
  blocked "unexpected pinned PR-lifecycle owner plugin name: $owner_plugin_name"
[ "$owner_marketplace" = "tailrocks-pull-request-skills" ] ||
  blocked "unexpected pinned PR-lifecycle owner marketplace name: $owner_marketplace"
jq -e --arg name "$repo_plugin_name" \
  '.plugins | any(.[]; .name == $name and .source == "./")' \
  "$repo_root/.claude-plugin/marketplace.json" >/dev/null ||
  blocked "repository marketplace does not expose its plugin from the local checkout"
jq -e --arg name "$owner_plugin_name" \
  '.plugins | any(.[]; .name == $name and .source == "./")' \
  "$pr_skills_root/.claude-plugin/marketplace.json" >/dev/null ||
  blocked "pinned PR-lifecycle marketplace does not expose its plugin from the local checkout"

tmp_root=$(CDPATH= cd -- "${TMPDIR:-/tmp}" && pwd -P) ||
  blocked "temporary directory is not accessible"
work=$(mktemp -d "$tmp_root/tailrocks-claude-install.XXXXXX") ||
  blocked "could not create isolated Claude install directory under $tmp_root"
marker="$work/.tailrocks-claude-install-owned"
home_dir="$work/home"
config_dir="$work/config"
tmp_dir="$work/tmp"
xdg_config_dir="$work/xdg-config"

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ "$status" -ne 0 ] || [ "${TAILROCKS_KEEP_CLAUDE_INSTALL_WORK:-0}" = "1" ]; then
    echo "Claude native install artifacts retained: $work" >&2
    exit "$status"
  fi
  if [ -f "$marker" ] &&
    [ "$(sed -n '1p' "$marker")" = "tailrocks-claude-install:$work" ]; then
    case "$work" in
      "$tmp_root"/tailrocks-claude-install.*)
        if ! rm -rf -- "$work"; then
          echo "Claude native install artifacts retained; exact marked temp cleanup failed: $work" >&2
          exit 1
        fi
        ;;
      *)
        echo "Claude native install artifacts retained; path is outside its owned temp prefix: $work" >&2
        exit 1
        ;;
    esac
  else
    echo "Claude native install artifacts retained; ownership marker is missing or mismatched: $work" >&2
    exit 1
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

printf '%s\n' "tailrocks-claude-install:$work" >"$marker"
mkdir -p "$home_dir" "$config_dir" "$tmp_dir" "$xdg_config_dir"
repo_status_before="$work/repo-status.before"
owner_status_before="$work/owner-status.before"
git -C "$repo_root" status --porcelain=v1 --untracked-files=all >"$repo_status_before"
git -C "$pr_skills_root" status --porcelain=v1 --untracked-files=all >"$owner_status_before"

# env -i plus a fresh HOME and CLAUDE_CONFIG_DIR ensures this run cannot read
# host credentials, plugin settings, or marketplaces. No auth is copied.
claude_isolated() {
  (
    cd "$work"
    env -i \
      PATH="${PATH:-/usr/bin:/bin}" \
      HOME="$home_dir" \
      CLAUDE_CONFIG_DIR="$config_dir" \
      XDG_CONFIG_HOME="$xdg_config_dir" \
      TMPDIR="$tmp_dir" \
      LANG=C \
      LC_ALL=C \
      DISABLE_AUTOUPDATER=1 \
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
      "$claude_bin" "$@"
  )
}

if [ -n "$(ls -A "$home_dir")" ] ||
  [ -n "$(ls -A "$config_dir")" ] ||
  [ -n "$(ls -A "$xdg_config_dir")" ]; then
  blocked "fresh isolated Claude HOME/config was not empty before installation"
fi

claude_isolated --version >"$work/claude-version.txt" 2>&1 || {
  echo "BLOCKED: Claude Code CLI failed in isolated HOME/config; no host auth/config was read" >&2
  exit 2
}
claude_isolated plugin validate --strict --json "$repo_root" >"$work/repository-validation.json" 2>&1 || {
  echo "BLOCKED: native Claude validation failed for repository plugin; see retained evidence" >&2
  exit 2
}
claude_isolated plugin validate --strict --json "$pr_skills_root" >"$work/owner-validation.json" 2>&1 || {
  echo "BLOCKED: native Claude validation failed for pinned PR-lifecycle plugin; see retained evidence" >&2
  exit 2
}

repo_plugin_id="$repo_plugin_name@$repo_marketplace"
owner_plugin_id="$owner_plugin_name@$owner_marketplace"
claude_isolated plugin marketplace add "$repo_root" --scope user >"$work/repository-marketplace-add.txt" 2>&1 || {
  echo "BLOCKED: native Claude CLI could not add repository marketplace in isolated user scope" >&2
  exit 2
}
claude_isolated plugin marketplace add "$pr_skills_root" --scope user >"$work/owner-marketplace-add.txt" 2>&1 || {
  echo "BLOCKED: native Claude CLI could not add pinned PR-lifecycle marketplace in isolated user scope" >&2
  exit 2
}
claude_isolated plugin install "$repo_plugin_id" --scope user --yes --json >"$work/repository-install.json" 2>&1 || {
  echo "BLOCKED: native Claude CLI could not install repository plugin in isolated user scope" >&2
  exit 2
}
claude_isolated plugin install "$owner_plugin_id" --scope user --yes --json >"$work/owner-install.json" 2>&1 || {
  echo "BLOCKED: native Claude CLI could not install exact pinned PR-lifecycle owner in isolated user scope" >&2
  exit 2
}

jq -e --arg id "$repo_plugin_id" \
  '.command == "install" and .outcome == "ok" and .scope == "user" and .pluginId == $id' \
  "$work/repository-install.json" >/dev/null ||
  blocked "repository plugin install receipt does not prove the exact plugin ID and isolated user scope"
jq -e --arg id "$owner_plugin_id" \
  '.command == "install" and .outcome == "ok" and .scope == "user" and .pluginId == $id' \
  "$work/owner-install.json" >/dev/null ||
  blocked "PR-lifecycle owner install receipt does not prove the exact plugin ID and isolated user scope"

claude_isolated plugin marketplace list --json >"$work/marketplaces.json" 2>&1 || {
  echo "BLOCKED: native Claude marketplace listing failed in isolated config" >&2
  exit 2
}
marketplace_matches() {
  jq -e --arg name "$1" --arg path "$2" \
    '[.. | objects | select(.name? == $name and .path? == $path)] | length == 1' \
    "$work/marketplaces.json" >/dev/null
}
marketplace_matches "$repo_marketplace" "$repo_root" ||
  blocked "Claude's native marketplace inventory does not bind the repo plugin name to this checkout"
marketplace_matches "$owner_marketplace" "$pr_skills_root" ||
  blocked "Claude's native marketplace inventory does not bind the lifecycle plugin name to the pinned checkout"

# The repositories advertise source './'. Claude loads such plugins in place
# from a local-directory marketplace, so check the installed skill files there.
for required in \
  skills/tailrocks-repository-merge/SKILL.md \
  skills/tailrocks-repository-audit/SKILL.md \
  skills/tailrocks-repository-cleanup/SKILL.md; do
  [ -s "$repo_root/$required" ] || blocked "installed repository plugin skill is unavailable: $required"
done
for required in \
  skills/tailrocks-review-pr/SKILL.md \
  skills/tailrocks-merge-pr/SKILL.md; do
  [ -s "$pr_skills_root/$required" ] || blocked "installed pinned lifecycle skill is unavailable: $required"
done

git -C "$pr_skills_root" status --porcelain=v1 --untracked-files=all >"$work/owner-status.after"
cmp -s "$owner_status_before" "$work/owner-status.after" ||
  blocked "native install changed the PR-lifecycle owner checkout"
git -C "$repo_root" status --porcelain=v1 --untracked-files=all >"$work/repo-status.after"
cmp -s "$repo_status_before" "$work/repo-status.after" ||
  blocked "native install changed the repository checkout"

printf '%s\n' \
  "PASS: Claude native CLI installed $repo_plugin_id in isolated user scope" \
  "PASS: Claude native CLI installed $owner_plugin_id from exact clean checkout $pr_skills_head" \
  "PASS: both native marketplace entries point to the exact local checkout paths" \
  "PASS: required repository-merge/audit/cleanup/review/preflight-merge skill files exist and validate"
claude_version=$(sed -n '1p' "$work/claude-version.txt")
printf 'Claude Code version: %s\n' "$claude_version"
printf 'Claude repo install receipt: '
jq -c . "$work/repository-install.json"
printf 'Claude PR-owner install receipt: '
jq -c . "$work/owner-install.json"
echo "Claude native marketplace inventory verified for repo=$repo_root owner=$pr_skills_root@$pr_skills_head"
echo "INSTALL-ONLY: no host auth/config read or copied; model invocation skipped. Coordinator reported host Claude logged out; this is not Claude exercise evidence."
