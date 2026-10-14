#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
selector_doc="$repo_root/skills/shared/selector-contract.md"
facade="$repo_root/skills/repo-merge/SKILL.md"

require_text() {
  file=$1
  text=$2
  if ! grep -F -q -- "$text" "$file"; then
    echo "selector contract missing from $file: $text" >&2
    exit 1
  fi
}

require_text "$selector_doc" 'Treat the complete argument string'
require_text "$selector_doc" '#N'
require_text "$selector_doc" 'branch:NAME'
require_text "$selector_doc" '/OWNER/REPOSITORY/pulls'
require_text "$selector_doc" '/OWNER/REPOSITORY/branches/all'
require_text "$selector_doc" 'fetch every result page'
require_text "$selector_doc" 'preserving every raw selector spelling'
require_text "$selector_doc" 'select exactly the branch `main`'
require_text "$selector_doc" 'Never substitute current HEAD'
require_text "$selector_doc" 'Empty input is a usage error'
require_text "$selector_doc" '`--all-work` is the explicit whole-repository scope'
require_text "$selector_doc" 'This mode alone authorizes broad local discovery'
require_text "$selector_doc" "current user's canonical home path"
require_text "$selector_doc" 'worktree-to-common-dir identity'
require_text "$selector_doc" 'linked, detached, and relocated worktrees'
require_text "$selector_doc" 'untracked paths, ignored paths that may hold user work'
require_text "$selector_doc" 'Never stop or signal a writer'
require_text "$selector_doc" 'page counts/cursors, API permission scope'
require_text "$selector_doc" 'initial discovered-copy/source membership'
require_text "$selector_doc" 'it must not snapshot-copy user data'
require_text "$selector_doc" "later additions separately; they do not join this run's cleanup authority"
require_text "$facade" 'Preserve literal `#`, quoting,'
require_text "$facade" 'Fully paginate `/pulls`'
require_text "$facade" 'For targeted requests inspect only those sources and strictly necessary'
require_text "$facade" 'Only for explicit `--all-work`'
require_text "$facade" 'and frozen membership in the single handoff.'
require_text "$facade" 'never interrupt a writer'
require_text "$repo_root/skills/shared/recovery.md" 'In `--audit-only`,'
require_text "$repo_root/skills/shared/recovery.md" 'original clone, worktree, ref, index, and file exactly as observed'
require_text "$repo_root/skills/shared/recovery.md" 'actual restore test for all unique data'

echo "selector/all-work source contract: PASS (inventory, scope, recovery, and pagination behavior still require installed-agent evidence)"
