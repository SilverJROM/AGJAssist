#!/usr/bin/env bash
# A13 gateway spy. Drives `xmac down hdd --owner-off` through temp fixtures.
# Expected counts and injected ssh rcs are literals in this file.
set -euo pipefail

XMAC_SH="${XMAC_SH:-$HOME/.config/agent-protocols/lib/xmac.sh}"
[ -x "$XMAC_SH" ] || { echo "FAIL: gateway not found at $XMAC_SH"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

LEASE_NAME="xmac-claim-hdd-17-transcript-archive"
BUSY_LITERAL="rsync -a /vault /backup"
STATE="$TMP/state"
SPY_LOG="$TMP/spy.log"

mkdir -p "$TMP/bin" "$STATE"
printf '%s\n' 'hdd|192.0.2.169|aa:bb:cc:dd:ee:ff|agjrom|store|pgrep -f rsync' > "$TMP/machines.conf"

cat > "$TMP/bin/ssh" <<EOF
#!/usr/bin/env bash
set -u
LOG="$SPY_LOG"
SCEN="$TMP/scenario"
printf '%s\n' "\$(printf '%q ' "\$@")" >> "\$LOG"
remote="\${*: -1}"
# shellcheck disable=SC1090
. "\$SCEN"
case "\$remote" in
  *poweroff*)
    exit "\${POWEROFF_RC:-0}"
    ;;
  true)
    exit 0
    ;;
esac
if [ "\${LEASE_ON_BUSY:-0}" = "1" ]; then
  mkdir -p "\${XMAC_STATE:?}/leases/hdd"
  : > "\${XMAC_STATE}/leases/hdd/$LEASE_NAME"
fi
if [ -n "\${BUSY_STDOUT_FILE:-}" ]; then
  cat "\$BUSY_STDOUT_FILE"
fi
exit "\${BUSY_RC:?}"
EOF

cat > "$TMP/bin/ping" <<EOF
#!/usr/bin/env bash
set -u
LOG="$SPY_LOG"
SCEN="$TMP/scenario"
printf '%s\n' "\$(printf '%q ' "\$@")" >> "\$LOG"
# shellcheck disable=SC1090
. "\$SCEN"
if grep -q 'poweroff' "\$LOG"; then
  exit "\${PING_RC_DOWN:-1}"
fi
exit "\${PING_RC_UP:-0}"
EOF

cat > "$TMP/bin/wakeonlan" <<EOF
#!/usr/bin/env bash
set -u
LOG="$SPY_LOG"
SCEN="$TMP/scenario"
printf '%s\n' "\$(printf '%q ' "\$@")" >> "\$LOG"
# shellcheck disable=SC1090
. "\$SCEN"
exit "\${WAKE_RC:-0}"
EOF
chmod +x "$TMP/bin/ssh" "$TMP/bin/ping" "$TMP/bin/wakeonlan"

export PATH="$TMP/bin:$PATH"
export XMAC_CONF="$TMP/machines.conf"
export XMAC_STATE="$STATE"
export XMAC_DOWN_TIMEOUT=6
export XMAC_CALLER="a13-gateway-spy"

fails=0
xrc=0
poff=0
fcnt=0
pgrep_n=0

fail() { echo "FAIL $*"; fails=$((fails + 1)); }
pass() { echo "PASS $*"; }

reset_state() {
  : > "$SPY_LOG"
  rm -rf "$STATE"
  mkdir -p "$STATE"
}

write_scenario() {
  local busy_rc="$1"
  local lease_on_busy="$2"
  local stdout_literal="${3:-}"
  local stdout_path=""
  if [ -n "$stdout_literal" ]; then
    stdout_path="$TMP/busy-stdout"
    printf '%s\n' "$stdout_literal" > "$stdout_path"
  else
    rm -f "$TMP/busy-stdout"
  fi
  cat > "$TMP/scenario" <<EOF
BUSY_RC=${busy_rc}
LEASE_ON_BUSY=${lease_on_busy}
BUSY_STDOUT_FILE=${stdout_path}
POWEROFF_RC=0
PING_RC_UP=0
PING_RC_DOWN=1
WAKE_RC=0
EOF
}

run_down() {
  local how="$1"
  set +e
  if [ "$how" = "plain" ]; then
    bash "$XMAC_SH" down hdd >"$TMP/stdout" 2>"$TMP/stderr"
  else
    bash "$XMAC_SH" down hdd --owner-off >"$TMP/stdout" 2>"$TMP/stderr"
  fi
  xrc=$?
  set -e
  poff="$(grep -c 'poweroff' "$SPY_LOG" || true)"
  fcnt="$(grep -c -- '--force' "$SPY_LOG" || true)"
  pgrep_n="$(grep -c 'pgrep' "$SPY_LOG" || true)"
}

assert_no_force() {
  local name="$1"
  if [ "$fcnt" -ne 0 ]; then
    fail "$name --force argv count=$fcnt expected 0"
  fi
  if grep -i -F -q -- 'pass --force' "$TMP/stderr"; then
    fail "$name stderr contains pass --force"
  fi
  if [ -f "$STATE/xmac.log" ] && grep -F -q 'force=1' "$STATE/xmac.log"; then
    fail "$name xmac.log contains force=1"
  fi
}

assert_refuse() {
  local name="$1"
  local before="$fails"
  if [ "$xrc" -eq 0 ]; then
    fail "$name xmac exit 0 expected nonzero"
  fi
  if [ "$poff" -ne 0 ]; then
    fail "$name poweroff count=$poff expected 0"
  fi
  assert_no_force "$name"
  if [ "$fails" -eq "$before" ]; then
    pass "$name exit=$xrc poweroff=0 force_argv=0"
  fi
}

assert_poweroff() {
  local name="$1"
  local before="$fails"
  if [ "$poff" -lt 1 ]; then
    fail "$name poweroff count=$poff expected >= 1"
  fi
  if [ "$xrc" -ne 0 ]; then
    fail "$name xmac exit=$xrc expected 0"
  fi
  assert_no_force "$name"
  if [ ! -f "$STATE/xmac.log" ] || ! grep -F -q 'owner-off' "$STATE/xmac.log"; then
    fail "$name xmac.log missing owner-off"
  fi
  if [ "$fails" -eq "$before" ]; then
    pass "$name exit=$xrc poweroff=$poff owner-off-logged"
  fi
}

# L1b / L1c / L1d — empty stdout, only the busy-probe rc changes.
# L1-control — same empty stdout, rc 0, must reach poweroff.
for spec in "L1b:124" "L1c:1" "L1d:255"; do
  name="${spec%%:*}"
  rc_lit="${spec##*:}"
  reset_state
  write_scenario "$rc_lit" 0
  run_down owner-off
  if [ "$pgrep_n" -lt 1 ]; then
    fail "$name busy probe missing from spy log injected_rc=$rc_lit"
  fi
  assert_refuse "$name injected_rc=$rc_lit"
done

reset_state
write_scenario 0 0
run_down owner-off
if [ "$pgrep_n" -lt 1 ]; then
  fail "L1-control busy probe missing injected_rc=0"
fi
assert_poweroff "L1-control injected_rc=0"

# L2b re-read: lease appears only as a side effect of the busy probe.
reset_state
write_scenario 0 1
run_down owner-off
if [ "$pgrep_n" -lt 1 ]; then
  fail "L2b-late-lease busy probe missing"
fi
if ! grep -F -q "$LEASE_NAME" "$TMP/stderr"; then
  fail "L2b-late-lease stderr does not name $LEASE_NAME"
fi
if ! grep -F -q 'after busy check' "$TMP/stderr"; then
  fail "L2b-late-lease stderr missing re-read text"
fi
assert_refuse "L2b-late-lease"

# L2b guard-1: lease already present, busy probe must not run.
reset_state
write_scenario 0 0
mkdir -p "$STATE/leases/hdd"
: > "$STATE/leases/hdd/$LEASE_NAME"
run_down owner-off
if [ "$pgrep_n" -ne 0 ]; then
  fail "already-leased busy probe ran pgrep=$pgrep_n expected 0"
fi
if ! grep -F -q "$LEASE_NAME" "$TMP/stderr"; then
  fail "already-leased stderr does not name $LEASE_NAME"
fi
if grep -F -q 'after busy check' "$TMP/stderr"; then
  fail "already-leased used the re-read refusal"
fi
assert_refuse "already-leased"

# L2b negative control: identical run, spy does not create a lease.
reset_state
write_scenario 0 0
run_down owner-off
assert_poweroff "L2b-negative"

# L2a: woke file absent. Owner-off reaches poweroff. Plain down does not.
reset_state
if [ -e "$STATE/woke-by-xmac/hdd" ]; then
  fail "L2a precondition woke file present"
fi
write_scenario 0 0
run_down owner-off
assert_poweroff "L2a"

reset_state
write_scenario 0 0
run_down plain
before="$fails"
if [ "$xrc" -eq 0 ]; then
  fail "L2a-default-down xmac exit 0 expected nonzero"
fi
if [ "$poff" -ne 0 ]; then
  fail "L2a-default-down poweroff count=$poff expected 0"
fi
if ! grep -F -q 'was not started by xmac' "$TMP/stderr"; then
  fail "L2a-default-down stderr missing guard-3 text"
fi
if ! grep -F -q 'Pass --force' "$TMP/stderr"; then
  fail "L2a-default-down stderr missing Pass --force hint"
fi
if [ "$fails" -eq "$before" ]; then
  pass "L2a-default-down exit=$xrc poweroff=0 guard-3-refused"
fi

# L2c: busy probe rc 0, non-empty stdout.
reset_state
write_scenario 0 0 "$BUSY_LITERAL"
run_down owner-off
if [ "$pgrep_n" -lt 1 ]; then
  fail "L2c busy probe missing"
fi
if ! grep -F -q "$BUSY_LITERAL" "$TMP/stderr"; then
  fail "L2c stderr missing literal $BUSY_LITERAL"
fi
assert_refuse "L2c"

if [ "$fails" -ne 0 ]; then
  echo "RESULT fails=$fails"
  exit 1
fi
echo "RESULT fails=0"
exit 0
