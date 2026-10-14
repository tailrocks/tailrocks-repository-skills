#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

codex --version >/dev/null
codex exec --help >/dev/null
codex plugin add --help >/dev/null
codex plugin marketplace add --help >/dev/null
claude --version >/dev/null
claude plugin validate --strict --json .claude-plugin/plugin.json >/dev/null
claude plugin validate --strict --json .claude-plugin/marketplace.json >/dev/null

grep -F '/tailrocks-repository-skills:repo-merge' skills/repo-merge/SKILL.md >/dev/null
grep -F '$repo-merge' skills/repo-merge/SKILL.md >/dev/null
grep -F '/goal' skills/repo-merge/SKILL.md >/dev/null
if grep -Eq '^[[:space:]]*/repo-merge([[:space:]]|$)' README.md skills/repo-merge/SKILL.md; then
  echo "advertised bare /repo-merge alias" >&2
  exit 1
fi

client_e2e=$(printenv TAILROCKS_CLIENT_E2E 2>/dev/null || true)
if [ "$client_e2e" = "1" ]; then
  codex exec --sandbox read-only --cd "$repo_root" \
    'Use $repo-merge --audit-only --target-branch=main feature/auth, then report the exact target.' >/dev/null
  claude --plugin-dir "$repo_root" --print --no-session-persistence \
    --permission-mode plan --prompt-suggestions false \
    '/tailrocks-repository-skills:repo-merge --audit-only --target-branch=main feature/auth' >/dev/null
fi

real_agent_e2e=$(printenv TAILROCKS_REAL_AGENT_E2E 2>/dev/null || true)
if [ "$real_agent_e2e" = "1" ]; then
  tests/real-agent-local-only.sh
fi

echo "client contract: PASS"
