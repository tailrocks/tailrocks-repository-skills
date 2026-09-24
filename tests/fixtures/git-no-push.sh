#!/bin/sh
set -eu

for argument do
  if [ "$argument" = "push" ]; then
    printf '%s\n' "$*" >>"$TAILROCKS_GIT_SHIM_LOG"
    echo "fixture git shim blocks every push" >&2
    exit 69
  fi
done

exec "$TAILROCKS_REAL_GIT" "$@"
