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

count_tier2_calls() {
  [[ -e "${MOCK_TIER2_LOG}" ]] || {
    printf '0\n'
    return 0
  }
  wc -l < "${MOCK_TIER2_LOG}" | awk '{ print $1 }'
}

count_tier1_events() {
  local action="$1"

  [[ -e "${SPARK_DAEMON_EVENT_LOG}" ]] || {
    printf '0\n'
    return 0
  }
  grep -c "\"action\":\"${action}\"" "${SPARK_DAEMON_EVENT_LOG}" || true
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

reset_isolation() {
  : > "${MOCK_TIER2_LOG}"
  rm -f "${SPARK_DAEMON_STATE_CACHE}" "${SPARK_DAEMON_DB}" "${SPARK_DAEMON_EVENT_LOG}" "${SPARK_DAEMON_PID_FILE}"
}

make_run_dir() {
  local name="$1"
  local progress_line="${2:-}"
  local run_dir="${TMP_ROOT}/${name}"

  mkdir -p "${run_dir}/dispatch"
  printf 'initial callbacks\n' > "${run_dir}/callbacks.md"
  if [[ -n "${progress_line}" ]]; then
    printf '%s\n' "${progress_line}" > "${run_dir}/progress.md"
  else
    printf 'no dispatch estimate here\n' > "${run_dir}/progress.md"
  fi
  printf '%s\n' "${run_dir}"
}

drive_tick() {
  local run_id="$1"
  local run_dir="$2"
  local now_epoch="$3"

  export TEST_RUN_ID="${run_id}"
  export TEST_RUN_DIR="${run_dir}"
  export SPARK_DAEMON_NOW_EPOCH="${now_epoch}"
  do_tick >/dev/null
}

run_t_cadence_1_2h() {
  local run_id="b7-cadence-1-2h"
  local run_dir

  reset_isolation
  run_dir="$(make_run_dir "${run_id}" "batch-b7 dispatched_at: 2026-06-02T02:20:51Z estimate_min: 90 bucket: MEDIUM")"
  drive_tick "${run_id}" "${run_dir}" "1000"
  drive_tick "${run_id}" "${run_dir}" "1030"
  drive_tick "${run_id}" "${run_dir}" "1200"
  drive_tick "${run_id}" "${run_dir}" "1479"

  assert_eq "$(count_tier2_calls)" "1" "T-cadence-1-2h one Tier-2 within 8min"
  assert_eq "$(count_tier1_events "tier2-cadence-wait")" "3" "T-cadence-1-2h Tier-1 waits recorded"

  drive_tick "${run_id}" "${run_dir}" "1480"

  assert_eq "$(count_tier2_calls)" "2" "T-cadence-1-2h second Tier-2 after 8min"
  assert_eq "$(state_field "${run_id}" "last_tier2_check_epoch" "0")" "1480" "T-cadence-1-2h cache epoch updated"
}

run_t_cadence_gt2h() {
  local run_id="b7-cadence-gt2h"
  local run_dir

  reset_isolation
  run_dir="$(make_run_dir "${run_id}" "batch-b7 dispatched_at: 2026-06-02T02:20:51Z estimate_min: 180 bucket: LONG")"
  drive_tick "${run_id}" "${run_dir}" "2000"
  drive_tick "${run_id}" "${run_dir}" "2479"
  drive_tick "${run_id}" "${run_dir}" "3619"

  assert_eq "$(count_tier2_calls)" "1" "T-cadence-gt2h one Tier-2 within 27min"
  assert_eq "$(count_tier1_events "tier2-cadence-wait")" "2" "T-cadence-gt2h Tier-1 waits recorded"

  drive_tick "${run_id}" "${run_dir}" "3620"

  assert_eq "$(count_tier2_calls)" "2" "T-cadence-gt2h second Tier-2 after 27min"
  assert_eq "$(state_field "${run_id}" "last_tier2_check_epoch" "0")" "3620" "T-cadence-gt2h cache epoch updated"
}

run_t_sub_1h() {
  local run_id="b7-sub-1h"
  local run_dir

  reset_isolation
  run_dir="$(make_run_dir "${run_id}" "batch-b7 dispatched_at: 2026-06-02T02:20:51Z estimate_min: 25 bucket: SHORT")"
  drive_tick "${run_id}" "${run_dir}" "4000"
  drive_tick "${run_id}" "${run_dir}" "4480"
  drive_tick "${run_id}" "${run_dir}" "6000"

  assert_eq "$(count_tier2_calls)" "0" "T-sub-1h no Tier-2"
  assert_eq "$(count_tier1_events "tier2-skipped-sub1h")" "3" "T-sub-1h Tier-1 skips recorded"
  assert_eq "$(state_field "${run_id}" "last_tier2_check_epoch" "")" "" "T-sub-1h no Tier-2 epoch"
}

run_t_default() {
  local run_id="b7-default"
  local run_dir

  reset_isolation
  run_dir="$(make_run_dir "${run_id}")"
  drive_tick "${run_id}" "${run_dir}" "7000"
  drive_tick "${run_id}" "${run_dir}" "7479"

  assert_eq "$(count_tier2_calls)" "1" "T-default one Tier-2 within default cadence"
  assert_eq "$(count_tier1_events "tier2-cadence-wait")" "1" "T-default Tier-1 wait recorded"

  drive_tick "${run_id}" "${run_dir}" "7480"

  assert_eq "$(count_tier2_calls)" "2" "T-default second Tier-2 after default cadence"
  assert_eq "$(state_field "${run_id}" "last_tier2_check_epoch" "0")" "7480" "T-default cache epoch updated"
}

mkdir -p "${TMP_ROOT}/telemetry"
: > "${TMP_ROOT}/tier2.log"

export SPARK_DAEMON_SOURCE_ONLY=1
export SPARK_DAEMON_TELEMETRY_DIR="${TMP_ROOT}/telemetry"
export SPARK_DAEMON_STATE_CACHE="${SPARK_DAEMON_TELEMETRY_DIR}/spark-daemon-state.json"
export SPARK_DAEMON_EVENT_LOG="${SPARK_DAEMON_TELEMETRY_DIR}/spark-daemon-events.log"
export SPARK_DAEMON_DB="${SPARK_DAEMON_TELEMETRY_DIR}/projcore.db"
export SPARK_DAEMON_PID_FILE="${SPARK_DAEMON_TELEMETRY_DIR}/overmind-spark-daemon.pid"
export SPARK_DAEMON_CADENCE_1_2H_MIN=8
export SPARK_DAEMON_CADENCE_GT2H_MIN=27
export SPARK_DAEMON_CADENCE_DEFAULT_MIN=8
export SPARK_DAEMON_BUDGET_PER_HOUR=100
export MOCK_TIER2_LOG="${TMP_ROOT}/tier2.log"

source "${DAEMON_UNDER_TEST}"
export SPARK_DAEMON_SOURCE_ONLY=0

list_active_runs() {
  printf '%s\t%s\t%s\t%s\n' "${TEST_RUN_ID}" "${TEST_RUN_DIR}" "coord-b7" "session-b7"
}

spark_collect_run_signals() {
  local run_id="$1"

  cat <<EOF
run_key=${run_id}
classification=AMBIGUOUS
reason=ambiguous cadence fixture
EOF
}

spark_run_tier2_verdict() {
  local run_id="$1"
  local run_dir="$2"
  local now_epoch

  now_epoch="$(spark_now_epoch)"
  printf '%s\t%s\t%s\n' "${now_epoch}" "${run_id}" "${run_dir}" >> "${MOCK_TIER2_LOG}"
  printf 'classification=HEALTHY\n'
  printf 'reason=mock tier-2 verdict\n'
}

run_t_cadence_1_2h
run_t_cadence_gt2h
run_t_sub_1h
run_t_default
