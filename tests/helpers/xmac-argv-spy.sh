#!/usr/bin/env bash
# PATH shim for the xmac gateway. Install this file as `xmac.sh` ahead of the real
# gateway on PATH. It records every argv it is invoked with, then optionally execs
# the real binary. Recording is the sink; callers read the log back.
# Line format: <UTC>\t<arg1>\t<arg2>...
# $XMAC_ARGV_SPY_LOG  — required sink path
# $XMAC_ARGV_SPY_REAL — when set, exec this absolute gateway with the same argv
set -u
log=${XMAC_ARGV_SPY_LOG:?XMAC_ARGV_SPY_LOG is required}
ts=$(date -u +%FT%TZ)
{
  printf '%s' "$ts"
  for arg in "$@"; do
    printf '\t%s' "$arg"
  done
  printf '\n'
} >> "$log"
if [ -n "${XMAC_ARGV_SPY_REAL:-}" ]; then
  exec "$XMAC_ARGV_SPY_REAL" "$@"
fi
exit 0
