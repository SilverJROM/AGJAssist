#!/usr/bin/env bash
set -euo pipefail

DAEMON_UNDER_TEST="${SPARK_DAEMON_UNDER_TEST:-${HOME}/.claude/agents/lib/overmind-spark-daemon.sh}"
OVERMIND_UNDER_TEST="${OVERMIND_UNDER_TEST:-${HOME}/.claude/agents/lib/overmind.sh}"
WATCHER_UNDER_TEST="${WATCHER_UNDER_TEST:-${HOME}/.claude/agents/watchers/projcore-watcher.sh}"
TMP_ROOT="$(mktemp -d)"
SESSIONS_FILE="${TMP_ROOT}/tmux-sessions.txt"
PIDS_FILE="${TMP_ROOT}/pids.txt"
RESULTS_FILE="${TMP_ROOT}/results.txt"

: > "${SESSIONS_FILE}"
: > "${PIDS_FILE}"
: > "${RESULTS_FILE}"

cleanup() {
  local session pid
  if [[ -f "${PIDS_FILE}" ]]; then
    while IFS= read -r pid; do
      [[ -n "${pid}" ]] || continue
      kill "${pid}" 2>/dev/null || true
    done < "${PIDS_FILE}"
  fi
  if [[ -f "${SESSIONS_FILE}" ]]; then
    while IFS= read -r session; do
      [[ -n "${session}" ]] || continue
      tmux kill-session -t "${session}" 2>/dev/null || true
    done < "${SESSIONS_FILE}"
  fi
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

track_pid() {
  printf '%s\n' "$1" >> "${PIDS_FILE}"
}

track_session() {
  printf '%s\n' "$1" >> "${SESSIONS_FILE}"
}

assert_eq() {
  local expected="$1"
  local actual="$2"
  local label="$3"

  [[ "${expected}" == "${actual}" ]] || fail "${label}: expected ${expected}, got ${actual}"
  pass "${label}"
}

assert_contains_file() {
  local file="$1"
  local pattern="$2"
  local label="$3"

  if ! grep -Eq -- "${pattern}" "${file}"; then
    printf '%s\n' "--- ${file} ---" >&2
    [[ -f "${file}" ]] && cat "${file}" >&2
    fail "${label}: missing pattern ${pattern}"
  fi
  pass "${label}"
}

assert_not_contains_file() {
  local file="$1"
  local pattern="$2"
  local label="$3"

  if [[ -f "${file}" ]] && grep -Eq -- "${pattern}" "${file}"; then
    printf '%s\n' "--- ${file} ---" >&2
    cat "${file}" >&2
    fail "${label}: unexpected pattern ${pattern}"
  fi
  pass "${label}"
}

wait_for_file() {
  local file="$1"
  local timeout_sec="$2"
  local start

  start="$(date +%s)"
  while [[ ! -s "${file}" ]]; do
    if (( $(date +%s) - start >= timeout_sec )); then
      return 1
    fi
    sleep 0.1
  done
}

wait_for_pid_file_alive() {
  local pid_file="$1"
  local timeout_sec="$2"
  local start pid

  start="$(date +%s)"
  while true; do
    if [[ -s "${pid_file}" ]]; then
      pid="$(awk -F= '$1 == "pid" { print $2; exit }' "${pid_file}" 2>/dev/null || true)"
      if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
        printf '%s\n' "${pid}"
        return 0
      fi
    fi
    if (( $(date +%s) - start >= timeout_sec )); then
      return 1
    fi
    sleep 0.1
  done
}

json_line_value() {
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
children = []
if child_session:
    children.append({"session": child_session, "role": "implementer"})
payload = {
    "fetched_at": "2026-06-01T00:00:00Z",
    "fetched_at_epoch": int(now_epoch),
    "response": {
        "runs": [{
            "run_id": run_id,
            "run_dir": run_dir,
            "label": "fixture",
            "parent_label": "AGJ",
            "parent_session": "AGJ-51",
            "status": "active",
            "children": children,
            "dispatch_manifests": [],
        }],
    },
}
with open(path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle, sort_keys=True, indent=2)
    handle.write("\n")
PY
}

write_empty_registry_cache() {
  local registry_cache="$1"
  local now_epoch="$2"

  python3 - "${registry_cache}" "${now_epoch}" <<'PY'
import json
import os
import sys

path, now_epoch = sys.argv[1:3]
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w", encoding="utf-8") as handle:
    json.dump({
        "fetched_at": "2026-06-01T00:00:00Z",
        "fetched_at_epoch": int(now_epoch),
        "response": {"runs": []},
    }, handle, sort_keys=True, indent=2)
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
  sleep 300 &
  watcher_pid=$!
  track_pid "${watcher_pid}"
  printf '%s\n' "${watcher_pid}" > "${run_dir}/dispatch/.watcher.pid"
}

start_child_session() {
  local session="$1"
  local text="$2"

  tmux new-session -d -s "${session}" "bash --noprofile --norc -c 'printf \"%s\\n\" \"${text}\"; sleep 300'"
  track_session "${session}"
  sleep 0.2
}

start_responder_session() {
  local session="$1"
  local count_file="$2"

  tmux new-session -d -s "${session}" "bash --noprofile --norc -c 'while IFS= read -r line; do if [[ \"\$line\" == Spark\\ Tier-2* ]]; then printf \"dispatch\\n\" >> \"${count_file}\"; echo \"STATUS: SPARK-TICK-DONE ALERT-MEDIUM mock tier2 verdict\"; elif [[ \"\$line\" == /clear ]]; then echo \"mock clear\"; fi; done'"
  track_session "${session}"
}

run_daemon_once_fixture() {
  local telemetry_dir="$1"
  local run_id="$2"
  local now_epoch="$3"
  local spark_session="$4"
  local out_file="$5"
  local err_file="$6"

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
    "${DAEMON_UNDER_TEST}" --once >"${out_file}" 2>"${err_file}"
}

test_t1_syntax_help() {
  local help_file="${TMP_ROOT}/t1-help.txt"

  bash -n "${DAEMON_UNDER_TEST}"
  bash -n "$0"
  "${DAEMON_UNDER_TEST}" --help > "${help_file}"
  assert_contains_file "${help_file}" 'Verb / option table' "T1 help prints verb table"
  assert_contains_file "${help_file}" '--once' "T1 help includes --once"
  assert_contains_file "${help_file}" '--help' "T1 help includes --help"
  assert_contains_file "${help_file}" 'SPARK_DAEMON_TICK_BASE' "T1 help includes tick-base option"
  pass "T1 daemon and acceptance script bash -n clean"
}

test_t2_singleton() {
  local telemetry_dir="${TMP_ROOT}/t2-telemetry"
  local pid_file="${telemetry_dir}/pid"
  local start_ns end_ns elapsed_ms rc first_pid

  mkdir -p "${telemetry_dir}"
  SPARK_DAEMON_TELEMETRY_DIR="${telemetry_dir}" \
  SPARK_DAEMON_PID_FILE="${pid_file}" \
  SPARK_DAEMON_STATE_CACHE="${telemetry_dir}/state.json" \
  SPARK_DAEMON_REGISTRY_CACHE="${telemetry_dir}/registry.json" \
  SPARK_DAEMON_DB="${telemetry_dir}/projcore-temp.db" \
  SPARK_DAEMON_EVENT_LOG="${telemetry_dir}/spark-daemon-events.log" \
  SPARK_DAEMON_TICK_BASE=30 \
  OVERMIND_TOKEN_FILE="${TMP_ROOT}/missing-token.env" \
    "${DAEMON_UNDER_TEST}" > "${TMP_ROOT}/t2-first.out" 2> "${TMP_ROOT}/t2-first.err" &
  track_pid "$!"
  first_pid="$(wait_for_pid_file_alive "${pid_file}" 5)" || fail "T2 first daemon did not become alive"

  start_ns="$(python3 - <<'PY'
import time
print(time.monotonic_ns())
PY
)"
  set +e
  SPARK_DAEMON_TELEMETRY_DIR="${telemetry_dir}" \
  SPARK_DAEMON_PID_FILE="${pid_file}" \
  SPARK_DAEMON_STATE_CACHE="${telemetry_dir}/state.json" \
  SPARK_DAEMON_REGISTRY_CACHE="${telemetry_dir}/registry.json" \
  SPARK_DAEMON_DB="${telemetry_dir}/projcore-temp.db" \
  SPARK_DAEMON_EVENT_LOG="${telemetry_dir}/spark-daemon-events.log" \
  SPARK_DAEMON_TICK_BASE=30 \
  OVERMIND_TOKEN_FILE="${TMP_ROOT}/missing-token.env" \
    "${DAEMON_UNDER_TEST}" > "${TMP_ROOT}/t2-second.out" 2> "${TMP_ROOT}/t2-second.err"
  rc=$?
  set -e
  end_ns="$(python3 - <<'PY'
import time
print(time.monotonic_ns())
PY
)"
  elapsed_ms="$(( (end_ns - start_ns) / 1000000 ))"

  assert_eq "0" "${rc}" "T2 second instance exits 0"
  [[ "${elapsed_ms}" -lt 100 ]] || fail "T2 second instance took ${elapsed_ms}ms, expected <100ms"
  [[ ! -s "${TMP_ROOT}/t2-second.out" && ! -s "${TMP_ROOT}/t2-second.err" ]] || fail "T2 second instance was not silent"
  kill -0 "${first_pid}" 2>/dev/null || fail "T2 first daemon did not stay alive"
  pass "T2 singleton second exit ${elapsed_ms}ms while first stayed alive"
}

test_t3_spawn_on_register() {
  local run_dir="${TMP_ROOT}/t3-run"
  local token_file="${TMP_ROOT}/t3.env"
  local port_file="${TMP_ROOT}/t3-server.port"
  local telemetry_dir="${TMP_ROOT}/t3-telemetry"
  local pid_file="${telemetry_dir}/pid"
  local port spawned_pid server_pid

  mkdir -p "${run_dir}" "${telemetry_dir}"
  printf 'OVERMIND_TOKEN=test-token\n' > "${token_file}"
  printf 'progress\n' > "${run_dir}/progress.md"
  printf 'callbacks\n' > "${run_dir}/callbacks.md"

  python3 -u - "${port_file}" <<'PY' &
import http.server
import json
import socketserver
import sys

port_file = sys.argv[1]

class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/api/overmind/register":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get("content-length", "0") or "0")
        self.rfile.read(length)
        body = json.dumps({"workflow_id": "wf-b10-t3"}).encode("utf-8")
        self.send_response(201)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        return

with socketserver.TCPServer(("127.0.0.1", 0), Handler) as httpd:
    with open(port_file, "w", encoding="utf-8") as handle:
        handle.write(str(httpd.server_address[1]))
    httpd.serve_forever()
PY
  server_pid=$!
  track_pid "${server_pid}"
  wait_for_file "${port_file}" 5 || fail "T3 mock register endpoint did not start"
  port="$(cat "${port_file}")"

  OVERMIND_URL="http://127.0.0.1:${port}" \
  OVERMIND_TOKEN_FILE="${token_file}" \
  SPARK_DAEMON_TELEMETRY_DIR="${telemetry_dir}" \
  SPARK_DAEMON_PID_FILE="${pid_file}" \
  SPARK_DAEMON_STATE_CACHE="${telemetry_dir}/state.json" \
  SPARK_DAEMON_REGISTRY_CACHE="${telemetry_dir}/registry.json" \
  SPARK_DAEMON_DB="${telemetry_dir}/projcore-temp.db" \
  SPARK_DAEMON_EVENT_LOG="${telemetry_dir}/spark-daemon-events.log" \
  SPARK_DAEMON_TICK_BASE=30 \
    "${OVERMIND_UNDER_TEST}" register --run-dir "${run_dir}" > "${TMP_ROOT}/t3-register.out" 2> "${TMP_ROOT}/t3-register.err"

  spawned_pid="$(wait_for_pid_file_alive "${pid_file}" 5)" || fail "T3 daemon not alive within 5s after register"
  track_pid "${spawned_pid}"
  pass "T3 isolated overmind.sh register spawned daemon pid ${spawned_pid}"
}

test_t4_healthy() {
  local telemetry_dir="${TMP_ROOT}/t4-telemetry"
  local run_dir="${TMP_ROOT}/t4-run"
  local run_id="b10-t4"
  local child_session="spark-daemon-b10-t4-child-$$"
  local spark_session="spark-daemon-b10-t4-spark-$$"
  local now_epoch

  now_epoch="$(date +%s)"
  mkdir -p "${telemetry_dir}"
  setup_run_dir "${run_dir}"
  start_child_session "${child_session}" "fresh healthy pane output"
  write_registry_cache "${telemetry_dir}/registry.json" "${run_id}" "${run_dir}" "${child_session}" "${now_epoch}"

  run_daemon_once_fixture "${telemetry_dir}" "${run_id}" "${now_epoch}" "${spark_session}" "${TMP_ROOT}/t4.out" "${TMP_ROOT}/t4.err"

  assert_not_contains_file "${run_dir}/callbacks.md" 'SPARK-DAEMON-' "T4 HEALTHY writes no daemon callback"
  assert_eq "HEALTHY" "$(json_line_value "${telemetry_dir}/spark-daemon-events.log" 0 classification)" "T4 event log records HEALTHY"
  assert_eq "1" "$(sqlite_value "${telemetry_dir}/projcore-temp.db" "select count(*) from spark_daemon_ticks where run_id='b10-t4' and tier=1 and classification='HEALTHY' and action='no-op' and spark_used=0")" "T4 SQLite HEALTHY tick"
}

test_t5_crashed_hard_alert() {
  local telemetry_dir="${TMP_ROOT}/t5-telemetry"
  local run_dir="${TMP_ROOT}/t5-run"
  local run_id="b10-t5"
  local missing_child="spark-daemon-b10-t5-missing-$$"
  local spark_session="spark-daemon-b10-t5-spark-$$"
  local stall_log="${TMP_ROOT}/t5-stall.log"
  local overmind_mock="${TMP_ROOT}/t5-overmind.sh"
  local now_epoch

  now_epoch="$(date +%s)"
  mkdir -p "${telemetry_dir}"
  setup_run_dir "${run_dir}"
  write_registry_cache "${telemetry_dir}/registry.json" "${run_id}" "${run_dir}" "${missing_child}" "${now_epoch}"
  printf '#!/usr/bin/env bash\n{\n  printf '\''called=1\\n'\''\n  printf '\''args=%%s\\n'\'' "$*"\n} >> %q\n' "${stall_log}" > "${overmind_mock}"
  chmod +x "${overmind_mock}"
  : > "${stall_log}"
  "${overmind_mock}" self-test >/dev/null 2>&1 || fail "T5 mocked overmind.sh is not executable"
  : > "${stall_log}"

  SPARK_DAEMON_TELEMETRY_DIR="${telemetry_dir}" \
  SPARK_DAEMON_PID_FILE="${telemetry_dir}/pid" \
  SPARK_DAEMON_STATE_CACHE="${telemetry_dir}/state.json" \
  SPARK_DAEMON_REGISTRY_CACHE="${telemetry_dir}/registry.json" \
  SPARK_DAEMON_REGISTRY_TTL=300 \
  SPARK_DAEMON_DB="${telemetry_dir}/projcore-temp.db" \
  SPARK_DAEMON_EVENT_LOG="${telemetry_dir}/spark-daemon-events.log" \
  SPARK_DAEMON_TICK_TIMEOUT=3 \
  SPARK_DAEMON_SESSION_NAME="${spark_session}" \
  SPARK_DAEMON_NOTIFY_CMD=/bin/true \
  SPARK_DAEMON_OVERMIND_SH="${overmind_mock}" \
  OVERMIND_TOKEN_FILE="${TMP_ROOT}/missing-token.env" \
    "${DAEMON_UNDER_TEST}" --once > "${TMP_ROOT}/t5.out" 2> "${TMP_ROOT}/t5.err"

  assert_contains_file "${run_dir}/callbacks.md" '\[projcore SPARK-DAEMON-HARD\] b10-t5 registered session dead' "T5 HARD callback"
  assert_contains_file "${stall_log}" "args=stall-alert registered session dead --run-dir ${run_dir}" "T5 mocked stall-alert fired"
  assert_eq "1" "$(sqlite_value "${telemetry_dir}/projcore-temp.db" "select count(*) from spark_daemon_ticks where run_id='b10-t5' and classification='CRASHED' and action='alert-hard'")" "T5 SQLite CRASHED row"
}

test_t6_watcher_prefix_guard() {
  local run_dir="${TMP_ROOT}/t6-run"
  local callbacks_file="${run_dir}/callbacks.md"
  local progress_file="${run_dir}/progress.md"
  local watcher_session="spark-daemon-b10-t6-watcher-$$"
  local watcher_out="${TMP_ROOT}/t6-watcher.out"
  local dispatched_at
  local rc

  mkdir -p "${run_dir}"
  printf '[projcore SPARK-DAEMON-HARD] batch-b10 registered session dead\n' > "${callbacks_file}"
  dispatched_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  printf 'batch-b10 dispatched_at: %s estimate_min: 40 bucket: TEST-HEAVY\n' "${dispatched_at}" > "${progress_file}"
  tmux new-session -d -s "${watcher_session}" "bash --noprofile --norc -c 'printf \"idle fixture\\n\"; exec sleep 300'"
  track_session "${watcher_session}"

  set +e
  HOME="${TMP_ROOT}/no-home" \
  PROJCORE_POLL_SECONDS=1 \
  PROJCORE_IDLE_CYCLES=1 \
  PROJCORE_WAKEUP_GRACE=999 \
    timeout 5 bash "${WATCHER_UNDER_TEST}" "${watcher_session}" "${callbacks_file}" "batch-b10" "${progress_file}" > "${watcher_out}" 2>&1
  rc=$?
  set -e

  [[ "${rc}" != "0" ]] || fail "T6 watcher exited 0 on SPARK-DAEMON prefix"
  case "${rc}" in
    4|5|124) pass "T6 watcher ignored SPARK-DAEMON prefix (rc=${rc}, not 0)" ;;
    *) fail "T6 watcher returned unexpected rc=${rc}; output: $(cat "${watcher_out}")" ;;
  esac
}

test_t7_ambiguous_tier2() {
  local telemetry_dir="${TMP_ROOT}/t7-telemetry"
  local run_dir="${TMP_ROOT}/t7-run"
  local run_id="b10-t7"
  local child_session="spark-daemon-b10-t7-child-$$"
  local spark_session="spark-daemon-b10-t7-spark-$$"
  local count_file="${TMP_ROOT}/t7-dispatch.count"
  local pane_file="${TMP_ROOT}/t7-spark-pane.txt"
  local pane_hash now_epoch

  now_epoch="$(date +%s)"
  mkdir -p "${telemetry_dir}"
  : > "${count_file}"
  setup_run_dir "${run_dir}"
  start_child_session "${child_session}" "Working (mock tier-1 ambiguous fixture)"
  start_responder_session "${spark_session}" "${count_file}"
  pane_hash="$(tmux capture-pane -J -p -t "${child_session}" | sha256sum | awk '{ print $1 }')"
  write_state_cache "${telemetry_dir}/state.json" "${run_id}" "${child_session}" "${pane_hash}" 1
  write_registry_cache "${telemetry_dir}/registry.json" "${run_id}" "${run_dir}" "${child_session}" "${now_epoch}"

  run_daemon_once_fixture "${telemetry_dir}" "${run_id}" "${now_epoch}" "${spark_session}" "${TMP_ROOT}/t7.out" "${TMP_ROOT}/t7.err"
  tmux capture-pane -J -p -t "${spark_session}" > "${pane_file}"

  assert_contains_file "${pane_file}" 'STATUS: SPARK-TICK-DONE ALERT-MEDIUM' "T7 mocked spark verdict appears in pane"
  assert_eq "1" "$(sqlite_value "${telemetry_dir}/projcore-temp.db" "select count(*) from spark_daemon_ticks where run_id='b10-t7' and tier=2 and classification='ALERT-MEDIUM' and spark_used=1")" "T7 SQLite tier-2 spark_used row"
  assert_eq "2" "$(json_line_value "${telemetry_dir}/spark-daemon-events.log" 1 tier)" "T7 event log tier-2 row"
}

test_t8_budget_cap() {
  local telemetry_dir="${TMP_ROOT}/t8-telemetry"
  local run_dir="${TMP_ROOT}/t8-run"
  local run_id="b10-t8"
  local child_session="spark-daemon-b10-t8-child-$$"
  local spark_session="spark-daemon-b10-t8-spark-$$"
  local count_file="${TMP_ROOT}/t8-dispatch.count"
  local out_file="${TMP_ROOT}/t8.out"
  local err_file="${TMP_ROOT}/t8.err"
  local pane_hash dispatches now_epoch=360000

  mkdir -p "${telemetry_dir}"
  : > "${count_file}"
  : > "${out_file}"
  : > "${err_file}"
  setup_run_dir "${run_dir}"
  start_child_session "${child_session}" "Working (mock tier-1 ambiguous fixture)"
  start_responder_session "${spark_session}" "${count_file}"
  pane_hash="$(tmux capture-pane -J -p -t "${child_session}" | sha256sum | awk '{ print $1 }')"
  write_state_cache "${telemetry_dir}/state.json" "${run_id}" "${child_session}" "${pane_hash}" 1
  write_registry_cache "${telemetry_dir}/registry.json" "${run_id}" "${run_dir}" "${child_session}" "${now_epoch}"

  for _ in $(seq 1 13); do
    SPARK_DAEMON_BUDGET_PER_HOUR=12 run_daemon_once_fixture "${telemetry_dir}" "${run_id}" "${now_epoch}" "${spark_session}" "${out_file}" "${err_file}"
  done

  dispatches="$(wc -l < "${count_file}" | awk '{ print $1 }')"
  assert_eq "12" "${dispatches}" "T8 13th AMBIGUOUS skips spark dispatch"
  assert_contains_file "${err_file}" 'action=budget-capped budget_count=13 budget_limit=12' "T8 budget-capped log line"
  assert_eq "1" "$(sqlite_value "${telemetry_dir}/projcore-temp.db" "select count(*) from spark_daemon_ticks where run_id='b10-t8' and action='budget-capped' and spark_used=0")" "T8 SQLite budget-capped row"
}

test_t9_sleep_slow_poll_reap() {
  local telemetry_dir="${TMP_ROOT}/t9-telemetry"
  local spark_session="spark-daemon-b10-t9-spark-$$"

  mkdir -p "${telemetry_dir}"
  tmux new-session -d -s "${spark_session}" "bash --noprofile --norc -c 'sleep 300'"
  track_session "${spark_session}"

  (
    export SPARK_DAEMON_SOURCE_ONLY=1
    export SPARK_DAEMON_TELEMETRY_DIR="${telemetry_dir}"
    export SPARK_DAEMON_STATE_CACHE="${telemetry_dir}/state.json"
    export SPARK_DAEMON_SESSION_NAME="${spark_session}"
    export SPARK_DAEMON_TICK_BASE=1
    export SPARK_DAEMON_SLEEP_AFTER_POLLS=0
    source "${DAEMON_UNDER_TEST}"
    update_lifecycle_state 0
    assert_eq "SLEEP" "${STATE}" "T9 empty registry enters SLEEP"
    assert_eq "300" "${CURRENT_TICK_INTERVAL}" "T9 SLEEP uses 300s slow poll"
  )

  if tmux has-session -t "${spark_session}" 2>/dev/null; then
    fail "T9 spark session still alive after sleep reap"
  fi
  pass "T9 SLEEP reaps isolated spark-daemon session"
}

test_t10_once_exits() {
  local telemetry_dir="${TMP_ROOT}/t10-telemetry"
  local now_epoch out_file err_file rc tick_count

  now_epoch="$(date +%s)"
  out_file="${TMP_ROOT}/t10.out"
  err_file="${TMP_ROOT}/t10.err"
  mkdir -p "${telemetry_dir}"
  write_empty_registry_cache "${telemetry_dir}/registry.json" "${now_epoch}"

  set +e
  SPARK_DAEMON_TELEMETRY_DIR="${telemetry_dir}" \
  SPARK_DAEMON_PID_FILE="${telemetry_dir}/pid" \
  SPARK_DAEMON_STATE_CACHE="${telemetry_dir}/state.json" \
  SPARK_DAEMON_REGISTRY_CACHE="${telemetry_dir}/registry.json" \
  SPARK_DAEMON_REGISTRY_TTL=300 \
  SPARK_DAEMON_DB="${telemetry_dir}/projcore-temp.db" \
  SPARK_DAEMON_EVENT_LOG="${telemetry_dir}/spark-daemon-events.log" \
  SPARK_DAEMON_NOW_EPOCH="${now_epoch}" \
  OVERMIND_TOKEN_FILE="${TMP_ROOT}/missing-token.env" \
    "${DAEMON_UNDER_TEST}" --once > "${out_file}" 2> "${err_file}"
  rc=$?
  set -e

  assert_eq "0" "${rc}" "T10 --once exits 0"
  tick_count="$(grep -c 'tick state=' "${out_file}" || true)"
  assert_eq "1" "${tick_count}" "T10 --once runs exactly one tick"
}

print_results_table() {
  printf '\nT1-T10 Acceptance Results\n'
  printf '| Test | Result | Evidence |\n'
  printf '|---|---|---|\n'
  cat "${RESULTS_FILE}"
}

run_test() {
  local test_id="$1"
  local label="$2"
  local fn="$3"

  printf 'RUN %s %s\n' "${test_id}" "${label}"
  if ( "${fn}" ); then
    printf '| %s | PASS | %s |\n' "${test_id}" "${label}" >> "${RESULTS_FILE}"
  else
    printf '| %s | FAIL | %s |\n' "${test_id}" "${label}" >> "${RESULTS_FILE}"
    print_results_table
    exit 1
  fi
}

command -v tmux >/dev/null 2>&1 || fail "tmux is required"
command -v python3 >/dev/null 2>&1 || fail "python3 is required"
[[ -x "${DAEMON_UNDER_TEST}" ]] || fail "daemon under test is not executable: ${DAEMON_UNDER_TEST}"
[[ -x "${OVERMIND_UNDER_TEST}" ]] || fail "overmind under test is not executable: ${OVERMIND_UNDER_TEST}"
[[ -x "${WATCHER_UNDER_TEST}" ]] || fail "watcher under test is not executable: ${WATCHER_UNDER_TEST}"

run_test "T1" "bash -n clean and --help verb table" test_t1_syntax_help
run_test "T2" "singleton second instance exits 0 silently <100ms" test_t2_singleton
run_test "T3" "successful isolated overmind.sh register spawns daemon <=5s" test_t3_spawn_on_register
run_test "T4" "HEALTHY no callback plus event-log and SQLite tick" test_t4_healthy
run_test "T5" "CRASHED writes HARD callback and mocked stall-alert" test_t5_crashed_hard_alert
run_test "T6" "SPARK-DAEMON callback prefix does not trip projcore-watcher exit 0" test_t6_watcher_prefix_guard
run_test "T7" "AMBIGUOUS escalates to mocked Tier-2 spark verdict and telemetry" test_t7_ambiguous_tier2
run_test "T8" "13th AMBIGUOUS in hour is budget-capped without spark dispatch" test_t8_budget_cap
run_test "T9" "empty registry sleep uses 300s slow poll and reaps spark session" test_t9_sleep_slow_poll_reap
run_test "T10" "--once runs one tick and exits 0" test_t10_once_exits

print_results_table
