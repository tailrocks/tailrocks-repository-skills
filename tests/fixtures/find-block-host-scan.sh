#!/bin/sh
set -eu

if [ "${TAILROCKS_BLOCK_FIND:-0}" = "1" ]; then
  scanner=${0##*/}
  printf '%s %s\n' "$scanner" "$*" >>"$TAILROCKS_FIND_SHIM_LOG"
  echo "fixture scanner shim blocks host-discovery calls: $scanner" >&2
  exit 69
fi

scanner=${0##*/}
case "$scanner" in
  find) real_scanner=${TAILROCKS_REAL_FIND:-} ;;
  rg) real_scanner=${TAILROCKS_REAL_RG:-} ;;
  fd|fdfind) real_scanner=${TAILROCKS_REAL_FD:-} ;;
  locate) real_scanner=${TAILROCKS_REAL_LOCATE:-} ;;
  mdfind) real_scanner=${TAILROCKS_REAL_MDFIND:-} ;;
  *) echo "unknown scanner shim: $scanner" >&2; exit 127 ;;
esac
[ -n "$real_scanner" ] || { echo "scanner unavailable: $scanner" >&2; exit 127; }
exec "$real_scanner" "$@"
