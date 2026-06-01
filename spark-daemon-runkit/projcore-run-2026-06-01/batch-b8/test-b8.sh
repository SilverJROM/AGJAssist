#!/usr/bin/env bash
set -euo pipefail

DAEMON_UNDER_TEST="${SPARK_DAEMON_UNDER_TEST:-${HOME}/.claude/agents/lib/overmind-spark-daemon.sh}"
TMP_ROOT="$(mktemp -d)"
SESSIONS=()
WATCHER_PIDS=()

cleanup() {
  local session
  local pid
  for pid in "${WATCHER_PIDS[@]:-}"; do
    kill "${pid}" 2>/dev/null || true
  done
  for session in "${SESSIONS[@]:-}"; do
    tmux kill-session -t "${session}" 2>/dev/null || true
  done
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
  local expected="$1"
  local actual="$2"
  local label="$3"

  [[ "${expected}" == "${actual}" ]] || fail "${label}: expected ${expected}, got ${actual}"
  pass "${label}"
}

assert_file_exists() {
  local file="$1"
  local label="$2"

  [[ -f "${file}" ]] || fail "${label}: missing ${file}"
  pass "${label}"
}

assert_no_spark_callback() {
  local callbacks_file="$1"
  local label="$2"

  if grep -q 'SPARK-DAEMON-' "${callbacks_file}"; then
    cat "${callbacks_file}" >&2
    fail "${label}: unexpected SPARK-DAEMON callback"
  fi
  pass "${label}"
}

json_value() {
  local file="$1"
  local index="$2"
  local field="$3"

  python3 - "${file}" "${index}" "${field}" <<'PY'
import json
import sys

path, index, field = sys.argv[1], int(sys.argv[2]), sys.argv[3]
with open(path, "r", encoding="utf-8") as handle:
    rows = [json.loads(line) for line in handle if line.strip()]
print(rows[index][field])
PY
}

sqlite_value() {
  local db="$1"
  local query="$2"

  python3 - "${db}" "${query}" <<'PY'
import sqlite3
import sys

db_path, query = sys.argv[1:3]
with sqlite3.connect(db_path) as conn:
    row = conn.execute(query).fetchone()
print("" if row is None or row[0] is None else row[0])
PY
}

start_child_session() {
  local session="$1"
  local text="$2"

  tmux new-session -d -s "${session}" "bash --noprofile --norc -c 'printf \"%s\\n\" \"${text}\"; sleep 120'"
  SESSIONS+=("${session}")
  sleep 0.2
}

start_responder_session() {
  local session="$1"

  tmux new-session -d -s "${session}" "bash --noprofile --norc -c 'while IFS= read -r line; do if [[ \"\$line\" == Spark\\ Tier-2* ]]; then echo \"STATUS: SPARK-TICK-DONE ALERT-MEDIUM mock b8 tier2 verdict\"; elif [[ \"\$line\" == /clear ]]; then echo \"mock clear\"; fi; done'"
  SESSIONS+=("${session}")
}

write_registry_cache() {
  local registry_cache="$1"
  local run_id="$2"
  local run_dir="$3"
  local child_session="$4"
  local now_epoch="$5"

  python3 - "${registry_cache}" "${run_id}" "${run_dir}" "${child_session}" "${now_epoch}" <<'PY'
import json
import os
import sys

path, run_id, run_dir, child_session, now_epoch = sys.argv[1:6]
os.makedirs(os.path.dirname(path), exist_ok=True)
payload = {
    "fetched_at": "2026-06-01T00:00:00Z",
    "fetched_at_epoch": int(now_epoch),
    "response": {
        "runs": [{
            "run_id": run_id,
            "run_dir": run_dir,
            "label": "fixture",
            "parent_label": "AGJ",
            "status": "active",
            "children": [{"session": child_session, "role": "implementer"}],
            "dispatch_manifests": [],
        }],
    },
}
with open(path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, sort_keys=True, indent=2)
    handle.write("\n")
PY
}

write_state_cache() {
  local state_cache="$1"
  local run_id="$2"
  local child_session="$3"
  local pane_hash="$4"
  local unchanged_ticks="$5"

  python3 - "${state_cache}" "${run_id}" "${child_session}" "${pane_hash}" "${unchanged_ticks}" <<'PY'
import json
import os
import sys

path, run_id, child_session, pane_hash, unchanged_ticks = sys.argv[1:6]
os.makedirs(os.path.dirname(path), exist_ok=True)
payload = {
    "runs": {
        run_id: {
            "last_pane_hashes": {child_session: pane_hash},
            "last_callbacks_line_count": 1,
            "last_head": "",
            "unchanged_ticks": {child_session: int(unchanged_ticks)},
            "last_classification": "HEALTHY",
            "last_tick": "2026-06-01T00:00:00Z",
        }
    }
}
with open(path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, sort_keys=True, indent=2)
    handle.write("\n")
PY
}

setup_run_dir() {
  local run_dir="$1"
  local watcher_pid

  mkdir -p "${run_dir}/dispatch"
  printf 'progress\n' > "${run_dir}/progress.md"
  printf 'callbacks\n' > "${run_dir}/callbacks.md"
  sleep 120 &
  watcher_pid=$!
  WATCHER_PIDS+=("${watcher_pid}")
  printf '%s\n' "${watcher_pid}" > "${run_dir}/dispatch/.watcher.pid"
}

run_once_fixture() {
  local telemetry_dir="$1"
  local run_id="$2"
  local now_epoch="$3"
  local spark_session="$4"

  SPARK_DAEMON_TELEMETRY_DIR="${telemetry_dir}" \
  SPARK_DAEMON_PID_FILE="${telemetry_dir}/pid" \
  SPARK_DAEMON_STATE_CACHE="${telemetry_dir}/state.json" \
  SPARK_DAEMON_REGISTRY_CACHE="${telemetry_dir}/registry.json" \
  SPARK_DAEMON_REGISTRY_TTL=300 \
  SPARK_DAEMON_DB="${telemetry_dir}/projcore-temp.db" \
  SPARK_DAEMON_EVENT_LOG="${telemetry_dir}/spark-daemon-events.log" \
  SPARK_DAEMON_TICK_TIMEOUT=3 \
  SPARK_DAEMON_SESSION_NAME="${spark_session}" \
  SPARK_DAEMON_PANE_UNCHANGED_TICKS=1 \
  SPARK_DAEMON_BUDGET_PER_HOUR="${SPARK_DAEMON_BUDGET_PER_HOUR:-12}" \
  SPARK_DAEMON_NOW_EPOCH="${now_epoch}" \
  SPARK_DAEMON_NOTIFY_CMD=/bin/true \
  SPARK_DAEMON_OVERMIND_SH="${TMP_ROOT}/missing-overmind.sh" \
  OVERMIND_TOKEN_FILE="${TMP_ROOT}/missing-token.env" \
    "${DAEMON_UNDER_TEST}" --once >"${TMP_ROOT}/${run_id}.out" 2>"${TMP_ROOT}/${run_id}.err"
}

run_t4_healthy_telemetry_test() {
  local telemetry_dir="${TMP_ROOT}/t4-telemetry"
  local run_dir="${TMP_ROOT}/t4-run"
  local run_id="b8-t4"
  local child_session="spark-daemon-test-b8-t4-child-$$"
  local spark_session="spark-daemon-test-b8-t4-spark-$$"
  local now_epoch
  now_epoch="$(date +%s)"

  mkdir -p "${telemetry_dir}"
  setup_run_dir "${run_dir}"
  start_child_session "${child_session}" "fresh pane output"
  write_registry_cache "${telemetry_dir}/registry.json" "${run_id}" "${run_dir}" "${child_session}" "${now_epoch}"

  run_once_fixture "${telemetry_dir}" "${run_id}" "${now_epoch}" "${spark_session}"

  assert_no_spark_callback "${run_dir}/callbacks.md" "T4 HEALTHY does not write callbacks"
  assert_eq "HEALTHY" "$(json_value "${telemetry_dir}/spark-daemon-events.log" 0 classification)" "T4 event log classification"
  assert_eq "1" "$(sqlite_value "${telemetry_dir}/projcore-temp.db" "select count(*) from spark_daemon_ticks where run_id='b8-t4' and tier=1 and classification='HEALTHY' and action='no-op' and spark_used=0")" "T4 SQLite HEALTHY row"
}

run_t7_tier2_telemetry_test() {
  local telemetry_dir="${TMP_ROOT}/t7-telemetry"
  local run_dir="${TMP_ROOT}/t7-run"
  local run_id="b8-t7"
  local child_session="spark-daemon-test-b8-t7-child-$$"
  local spark_session="spark-daemon-test-b8-t7-spark-$$"
  local pane_hash
  local now_epoch
  now_epoch="$(date +%s)"

  mkdir -p "${telemetry_dir}"
  setup_run_dir "${run_dir}"
  start_child_session "${child_session}" "Working (mock tier-1 ambiguous fixture)"
  start_responder_session "${spark_session}"
  pane_hash="$(tmux capture-pane -J -p -t "${child_session}" | sha256sum | awk '{ print $1 }')"
  write_state_cache "${telemetry_dir}/state.json" "${run_id}" "${child_session}" "${pane_hash}" 1
  write_registry_cache "${telemetry_dir}/registry.json" "${run_id}" "${run_dir}" "${child_session}" "${now_epoch}"

  run_once_fixture "${telemetry_dir}" "${run_id}" "${now_epoch}" "${spark_session}"

  assert_eq "2" "$(sqlite_value "${telemetry_dir}/projcore-temp.db" "select tier from spark_daemon_ticks where run_id='b8-t7' and tier=2 and spark_used=1 limit 1")" "T7 SQLite tier-2 row"
  assert_eq "1" "$(sqlite_value "${telemetry_dir}/projcore-temp.db" "select count(*) from spark_daemon_ticks where run_id='b8-t7' and tier=2 and classification='ALERT-MEDIUM' and spark_used=1")" "T7 SQLite spark_used row"
  assert_eq "2" "$(json_value "${telemetry_dir}/spark-daemon-events.log" 1 tier)" "T7 event log tier-2 line"
  assert_eq "1" "$(json_value "${telemetry_dir}/spark-daemon-events.log" 1 spark_used)" "T7 event log spark_used"
}

run_t8_budget_capped_telemetry_test() {
  local telemetry_dir="${TMP_ROOT}/t8-telemetry"
  local run_dir="${TMP_ROOT}/t8-run"
  local run_id="b8-t8"
  local child_session="spark-daemon-test-b8-t8-child-$$"
  local spark_session="spark-daemon-test-b8-t8-spark-$$"
  local pane_hash
  local now_epoch
  now_epoch="$(date +%s)"

  mkdir -p "${telemetry_dir}"
  setup_run_dir "${run_dir}"
  start_child_session "${child_session}" "Working (mock budget capped fixture)"
  start_responder_session "${spark_session}"
  pane_hash="$(tmux capture-pane -J -p -t "${child_session}" | sha256sum | awk '{ print $1 }')"
  write_state_cache "${telemetry_dir}/state.json" "${run_id}" "${child_session}" "${pane_hash}" 1
  write_registry_cache "${telemetry_dir}/registry.json" "${run_id}" "${run_dir}" "${child_session}" "${now_epoch}"

  SPARK_DAEMON_BUDGET_PER_HOUR=1 run_once_fixture "${telemetry_dir}" "${run_id}" "${now_epoch}" "${spark_session}"
  SPARK_DAEMON_BUDGET_PER_HOUR=1 run_once_fixture "${telemetry_dir}" "${run_id}" "${now_epoch}" "${spark_session}"

  assert_eq "1" "$(sqlite_value "${telemetry_dir}/projcore-temp.db" "select count(*) from spark_daemon_ticks where run_id='b8-t8' and tier=1 and classification='AMBIGUOUS' and action='budget-capped' and spark_used=0")" "T8 SQLite budget-capped row"
}

run_rotation_test() {
  local telemetry_dir="${TMP_ROOT}/rotation-telemetry"
  local log_file="${telemetry_dir}/spark-daemon-events.log"
  local db_file="${telemetry_dir}/projcore-temp.db"

  mkdir -p "${telemetry_dir}"
  printf '01234567890123456789\n' > "${log_file}"
  (
    export SPARK_DAEMON_SOURCE_ONLY=1
    export SPARK_DAEMON_TELEMETRY_DIR="${telemetry_dir}"
    export SPARK_DAEMON_EVENT_LOG="${log_file}"
    export SPARK_DAEMON_EVENT_LOG_MAX_BYTES=10
    export SPARK_DAEMON_DB="${db_file}"
    export SPARK_DAEMON_NOW_EPOCH=363000
    source "${DAEMON_UNDER_TEST}"
    spark_record_tick "b8-rotation" "1" "HEALTHY" "no-op" "0" "rotation test"
  )

  assert_file_exists "${log_file}.1" "rotation moved oversized log to .1"
  assert_eq "b8-rotation" "$(json_value "${log_file}" 0 run_id)" "rotation fresh log contains new event"
  assert_eq "1" "$(sqlite_value "${db_file}" "select count(*) from spark_daemon_ticks where run_id='b8-rotation'")" "rotation helper also wrote SQLite"
}

command -v tmux >/dev/null 2>&1 || fail "tmux is required for B8 tests"
bash -n "${DAEMON_UNDER_TEST}"
pass "daemon bash -n clean"
run_t4_healthy_telemetry_test
run_t7_tier2_telemetry_test
run_t8_budget_capped_telemetry_test
run_rotation_test
