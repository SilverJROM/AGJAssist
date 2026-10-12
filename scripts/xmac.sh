#!/usr/bin/env bash
# Read-only stand-in for the lost xmac.sh: only `status [name]`, answered from the
# poller's ~/.xmac/xm-status.txt (scripts/xmac-poller.mjs). No power actions.
set -euo pipefail
f="${XMAC_DIR:-$HOME/.xmac}/xm-status.txt"
[ "${1:-}" = "status" ] || { echo "xmac.sh: only 'status [name]' is supported here" >&2; exit 2; }
[ -f "$f" ] || exit 1
if [ -n "${2:-}" ]; then awk -v n="$2" '$1==n' "$f"; else cat "$f"; fi
