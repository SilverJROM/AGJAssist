#!/usr/bin/env bash
set -euo pipefail

OVERMIND_UNDER_TEST="${OVERMIND_UNDER_TEST:-${HOME}/.claude/agents/lib/overmind.sh}"
DAEMON_UNDER_TEST="${SPARK_DAEMON_UNDER_TEST:-${HOME}/.claude/agents/lib/overmind-spark-daemon.sh}"
WATCHER_UNDER_TEST="${WATCHER_UNDER_TEST:-${HOME}/.claude/agents/watchers/projcore-watcher.sh}"
TMP_ROOT="$(mktemp -d)"
SESSIONS=()
DAEMON_PID=""
SERVER_PID=""

cleanup() {
  local session
  for session in "${SESSIONS[@]:-}"; do
    tmux kill-session -t "${session}" 2>/dev/null || true
  done
  if [[ -n "${DAEMON_PID}" ]]; then
    kill "${DAEMON_PID}" 2>/dev/null || true
  fi
  if [[ -n "${SERVER_PID}" ]]; then
    kill "${SERVER_PID}" 2>/dev/null || true
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

assert_contains() {
  local file="$1"
  local needle="$2"
  local label="$3"

  grep -qF "${needle}" "${file}" || fail "${label}: missing ${needle}"
  pass "${label}"
}

field_value() {
  local key="$1"
  awk -F= -v key="${key}" '$1 == key { sub(/^[^=]*=/, ""); print; exit }'
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

run_t3_spawn_on_register() {
  local run_dir="${TMP_ROOT}/t3-run"
  local token_file="${TMP_ROOT}/t3.env"
  local port_file="${TMP_ROOT}/server.port"
  local telemetry_dir="${TMP_ROOT}/t3-telemetry"
  local pid_file="${telemetry_dir}/overmind-spark-daemon.pid"
  local state_cache="${telemetry_dir}/spark-daemon-state.json"
  local port
  local spawned_pid

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
        length = int(self.headers.get("content-length", "0") or "0")
        self.rfile.read(length)
        body = json.dumps({"workflow_id": "wf-b4-t3"}).encode("utf-8")
        self.send_response(200)
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
  SERVER_PID=$!
  wait_for_file "${port_file}" 5 || fail "T3 mock overmind server did not start"
  port="$(cat "${port_file}")"

  OVERMIND_URL="http://127.0.0.1:${port}" \
  OVERMIND_TOKEN_FILE="${token_file}" \
  SPARK_DAEMON_TELEMETRY_DIR="${telemetry_dir}" \
  SPARK_DAEMON_PID_FILE="${pid_file}" \
  SPARK_DAEMON_STATE_CACHE="${state_cache}" \
  SPARK_DAEMON_TICK_BASE=30 \
    "${OVERMIND_UNDER_TEST}" register --run-dir "${run_dir}" >/dev/null 2>&1

  wait_for_file "${pid_file}" 5 || fail "T3 daemon pid file not written within 5s"
  spawned_pid="$(awk -F= '$1 == "pid" { print $2; exit }' "${pid_file}")"
  [[ -n "${spawned_pid}" ]] || fail "T3 pid file missing pid"
  kill -0 "${spawned_pid}" 2>/dev/null || fail "T3 spawned daemon pid is not alive"
  DAEMON_PID="${spawned_pid}"
  pass "T3 successful register spawned isolated daemon pid ${spawned_pid}"
}

run_t5_alert_actions() {
  local run_dir="${TMP_ROOT}/t5-run"
  local notify_log="${TMP_ROOT}/notify.log"
  local stall_log="${TMP_ROOT}/stall.log"
  local notify_mock="${TMP_ROOT}/mock-notify.sh"
  local overmind_mock="${TMP_ROOT}/mock-overmind.sh"
  local output
  local reason
  local before_notify_lines
  local before_stall_lines

  mkdir -p "${run_dir}/dispatch"
  printf '%s\n' "$$" > "${run_dir}/dispatch/.watcher.pid"
  printf 'initial\n' > "${run_dir}/callbacks.md"
  printf 'progress\n' > "${run_dir}/progress.md"
  : > "${notify_log}"
  : > "${stall_log}"

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

  export SPARK_DAEMON_SOURCE_ONLY=1
  export SPARK_DAEMON_TELEMETRY_DIR="${TMP_ROOT}/t5-telemetry"
  export SPARK_DAEMON_STATE_CACHE="${SPARK_DAEMON_TELEMETRY_DIR}/spark-daemon-state.json"
  export SPARK_DAEMON_NOTIFY_CMD="${notify_mock}"
  export SPARK_DAEMON_OVERMIND_SH="${overmind_mock}"
  export MOCK_NOTIFY_LOG="${notify_log}"
  export MOCK_STALL_LOG="${stall_log}"
  source "${DAEMON_UNDER_TEST}"

  output="$(spark_collect_run_signals "b4-crashed" "${run_dir}" "b4-missing-session-$$")"
  [[ "$(printf '%s\n' "${output}" | field_value classification)" == "CRASHED" ]] || fail "T5 fixture did not classify CRASHED"
  reason="$(printf '%s\n' "${output}" | field_value reason)"
  spark_apply_classification_action "b4-crashed" "${run_dir}" "CRASHED" "${reason}"

  assert_contains "${run_dir}/callbacks.md" "[projcore SPARK-DAEMON-HARD] b4-crashed registered session dead" "T5 HARD callback"
  assert_contains "${stall_log}" "stall-alert registered session dead --run-dir ${run_dir}" "T5 mocked stall-alert"
  assert_contains "${notify_log}" '"name": "spark-daemon"' "T5 mocked TG payload name"
  assert_contains "${notify_log}" '"model": "gpt-5.3-codex-spark"' "T5 mocked TG payload model"

  before_notify_lines="$(wc -l < "${notify_log}")"
  before_stall_lines="$(wc -l < "${stall_log}")"
  spark_apply_classification_action "b4-crashed" "${run_dir}" "ALERT-MEDIUM" "tier-2 medium fixture"
  assert_contains "${run_dir}/callbacks.md" "[projcore SPARK-DAEMON-MEDIUM] b4-crashed tier-2 medium fixture" "T5 MEDIUM callback"
  [[ "$(wc -l < "${notify_log}")" == "${before_notify_lines}" ]] || fail "T5 MEDIUM unexpectedly sent TG"
  [[ "$(wc -l < "${stall_log}")" == "${before_stall_lines}" ]] || fail "T5 MEDIUM unexpectedly fired stall-alert"
  pass "T5 MEDIUM has no TG or stall-alert"
}

run_t6_watcher_prefix_guard() {
  local run_dir="${TMP_ROOT}/t6-run"
  local callbacks_file="${run_dir}/callbacks.md"
  local watcher_session="spark-b4-watcher-$$"
  local watcher_out="${TMP_ROOT}/watcher.out"
  local rc

  mkdir -p "${run_dir}"
  printf '[projcore SPARK-DAEMON-HARD] batch-b4 registered session dead\n' > "${callbacks_file}"
  tmux new-session -d -s "${watcher_session}" "printf 'idle fixture\n'; exec sleep 60"
  SESSIONS+=("${watcher_session}")

  set +e
  HOME="${TMP_ROOT}/no-home" \
  PROJCORE_POLL_SECONDS=1 \
  PROJCORE_IDLE_CYCLES=1 \
  PROJCORE_WAKEUP_GRACE=999 \
    timeout 5 bash "${WATCHER_UNDER_TEST}" "${watcher_session}" "${callbacks_file}" "batch-b4" > "${watcher_out}" 2>&1
  rc=$?
  set -e

  [[ "${rc}" != "0" ]] || fail "T6 watcher exited 0 on SPARK-DAEMON prefix"
  [[ "${rc}" == "5" ]] || fail "T6 watcher expected exit 5, got ${rc}; output: $(cat "${watcher_out}")"
  pass "T6 watcher ignored SPARK-DAEMON prefix and exited 5, not 0"
}

run_t3_spawn_on_register
run_t5_alert_actions
run_t6_watcher_prefix_guard
