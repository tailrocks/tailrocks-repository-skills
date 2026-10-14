#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

tests/selector-contract.sh
tests/lifecycle-contract.sh
tests/manifest-contract.sh
tests/release-version-contract.sh
tests/claude-install-contract.sh
echo "deterministic contracts: PASS (source contracts only; no client or agent result claimed)"
