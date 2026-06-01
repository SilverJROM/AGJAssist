#!/usr/bin/env bash
set -euo pipefail

DAEMON_UNDER_TEST="${SPARK_DAEMON_UNDER_TEST:-${HOME}/.claude/agents/lib/overmind-spark-daemon.sh}"
TMP_ROOT="$(mktemp -d)"
SERVER_PID=""
DAEMON_PID=""

cleanup() {
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

assert_eq() {
  local expected="$1"
  local actual="$2"
  local label="$3"

  [[ "${expected}" == "${actual}" ]] || fail "${label}: expected ${expected}, got ${actual}"
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

wait_for_pid_state() {
  local pid_file="$1"
  local expected="$2"
  local timeout_sec="$3"
  local start

  start="$(date +%s)"
  while true; do
    if [[ -s "${pid_file}" ]] && awk -F= -v expected="${expected}" '$1 == "state" && $2 == expected { found = 1 } END { exit found ? 0 : 1 }' "${pid_file}"; then
      return 0
    fi
    if (( $(date +%s) - start >= timeout_sec )); then
      return 1
    fi
    sleep 0.1
  done
}

write_registry_mode() {
  local mode="$1"
  printf '%s\n' "${mode}" > "${TMP_ROOT}/registry.mode"
}

fetch_count() {
  cat "${TMP_ROOT}/fetch.count" 2>/dev/null || printf '0'
}

age_cache() {
  python3 - "${SPARK_DAEMON_REGISTRY_CACHE}" <<'PY'
import json
import os
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as handle:
    data = json.load(handle)
data["fetched_at_epoch"] = 0
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as handle:
    json.dump(data, handle, sort_keys=True, indent=2)
    handle.write("\n")
os.replace(tmp, path)
PY
}

start_mock_server() {
  local port_file="${TMP_ROOT}/server.port"

  : > "${TMP_ROOT}/fetch.count"
  write_registry_mode active
  python3 -u - "${port_file}" "${TMP_ROOT}/registry.mode" "${TMP_ROOT}/fetch.count" "${TMP_ROOT}/active-run" > "${TMP_ROOT}/server.log" 2>&1 <<'PY' &
import http.server
import json
import os
import socketserver
import sys

port_file, mode_file, count_file, run_dir = sys.argv[1:5]

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != "/api/overmind/runs/active":
            self.send_response(404)
            self.end_headers()
            return
        if self.headers.get("X-Overmind-Token") != "test-token":
            body = json.dumps({"error": "Missing or invalid overmind token"}).encode("utf-8")
            self.send_response(401)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        try:
            count = int(open(count_file, "r", encoding="utf-8").read().strip() or "0")
        except Exception:
            count = 0
        with open(count_file, "w", encoding="utf-8") as handle:
            handle.write(str(count + 1))
        mode = open(mode_file, "r", encoding="utf-8").read().strip()
        if mode == "fail":
            self.send_response(503)
            self.end_headers()
            return
        runs = []
        if mode == "active":
            runs = [{
                "run_id": "b5-fixture",
                "run_dir": run_dir,
                "label": "fixture",
                "parent_label": "AGJ",
                "parent_session": "AGJ-51",
                "status": "active",
                "children": [],
                "dispatch_manifests": []
            }]
        body = json.dumps({"runs": runs}).encode("utf-8")
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
  wait_for_file "${port_file}" 5 || fail "mock active-runs server did not start"
  printf '%s\n' "$(cat "${port_file}")"
}

run_lifecycle_and_cache_tests() {
  local port="$1"
  local active_run_dir="${TMP_ROOT}/active-run"
  local telemetry_dir="${TMP_ROOT}/source-telemetry"

  mkdir -p "${active_run_dir}/dispatch" "${telemetry_dir}"
  printf '%s\n' "$$" > "${active_run_dir}/dispatch/.watcher.pid"
  printf 'callbacks\n' > "${active_run_dir}/callbacks.md"
  printf 'progress\n' > "${active_run_dir}/progress.md"
  git -C "${active_run_dir}" init -q

  export SPARK_DAEMON_SOURCE_ONLY=1
  export SPARK_DAEMON_TELEMETRY_DIR="${telemetry_dir}"
  export SPARK_DAEMON_STATE_CACHE="${telemetry_dir}/spark-daemon-state.json"
  export SPARK_DAEMON_REGISTRY_CACHE="${telemetry_dir}/spark-daemon-registry.json"
  export SPARK_DAEMON_REGISTRY_TTL=30
  export SPARK_DAEMON_TICK_BASE=1
  export SPARK_DAEMON_SLEEP_AFTER_POLLS=1
  export OVERMIND_URL="http://127.0.0.1:${port}"
  export OVERMIND_TOKEN_FILE="${TMP_ROOT}/token.env"
  printf 'OVERMIND_TOKEN=test-token\n' > "${OVERMIND_TOKEN_FILE}"
  source "${DAEMON_UNDER_TEST}"
  SLEEP_INTERVAL=2

  write_registry_mode active
  do_tick >/dev/null
  assert_eq "AWAKE" "${STATE}" "active registry keeps daemon awake"
  assert_eq "1" "${CURRENT_TICK_INTERVAL}" "awake interval uses tick base"
  assert_eq "1" "$(fetch_count)" "first active tick fetches endpoint"

  write_registry_mode empty
  do_tick >/dev/null
  assert_eq "1" "$(fetch_count)" "second tick within TTL uses cached active registry"

  age_cache
  do_tick >/dev/null
  assert_eq "2" "$(fetch_count)" "stale cache re-fetches endpoint"
  assert_eq "AWAKE" "${STATE}" "first empty poll remains awake"

  age_cache
  do_tick >/dev/null
  assert_eq "SLEEP" "${STATE}" "repeated empty polls enter sleep"
  assert_eq "2" "${CURRENT_TICK_INTERVAL}" "sleep interval uses slow poll"

  write_registry_mode active
  age_cache
  do_tick >/dev/null
  assert_eq "AWAKE" "${STATE}" "active registry wakes sleeping daemon"
  assert_eq "1" "${CURRENT_TICK_INTERVAL}" "wake restores tick base"

  write_registry_mode fail
  age_cache
  do_tick >/dev/null
  assert_eq "AWAKE" "${STATE}" "fetch failure reuses last good active cache"
  pass "mock endpoint lifecycle/cache test isolated from live run"
}

run_no_self_exit_test() {
  local port="$1"
  local telemetry_dir="${TMP_ROOT}/daemon-telemetry"
  local pid_file="${telemetry_dir}/overmind-spark-daemon.pid"
  local state_cache="${telemetry_dir}/spark-daemon-state.json"
  local registry_cache="${telemetry_dir}/spark-daemon-registry.json"
  local rc

  mkdir -p "${telemetry_dir}"
  write_registry_mode empty
  SPARK_DAEMON_TELEMETRY_DIR="${telemetry_dir}" \
  SPARK_DAEMON_SOURCE_ONLY=0 \
  SPARK_DAEMON_PID_FILE="${pid_file}" \
  SPARK_DAEMON_STATE_CACHE="${state_cache}" \
  SPARK_DAEMON_REGISTRY_CACHE="${registry_cache}" \
  SPARK_DAEMON_REGISTRY_TTL=0 \
  SPARK_DAEMON_TICK_BASE=1 \
  SPARK_DAEMON_SLEEP_AFTER_POLLS=0 \
  SLEEP_INTERVAL=1 \
  OVERMIND_URL="http://127.0.0.1:${port}" \
  OVERMIND_TOKEN_FILE="${TMP_ROOT}/token.env" \
    "${DAEMON_UNDER_TEST}" >/dev/null 2>&1 &
  DAEMON_PID=$!

  wait_for_pid_state "${pid_file}" "SLEEP" 5 || fail "daemon did not enter SLEEP in isolated empty-registry test"
  kill -0 "${DAEMON_PID}" 2>/dev/null || fail "daemon exited autonomously on empty registry"
  pass "empty registry sleeps without autonomous exit"

  kill -TERM "${DAEMON_PID}"
  set +e
  wait "${DAEMON_PID}"
  rc=$?
  set -e
  DAEMON_PID=""
  assert_eq "0" "${rc}" "SIGTERM exits daemon with status 0"
}

bash -n "${DAEMON_UNDER_TEST}"
pass "bash -n daemon"
port="$(start_mock_server)"
run_lifecycle_and_cache_tests "${port}"
run_no_self_exit_test "${port}"
