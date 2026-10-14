#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
plugin_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
# Hosts with a read-only plugin cache may supply a prebuilt helper.
if [ -n "${TAILROCKS_HELPER_BIN:-}" ]; then
  test -x "$TAILROCKS_HELPER_BIN"
  exec "$TAILROCKS_HELPER_BIN" "$@"
fi
state_root=${TAILROCKS_REPOSITORY_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/tailrocks-repository-skills}
target_dir="$state_root/toolchain-target"

mkdir -p "$target_dir"
exec env CARGO_TARGET_DIR="$target_dir" cargo run --quiet --locked --manifest-path "$plugin_root/helper/Cargo.toml" -- "$@"
