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

count_file_lines() {
  local file="$1"

  [[ -e "${file}" ]] || {
    printf '0\n'
    return 0
  }
  wc -l < "${file}" | awk '{ print $1 }'
}

count_hard_callbacks() {
  local file="$1"

  [[ -e "${file}" ]] || {
    printf '0\n'
    return 0
  }
  grep -cF '[projcore SPARK-DAEMON-HARD]' "${file}" || true
}

count_notify_calls() {
  [[ -e "${MOCK_NOTIFY_LOG}" ]] || {
    printf '0\n'
    return 0
  }
  grep -c '"name": "spark-daemon"' "${MOCK_NOTIFY_LOG}" || true
}

count_event_rows_for_run() {
  local run_key="$1"

  [[ -e "${SPARK_DAEMON_EVENT_LOG}" ]] || {
    printf '0\n'
    return 0
  }
  grep -c "\"run_id\":\"${run_key}\"" "${SPARK_DAEMON_EVENT_LOG}" || true
}

make_mock_commands() {
  local notify_mock="${TMP_ROOT}/mock-notify.sh"
  local overmind_mock="${TMP_ROOT}/mock-overmind.sh"

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

  export SPARK_DAEMON_NOTIFY_CMD="${notify_mock}"
  export SPARK_DAEMON_OVERMIND_SH="${overmind_mock}"
}

make_run_dir() {
  local name="$1"
  local run_dir="${TMP_ROOT}/${name}"

  mkdir -p "${run_dir}/dispatch"
  printf 'initial callbacks\n' > "${run_dir}/callbacks.md"
  printf 'initial progress\n' > "${run_dir}/progress.md"
  printf '%s\n' "${run_dir}"
}

drive_crashed_tick() {
  local run_id="$1"
  local run_dir="$2"
  local now_epoch="$3"

  export SPARK_DAEMON_NOW_EPOCH="${now_epoch}"
  spark_collect_run_signals "${run_id}" "${run_dir}" "missing-session-${run_id}" >/dev/null
}

drive_healthy_transition() {
  local run_id="$1"
  local run_dir="$2"
  local now_epoch="$3"

  export SPARK_DAEMON_NOW_EPOCH="${now_epoch}"
  spark_apply_classification_action "${run_id}" "${run_dir}" "HEALTHY" "healthy reset fixture"
  spark_record_tick "${run_id}" "1" "HEALTHY" "no-op" "0" "healthy reset fixture"
}

run_t_dedup() {
  local run_id="b6a-dedup"
  local run_dir
  local i

  run_dir="$(make_run_dir "${run_id}")"
  for i in 0 1 2 3 4; do
    drive_crashed_tick "${run_id}" "${run_dir}" "$((1000 + i))"
  done

  assert_eq "$(count_notify_calls)" "1" "T-dedup notify once for five CRASHED ticks"
  assert_eq "$(count_file_lines "${MOCK_STALL_LOG}")" "1" "T-dedup stall-alert once for five CRASHED ticks"
  assert_eq "$(count_hard_callbacks "${run_dir}/callbacks.md")" "1" "T-dedup HARD callback once"
  assert_eq "$(count_event_rows_for_run "${run_id}")" "5" "T-dedup telemetry row per tick"
}

run_t_repeat() {
  local run_id="b6a-repeat"
  local run_dir

  : > "${MOCK_NOTIFY_LOG}"
  : > "${MOCK_STALL_LOG}"
  : > "${SPARK_DAEMON_EVENT_LOG}"
  rm -f "${SPARK_DAEMON_STATE_CACHE}" "${SPARK_DAEMON_DB}"

  run_dir="$(make_run_dir "${run_id}")"
  drive_crashed_tick "${run_id}" "${run_dir}" "2000"
  drive_crashed_tick "${run_id}" "${run_dir}" "2050"
  drive_crashed_tick "${run_id}" "${run_dir}" "2060"
  drive_crashed_tick "${run_id}" "${run_dir}" "2061"

  assert_eq "$(count_notify_calls)" "2" "T-repeat notify once after repeat window"
  assert_eq "$(count_file_lines "${MOCK_STALL_LOG}")" "2" "T-repeat stall-alert once after repeat window"
  assert_eq "$(count_hard_callbacks "${run_dir}/callbacks.md")" "2" "T-repeat HARD callback once after repeat window"
  assert_eq "$(count_event_rows_for_run "${run_id}")" "4" "T-repeat telemetry row per tick"
}

run_t_recover() {
  local run_id="b6a-recover"
  local run_dir

  : > "${MOCK_NOTIFY_LOG}"
  : > "${MOCK_STALL_LOG}"
  : > "${SPARK_DAEMON_EVENT_LOG}"
  rm -f "${SPARK_DAEMON_STATE_CACHE}" "${SPARK_DAEMON_DB}"

  run_dir="$(make_run_dir "${run_id}")"
  drive_crashed_tick "${run_id}" "${run_dir}" "3000"
  drive_healthy_transition "${run_id}" "${run_dir}" "3001"
  drive_crashed_tick "${run_id}" "${run_dir}" "3002"

  assert_eq "$(count_notify_calls)" "2" "T-recover notify fires again after HEALTHY reset"
  assert_eq "$(count_file_lines "${MOCK_STALL_LOG}")" "2" "T-recover stall-alert fires again after HEALTHY reset"
  assert_eq "$(count_hard_callbacks "${run_dir}/callbacks.md")" "2" "T-recover HARD callback fires again"
  assert_eq "$(count_event_rows_for_run "${run_id}")" "3" "T-recover telemetry row per tick"
}

mkdir -p "${TMP_ROOT}/telemetry"
: > "${TMP_ROOT}/notify.log"
: > "${TMP_ROOT}/stall.log"

export SPARK_DAEMON_SOURCE_ONLY=1
export SPARK_DAEMON_TELEMETRY_DIR="${TMP_ROOT}/telemetry"
export SPARK_DAEMON_STATE_CACHE="${SPARK_DAEMON_TELEMETRY_DIR}/spark-daemon-state.json"
export SPARK_DAEMON_EVENT_LOG="${SPARK_DAEMON_TELEMETRY_DIR}/spark-daemon-events.log"
export SPARK_DAEMON_DB="${SPARK_DAEMON_TELEMETRY_DIR}/projcore.db"
export SPARK_DAEMON_ALERT_REPEAT_MIN=1
export SPARK_DAEMON_SESSION_NAME="spark-daemon-test-b6a-$$"
export MOCK_NOTIFY_LOG="${TMP_ROOT}/notify.log"
export MOCK_STALL_LOG="${TMP_ROOT}/stall.log"

make_mock_commands
source "${DAEMON_UNDER_TEST}"
export SPARK_DAEMON_SOURCE_ONLY=0

run_t_dedup
run_t_repeat
run_t_recover
