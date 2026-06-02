#!/usr/bin/env bash
set -euo pipefail

DAEMON_UNDER_TEST="${SPARK_DAEMON_UNDER_TEST:-${HOME}/.claude/agents/lib/overmind-spark-daemon.sh}"
TMP_ROOT="$(mktemp -d)"

cleanup() {
  rm -rf "${TMP_ROOT}"
}
trap cleanup EXIT

fail() {
  printf 'FAIL %s\n' "$*" >&2
  exit 1
}

pass() {
  printf 'PASS %s\n' "$*"
}

assert_eq() {
  local actual="$1"
  local expected="$2"
  local label="$3"

  [[ "${actual}" == "${expected}" ]] || fail "${label}: expected ${expected}, got ${actual}"
  pass "${label}"
}

assert_contains() {
  local file="$1"
  local needle="$2"
  local label="$3"

  [[ -e "${file}" ]] || fail "${label}: ${file} missing"
  grep -Fq "${needle}" "${file}" || fail "${label}: missing ${needle}"
  pass "${label}"
}

count_lines() {
  local file="$1"

  [[ -e "${file}" ]] || {
    printf '0\n'
    return 0
  }
  wc -l < "${file}" | awk '{ print $1 }'
}

count_notify_calls() {
  [[ -e "${MOCK_NOTIFY_LOG}" ]] || {
    printf '0\n'
    return 0
  }
  grep -c '"name": "spark-daemon"' "${MOCK_NOTIFY_LOG}" || true
}

count_hard_callbacks() {
  local file="$1"

  [[ -e "${file}" ]] || {
    printf '0\n'
    return 0
  }
  grep -cF '[projcore SPARK-DAEMON-HARD]' "${file}" || true
}

count_tmux_nudges() {
  [[ -e "${MOCK_TMUX_SEND_LOG}" ]] || {
    printf '0\n'
    return 0
  }
  grep -cF 'spark-daemon:' "${MOCK_TMUX_SEND_LOG}" || true
}

state_field() {
  local run_key="$1"
  local field="$2"
  local default_value="${3:-}"

  python3 - "${SPARK_DAEMON_STATE_CACHE}" "${run_key}" "${field}" "${default_value}" <<'PY'
import json
import sys

path, run_key, field, default = sys.argv[1:5]
try:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
except Exception:
    print(default)
    raise SystemExit(0)

value = data.get("runs", {}).get(run_key, {}).get(field, default)
print(default if value is None else value)
PY
}

make_mock_commands() {
  local bin_dir="${TMP_ROOT}/bin"
  local tmux_mock="${bin_dir}/tmux"
  local notify_mock="${bin_dir}/mock-notify.sh"
  local overmind_mock="${bin_dir}/mock-overmind.sh"

  mkdir -p "${bin_dir}"

  cat > "${tmux_mock}" <<'SH'
#!/usr/bin/env bash
case "${1:-}" in
  send-keys)
    printf '%s\t%s\n' "${3:-}" "${4:-}" >> "${MOCK_TMUX_SEND_LOG}"
    ;;
  capture-pane)
    ;;
  has-session|new-session|kill-session)
    ;;
esac
exit 0
SH
  chmod +x "${tmux_mock}"

  cat > "${notify_mock}" <<'SH'
#!/usr/bin/env bash
cat >> "${MOCK_NOTIFY_LOG}"
printf '\n' >> "${MOCK_NOTIFY_LOG}"
SH
  chmod +x "${notify_mock}"

  cat > "${overmind_mock}" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${MOCK_STALL_LOG}"
SH
  chmod +x "${overmind_mock}"

  export PATH="${bin_dir}:${PATH}"
  export SPARK_DAEMON_NOTIFY_CMD="${notify_mock}"
  export SPARK_DAEMON_OVERMIND_SH="${overmind_mock}"
}

reset_isolation() {
  : > "${MOCK_NOTIFY_LOG}"
  : > "${MOCK_STALL_LOG}"
  : > "${MOCK_TMUX_SEND_LOG}"
  rm -f "${SPARK_DAEMON_STATE_CACHE}" "${SPARK_DAEMON_DB}" "${SPARK_DAEMON_EVENT_LOG}"
}

make_run_dir() {
  local name="$1"
  local run_dir="${TMP_ROOT}/${name}"

  mkdir -p "${run_dir}/dispatch"
  printf 'initial callbacks\n' > "${run_dir}/callbacks.md"
  printf 'initial progress\n' > "${run_dir}/progress.md"
  printf '%s\n' "${run_dir}"
}

apply_action() {
  local run_id="$1"
  local run_dir="$2"
  local classification="$3"
  local reason="$4"
  local coordinator_session="$5"
  local now_epoch="$6"

  export SPARK_DAEMON_NOW_EPOCH="${now_epoch}"
  spark_apply_classification_action "${run_id}" "${run_dir}" "${classification}" "${reason}" "${coordinator_session}"
}

run_t_remediate_first() {
  local run_id="b6b-remediate-first"
  local run_dir

  reset_isolation
  run_dir="$(make_run_dir "${run_id}")"
  apply_action "${run_id}" "${run_dir}" "CRASHED" "registered child session dead" "coord-remediate" "1000"

  assert_eq "$(count_tmux_nudges)" "1" "T-remediate-first coordinator nudge once"
  assert_contains "${MOCK_TMUX_SEND_LOG}" "coord-remediate	spark-daemon:" "T-remediate-first nudge is prefixed and targeted"
  assert_eq "$(state_field "${run_id}" "remediation_count" "0")" "1" "T-remediate-first remediation_count=1"
  assert_eq "$(count_notify_calls)" "0" "T-remediate-first no notify"
  assert_eq "$(count_lines "${MOCK_STALL_LOG}")" "0" "T-remediate-first no stall-alert"
  assert_eq "$(count_hard_callbacks "${run_dir}/callbacks.md")" "0" "T-remediate-first no JROM callback"
}

run_t_escalate_after_max() {
  local run_id="b6b-escalate-after-max"
  local run_dir

  reset_isolation
  run_dir="$(make_run_dir "${run_id}")"
  apply_action "${run_id}" "${run_dir}" "CRASHED" "implementer pane unchanged" "coord-max" "2000"
  apply_action "${run_id}" "${run_dir}" "CRASHED" "implementer pane unchanged" "coord-max" "2059"
  apply_action "${run_id}" "${run_dir}" "CRASHED" "implementer pane unchanged" "coord-max" "2060"
  apply_action "${run_id}" "${run_dir}" "CRASHED" "implementer pane unchanged" "coord-max" "2061"
  apply_action "${run_id}" "${run_dir}" "CRASHED" "implementer pane unchanged" "coord-max" "2120"
  apply_action "${run_id}" "${run_dir}" "CRASHED" "implementer pane unchanged" "coord-max" "2121"

  assert_eq "$(count_tmux_nudges)" "2" "T-escalate-after-max nudges capped at max"
  assert_eq "$(state_field "${run_id}" "remediation_count" "0")" "2" "T-escalate-after-max remediation_count=max"
  assert_eq "$(count_notify_calls)" "1" "T-escalate-after-max notify exactly once"
  assert_eq "$(count_lines "${MOCK_STALL_LOG}")" "1" "T-escalate-after-max stall-alert exactly once"
  assert_eq "$(count_hard_callbacks "${run_dir}/callbacks.md")" "1" "T-escalate-after-max HARD callback exactly once"
  assert_contains "${run_dir}/callbacks.md" "true blocker: spark tried 2 remediation nudge(s)" "T-escalate-after-max true-blocker message"
}

run_t_recover_resets() {
  local run_id="b6b-recover-resets"
  local run_dir

  reset_isolation
  run_dir="$(make_run_dir "${run_id}")"
  apply_action "${run_id}" "${run_dir}" "CRASHED" "watcher pid dead" "coord-recover" "3000"
  apply_action "${run_id}" "${run_dir}" "HEALTHY" "healthy reset fixture" "coord-recover" "3001"

  assert_eq "$(state_field "${run_id}" "remediation_count" "")" "" "T-recover-resets remediation cleared"
  assert_eq "$(state_field "${run_id}" "last_alert_state" "")" "" "T-recover-resets alert state cleared"

  apply_action "${run_id}" "${run_dir}" "CRASHED" "watcher pid dead again" "coord-recover" "3061"

  assert_eq "$(count_tmux_nudges)" "2" "T-recover-resets later recurrence nudges again"
  assert_eq "$(state_field "${run_id}" "remediation_count" "0")" "1" "T-recover-resets recurrence starts at attempt 1"
  assert_eq "$(count_notify_calls)" "0" "T-recover-resets no notify before max"
  assert_contains "${MOCK_TMUX_SEND_LOG}" "spark-daemon: attempt 1/2" "T-recover-resets recurrence attempt label"
}

run_t_no_escalate_transient() {
  local run_id="b6b-no-escalate-transient"
  local run_dir

  reset_isolation
  run_dir="$(make_run_dir "${run_id}")"
  apply_action "${run_id}" "${run_dir}" "ALERT-SOFT" "transient tier-2 uncertainty" "coord-soft" "4000"
  apply_action "${run_id}" "${run_dir}" "IDLE-CLEAN" "worked-for marker present" "coord-soft" "4060"

  assert_eq "$(count_tmux_nudges)" "0" "T-no-escalate-transient no nudge"
  assert_eq "$(count_notify_calls)" "0" "T-no-escalate-transient no notify"
  assert_eq "$(count_lines "${MOCK_STALL_LOG}")" "0" "T-no-escalate-transient no stall-alert"
  assert_eq "$(count_hard_callbacks "${run_dir}/callbacks.md")" "0" "T-no-escalate-transient no JROM callback"
}

mkdir -p "${TMP_ROOT}/telemetry"
: > "${TMP_ROOT}/notify.log"
: > "${TMP_ROOT}/stall.log"
: > "${TMP_ROOT}/tmux-send.log"

export SPARK_DAEMON_SOURCE_ONLY=1
export SPARK_DAEMON_TELEMETRY_DIR="${TMP_ROOT}/telemetry"
export SPARK_DAEMON_STATE_CACHE="${SPARK_DAEMON_TELEMETRY_DIR}/spark-daemon-state.json"
export SPARK_DAEMON_EVENT_LOG="${SPARK_DAEMON_TELEMETRY_DIR}/spark-daemon-events.log"
export SPARK_DAEMON_DB="${SPARK_DAEMON_TELEMETRY_DIR}/projcore.db"
export SPARK_DAEMON_ALERT_REPEAT_MIN=1
export SPARK_DAEMON_REMEDIATION_MAX=2
export SPARK_DAEMON_SESSION_NAME="spark-daemon-test-b6b-$$"
export MOCK_NOTIFY_LOG="${TMP_ROOT}/notify.log"
export MOCK_STALL_LOG="${TMP_ROOT}/stall.log"
export MOCK_TMUX_SEND_LOG="${TMP_ROOT}/tmux-send.log"

make_mock_commands
source "${DAEMON_UNDER_TEST}"
export SPARK_DAEMON_SOURCE_ONLY=0

run_t_remediate_first
run_t_escalate_after_max
run_t_recover_resets
run_t_no_escalate_transient
