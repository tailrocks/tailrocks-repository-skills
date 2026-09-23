#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"
cargo build --quiet --locked --manifest-path helper/Cargo.toml
export TAILROCKS_HELPER_BIN="$repo_root/helper/target/debug/tailrocks-repository-helper"

tests/selector-contract.sh
tests/fixture-landing.sh
tests/recovery-and-resume.sh
if [ "$(printenv TAILROCKS_SKIP_CLIENT_CONTRACT 2>/dev/null || true)" = "1" ]; then
  echo "client contract: SKIP (client binaries/auth are not available in this environment)"
else
  tests/client-contract.sh
fi
