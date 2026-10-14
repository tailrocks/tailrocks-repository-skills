#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
tmp_root=$(CDPATH= cd -- "${TMPDIR:-/tmp}" && pwd -P)
work=$(mktemp -d "$tmp_root/tailrocks-package-contract.XXXXXX")

fail() {
  printf 'package contract: FAIL: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  exit_status=$?
  trap - EXIT HUP INT TERM
  case "$work" in
    "$tmp_root"/tailrocks-package-contract.*)
      rm -rf -- "$work"
      ;;
    *)
      printf 'package contract: refusing to remove unexpected path: %s\n' "$work" >&2
      exit_status=1
      ;;
  esac
  exit "$exit_status"
}
trap cleanup EXIT HUP INT TERM

canonical_path() {
  if command -v realpath >/dev/null 2>&1; then
    realpath -- "$1"
  else
    readlink -f -- "$1"
  fi
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -- "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -- "$1" | awk '{print $1}'
  else
    fail 'no SHA-256 utility is available for the release receipt'
  fi
}

inside_path() {
  case "$1" in
    "$2"|"$2"/*) return 0 ;;
    *) return 1 ;;
  esac
}

assert_no_symlinks() {
  symlink_root=$1
  symlink_label=$2
  symlink=$(find "$symlink_root" -type l -print -quit)
  [ -z "$symlink" ] || fail "$symlink_label contains symlink $symlink; packaged resources must be self-contained"
}

assert_product_paths_no_symlinks() {
  product_root=$1
  for product_path in \
    .claude-plugin \
    .codex-plugin \
    skills \
    docs \
    README.md \
    LICENSE \
    plugin.json \
    catalog.json; do
    [ -e "$product_root/$product_path" ] || continue
    assert_no_symlinks "$product_root/$product_path" "product path $product_path"
  done
  for native_dir in "$product_root"/.*-plugin; do
    [ -d "$native_dir" ] || continue
    assert_no_symlinks "$native_dir" "native plugin path ${native_dir##*/}"
  done
}

assert_inventory() {
  inventory_root=$1
  expected_skills='repo-merge
tailrocks-repository-audit
tailrocks-repository-cleanup'
  [ -d "$inventory_root/skills" ] || fail "package is missing skills/"

  actual_skills=$(find "$inventory_root/skills" -type f -name SKILL.md -print |
    sed "s#^$inventory_root/skills/##; s#/SKILL\.md\$##" | LC_ALL=C sort)
  expected_sorted=$(printf '%s\n' "$expected_skills" | LC_ALL=C sort)
  [ "$actual_skills" = "$expected_sorted" ] ||
    fail "skill inventory differs; expected exactly repo-merge, tailrocks-repository-audit, tailrocks-repository-cleanup (got: $(printf '%s' "$actual_skills" | tr '\n' ' '))"

  [ ! -e "$inventory_root/skills/shared" ] || fail 'skills/shared remains an undeclared shared runtime dependency'
  for skill in $expected_skills; do
    skill_root="$inventory_root/skills/$skill"
    [ -d "$skill_root" ] || fail "missing skill directory: $skill"
    [ -f "$skill_root/SKILL.md" ] || fail "missing skill entrypoint: $skill/SKILL.md"
    [ ! -L "$skill_root/SKILL.md" ] || fail "skill entrypoint is a symlink: $skill/SKILL.md"
    frontmatter=$(awk '
      NR == 1 && $0 == "---" { inside = 1; next }
      inside && $0 == "---" { exit }
      inside { print }
    ' "$skill_root/SKILL.md")
    printf '%s\n' "$frontmatter" | grep -F -q -- "name: $skill" ||
      fail "skill metadata name does not match directory: $skill"
    printf '%s\n' "$frontmatter" | grep -F -q -- 'description:' ||
      fail "skill metadata description is missing: $skill"
    if [ -e "$skill_root/agents/openai.yaml" ]; then
      [ -f "$skill_root/agents/openai.yaml" ] || fail "Codex metadata is not a regular file: $skill/agents/openai.yaml"
      grep -F -q -- 'interface:' "$skill_root/agents/openai.yaml" ||
        fail "Codex metadata interface is missing: $skill"
      grep -F -q -- 'policy:' "$skill_root/agents/openai.yaml" ||
        fail "Codex metadata policy is missing: $skill"
      grep -F -q -- 'allow_implicit_invocation: false' "$skill_root/agents/openai.yaml" ||
        fail "Codex metadata must keep implicit invocation disabled: $skill"
    fi
  done
}

assert_local_links() {
  links_root=$1
  for skill_root in "$links_root"/skills/*; do
    [ -d "$skill_root" ] || continue
    skill_name=${skill_root##*/}
    [ "$skill_name" != shared ] || fail 'skills/shared remains an undeclared shared runtime dependency'

    markdown_files=$(find "$skill_root" -type f -name '*.md' -print)
    while IFS= read -r markdown_file; do
      [ -n "$markdown_file" ] || continue
      link_file="$work/links.$$"
      awk '
        {
          remainder = $0
          while (match(remainder, /\]\([^)]*\)/)) {
            link = substr(remainder, RSTART, RLENGTH)
            sub(/^\]\(/, "", link)
            sub(/\)$/, "", link)
            print link
            remainder = substr(remainder, RSTART + RLENGTH)
          }
        }
      ' "$markdown_file" >"$link_file"
      while IFS= read -r link; do
        link=${link#<}
        link=${link%>}
        link=${link%%#*}
        case "$link" in
          ''|'#'*|'http://'*|'https://'*|'mailto:'*) continue ;;
          /*) fail "absolute bundled-resource link in $markdown_file: $link" ;;
        esac
        link_path=$(dirname -- "$markdown_file")/$link
        [ -e "$link_path" ] || fail "missing bundled resource referenced by $markdown_file: $link"
        resolved_link=$(canonical_path "$link_path") || fail "cannot resolve bundled resource referenced by $markdown_file: $link"
        skill_canonical=$(canonical_path "$skill_root") || fail "cannot resolve skill directory: $skill_root"
        inside_path "$resolved_link" "$skill_canonical" ||
          fail "bundled resource link escapes $skill_name: $link"
      done <"$link_file"
      rm -f -- "$link_file"
    done <<EOF
$markdown_files
EOF
  done
}

assert_forbidden_artifacts() {
  forbidden_root=$1
  for forbidden in \
    AGENTS.md \
    CHANGELOG.md \
    GOAL.md \
    HANDOFF.md \
    PROGRESS.md \
    docs/release.md \
    docs/requirements-to-evidence.md \
    docs/research.md \
    tailrocks-repository-skills-development-goal-v2.md \
    tailrocks-repository-skills-goal-prompt-v2.txt; do
    [ ! -e "$forbidden_root/$forbidden" ] || fail "deleted development artifact remains: $forbidden"
  done

  substitute=$(find "$forbidden_root" -type f \( \
    -name AGENTS.md -o -name CLAUDE.md -o -name GEMINI.md -o -name CODEX.md \
  \) -print -quit)
  [ -z "$substitute" ] || fail "substitute auto-loaded instruction file remains: $substitute"
  evidence_dir=$(find "$forbidden_root" -type d -name skill-evidence -print -quit)
  [ -z "$evidence_dir" ] || fail "development evidence archive remains: $evidence_dir"
}

assert_no_stale_imports() {
  stale_root=$1
  stale='AGENTS\.md|CHANGELOG\.md|GOAL\.md|HANDOFF\.md|PROGRESS\.md|skill-evidence|requirements-to-evidence|docs/release\.md|docs/research\.md|tailrocks-repository-skills-(development-goal|goal-prompt)-v2'
  if rg -n --hidden --glob '!.git/**' --glob '!tests/**' -- "$stale" "$stale_root" >/dev/null 2>&1; then
    fail 'product files still reference deleted development artifacts; tests may name these paths only in test assertions'
  fi
}

assert_manifests() {
  manifest_root=$1
  plugin_name=$(jq -er '.name | select(type == "string" and length > 0)' "$manifest_root/.codex-plugin/plugin.json") ||
    fail 'Codex manifest has no valid name'
  [ "$plugin_name" = tailrocks-repository-skills ] || fail "unexpected plugin name: $plugin_name"
  codex_version=$(jq -er '.version | select(type == "string" and test("^[0-9]+\\.[0-9]+\\.[0-9]+$"))' "$manifest_root/.codex-plugin/plugin.json") ||
    fail 'Codex manifest has no valid semantic version'
  jq -e --arg name "$plugin_name" '
    type == "object" and .name == $name and
    (.description | type == "string" and length > 0) and
    .skills == "./skills/" and (.interface | type == "object")
  ' "$manifest_root/.codex-plugin/plugin.json" >/dev/null || fail 'Codex manifest schema contract failed'

  jq -e --arg name "$plugin_name" --arg version "$codex_version" '
    type == "object" and .name == $name and .version == $version and
    (.description | type == "string" and length > 0)
  ' "$manifest_root/.claude-plugin/plugin.json" >/dev/null || fail 'Claude plugin manifest schema contract failed'
  jq -e --arg name "$plugin_name" --arg version "$codex_version" '
    type == "object" and .name == $name and
    (.plugins | type == "array" and length == 1 and .[0].name == $name and
      .[0].source == "./" and .[0].version == $version)
  ' "$manifest_root/.claude-plugin/marketplace.json" >/dev/null || fail 'Claude marketplace manifest schema contract failed'
  jq -e '
    type == "object" and (.skills | type == "array") and
    (.skills | sort == ["repo-merge", "tailrocks-repository-audit", "tailrocks-repository-cleanup"])
  ' "$manifest_root/catalog.json" >/dev/null || fail 'skill catalog schema/inventory contract failed'

  jq -e --arg name "$plugin_name" '
    type == "object" and .["$schema"] == "https://antigravity.google/schemas/v1/plugin.json" and
    .name == $name and (.description | type == "string" and length > 0) and
    ((keys | sort) == ["$schema", "description", "name"])
  ' "$manifest_root/plugin.json" >/dev/null || fail 'portable Antigravity manifest schema contract failed'

  [ -f "$manifest_root/.muse-plugin/plugin.json" ] || fail 'Muse plugin manifest is missing'
  jq -e --arg name "$plugin_name" --arg version "$codex_version" '
    type == "object" and .schemaVersion == 1 and .name == $name and
    .version == $version and
    (.capabilities.skills | type == "array" and length == 3) and
    ([.capabilities.skills[].id] | sort == ["repo-merge", "tailrocks-repository-audit", "tailrocks-repository-cleanup"]) and
    ([.capabilities.skills[].path] | sort == ["skills/repo-merge/SKILL.md", "skills/tailrocks-repository-audit/SKILL.md", "skills/tailrocks-repository-cleanup/SKILL.md"]) and
    (all(.capabilities.skills[]; (.path | startswith("skills/") and endswith("/SKILL.md"))))
  ' "$manifest_root/.muse-plugin/plugin.json" >/dev/null || fail 'Muse plugin manifest schema/inventory contract failed'
}

assert_root() {
  root_arg=$1
  [ -d "$root_arg" ] || fail "package root is not a directory: $root_arg"
  root_canonical=$(canonical_path "$root_arg") || fail "cannot resolve package root: $root_arg"
  for required_path in README.md LICENSE plugin.json catalog.json .codex-plugin/plugin.json .claude-plugin/plugin.json .claude-plugin/marketplace.json .muse-plugin/plugin.json; do
    [ -f "$root_canonical/$required_path" ] || fail "required package resource is missing: $required_path"
  done
  assert_product_paths_no_symlinks "$root_canonical"
  assert_inventory "$root_canonical"
  assert_local_links "$root_canonical"
  assert_forbidden_artifacts "$root_canonical"
  assert_no_stale_imports "$root_canonical"
  assert_manifests "$root_canonical"
}

assert_root "$repo_root"

artifact="$work/tailrocks-repository-skills.tar"
tar -cf "$artifact" -C "$repo_root" \
  README.md LICENSE plugin.json catalog.json .codex-plugin .claude-plugin skills
for native_dir in "$repo_root"/.*-plugin; do
  [ -d "$native_dir" ] || continue
  case "${native_dir##*/}" in
    .claude-plugin|.codex-plugin) continue ;;
  esac
  tar -rf "$artifact" -C "$repo_root" "${native_dir##*/}"
done
if [ -d "$repo_root/docs" ]; then
  tar -rf "$artifact" -C "$repo_root" docs
fi

tar_paths="$work/tar-paths"
tar -tf "$artifact" >"$tar_paths"
if rg -n '(^|/)(\.git|tests|package\.json|helper|scripts|dist|state|\.DS_Store)(/|$)' "$tar_paths" >/dev/null 2>&1; then
  fail 'installable artifact contains development-only files'
fi
if rg -n '(^|/)skills/shared(/|$)' "$tar_paths" >/dev/null 2>&1; then
  fail 'installable artifact contains skills/shared'
fi

install_root="$work/install"
mkdir -p "$install_root"
tar -xf "$artifact" -C "$install_root"
assert_no_symlinks "$install_root" 'relocated package'
assert_root "$install_root"
case "$install_root" in
  "$repo_root"|"$repo_root"/*) fail 'relocated package still lives inside development checkout' ;;
esac
if rg -n --fixed-strings "$repo_root" "$install_root" >/dev/null 2>&1; then
  fail 'relocated package contains an absolute path into the development checkout'
fi

native_home="$work/native-home"
native_xdg="$work/native-xdg"
native_tmp="$work/native-tmp"
mkdir -p "$native_home" "$native_xdg/claude" "$native_tmp"
native_path="${PATH:-/usr/bin:/bin}"
native_results="$work/native-validator-results"
: >"$native_results"
if muse_bin=$(command -v muse 2>/dev/null); then
  if ! "$muse_bin" plugins validate "$install_root" --json >"$work/muse-validation.json" 2>&1; then
    fail 'Muse native plugin validation failed on the relocated artifact'
  fi
  printf '%s\n' 'Muse: validated relocated artifact' >>"$native_results"
else
  printf '%s\n' 'Muse: not run (CLI unavailable)' >>"$native_results"
fi
if agy_bin=$(command -v agy 2>/dev/null); then
  if ! env -i PATH="$native_path" HOME="$native_home" XDG_CONFIG_HOME="$native_xdg" TMPDIR="$native_tmp" \
    LANG=C LC_ALL=C "$agy_bin" plugin validate "$install_root" >"$work/antigravity-validation.txt" 2>&1; then
    fail 'Antigravity native plugin validation failed on the relocated artifact'
  fi
  printf '%s\n' 'Antigravity: validated relocated artifact' >>"$native_results"
else
  printf '%s\n' 'Antigravity: not run (CLI unavailable)' >>"$native_results"
fi
if claude_bin=$(command -v claude 2>/dev/null); then
  if ! env -i PATH="$native_path" HOME="$native_home" CLAUDE_CONFIG_DIR="$native_xdg/claude" \
    XDG_CONFIG_HOME="$native_xdg" TMPDIR="$native_tmp" LANG=C LC_ALL=C \
    DISABLE_AUTOUPDATER=1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    "$claude_bin" plugin validate --strict --json "$install_root" >"$work/claude-validation.json" 2>&1; then
    fail 'Claude native plugin validation failed on the relocated artifact'
  fi
  printf '%s\n' 'Claude: validated relocated artifact' >>"$native_results"
else
  printf '%s\n' 'Claude: not run (CLI unavailable)' >>"$native_results"
fi
if codex_bin=$(command -v codex 2>/dev/null); then
  codex_home="$work/codex-home"
  mkdir -p "$codex_home"
  if ! CODEX_HOME="$codex_home" "$codex_bin" plugin marketplace add "$install_root" --json >"$work/codex-marketplace.json" 2>&1; then
    fail 'Codex marketplace registration failed on the relocated artifact'
  fi
  codex_marketplace=$(jq -er '.marketplaceName | select(type == "string" and length > 0)' "$work/codex-marketplace.json") ||
    fail 'Codex marketplace registration returned no marketplace name'
  if ! CODEX_HOME="$codex_home" "$codex_bin" plugin add "tailrocks-repository-skills@$codex_marketplace" --json >"$work/codex-install.json" 2>&1; then
    fail 'Codex plugin installation failed on the relocated artifact'
  fi
  codex_installed=$(jq -er '.installedPath | select(type == "string" and length > 0)' "$work/codex-install.json") ||
    fail 'Codex plugin installation returned no installed path'
  [ -d "$codex_installed" ] || fail "Codex installed path is missing: $codex_installed"
  assert_root "$codex_installed"
  assert_no_symlinks "$codex_installed" 'Codex installed plugin'
  if rg -n --fixed-strings "$repo_root" "$codex_installed" >/dev/null 2>&1; then
    fail 'Codex installed plugin contains an absolute path into the development checkout'
  fi
  printf '%s\n' 'Codex: registered and installed relocated artifact' >>"$native_results"
else
  printf '%s\n' 'Codex: not run (CLI unavailable)' >>"$native_results"
fi
if opencode_bin=$(command -v opencode 2>/dev/null); then
  opencode_home="$work/opencode-home"
  opencode_xdg="$work/opencode-xdg"
  mkdir -p "$opencode_home" "$opencode_xdg/config" "$opencode_xdg/data" "$opencode_xdg/cache"
  opencode_config=$(jq -cn --arg skills "$install_root/skills" '
    {skills: {paths: [$skills]}, permission: {skill: {
      "repo-merge": "ask",
      "tailrocks-repository-audit": "ask",
      "tailrocks-repository-cleanup": "ask"
    }}}
  ')
  if ! env -i PATH="$native_path" HOME="$opencode_home" \
    XDG_CONFIG_HOME="$opencode_xdg/config" XDG_DATA_HOME="$opencode_xdg/data" \
    XDG_CACHE_HOME="$opencode_xdg/cache" OPENCODE_CONFIG_CONTENT="$opencode_config" \
    OPENCODE_DISABLE_EXTERNAL_SKILLS=1 OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1 \
    "$opencode_bin" debug skill >"$work/opencode-skills.json" 2>&1; then
    fail 'OpenCode skill discovery failed on the relocated artifact'
  fi
  opencode_skills=$(jq -r --arg root "$install_root/skills" '
    [.[] | select((.location | type == "string") and (.location | startswith($root))) | .name] |
    sort | join("\n")
  ' "$work/opencode-skills.json") || fail 'OpenCode skill discovery returned invalid JSON'
  opencode_expected='repo-merge
tailrocks-repository-audit
tailrocks-repository-cleanup'
  [ "$opencode_skills" = "$opencode_expected" ] ||
    fail "OpenCode discovered unexpected relocated skills: $(printf '%s' "$opencode_skills" | tr '\n' ' ')"
  printf '%s\n' 'OpenCode: discovered all three relocated skills with skills.paths' >>"$native_results"
else
  printf '%s\n' 'OpenCode: not run (CLI unavailable)' >>"$native_results"
fi

if [ -n "${TAILROCKS_PACKAGE_OUTPUT:-}" ]; then
  package_output=$TAILROCKS_PACKAGE_OUTPUT
  package_output_parent=$(dirname -- "$package_output")
  mkdir -p "$package_output_parent"
  cp "$artifact" "$package_output"
  [ -s "$package_output" ] || fail "package artifact was not written: $package_output"
fi
if [ -n "${TAILROCKS_PACKAGE_CHECKSUM_OUTPUT:-}" ]; then
  [ -n "${TAILROCKS_PACKAGE_OUTPUT:-}" ] || fail 'checksum receipt requires TAILROCKS_PACKAGE_OUTPUT'
  package_checksum_output=$TAILROCKS_PACKAGE_CHECKSUM_OUTPUT
  package_checksum_parent=$(dirname -- "$package_checksum_output")
  mkdir -p "$package_checksum_parent"
  package_basename=$(basename -- "$package_output")
  package_digest=$(sha256_file "$package_output")
  printf '%s  %s\n' "$package_digest" "$package_basename" >"$package_checksum_output"
  [ "$(awk -v name="$package_basename" '$2 == name { print $1; exit }' "$package_checksum_output")" = "$package_digest" ] ||
    fail 'SHA-256 receipt does not match the tested package artifact'
  [ "$(sha256_file "$package_output")" = "$package_digest" ] ||
    fail 'package artifact changed after SHA-256 receipt generation'
fi

printf 'package contract: PASS (three skills, manifests, local resources, deleted artifacts, symlinks, and fresh relocation verified)\n'
cat "$native_results"
