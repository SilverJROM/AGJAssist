#!/usr/bin/env bash
set -euo pipefail

DAEMON_UNDER_TEST="${SPARK_DAEMON_UNDER_TEST:-${HOME}/.claude/agents/lib/overmind-spark-daemon.sh}"
TMP_ROOT="$(mktemp -d)"
SESSIONS=()
WATCHER_PID=""

cleanup() {
  local session
  if [[ -n "${WATCHER_PID}" ]]; then
    kill "${WATCHER_PID}" 2>/dev/null || true
  fi
  for session in "${SESSIONS[@]}"; do
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

assert_contains() {
  local file="$1"
  local pattern="$2"
  local label="$3"

  if ! grep -Eq "${pattern}" "${file}"; then
    printf '%s\n' "--- ${file} ---" >&2
    cat "${file}" >&2
    fail "${label}: missing ${pattern}"
  fi
  pass "${label}"
}

start_responder_session() {
  local session="$1"
  local mode="$2"

  if [[ "${mode}" == "reply" ]]; then
    tmux new-session -d -s "${session}" "bash --noprofile --norc -c 'while IFS= read -r line; do if [[ \"\$line\" == Spark\\ Tier-2* ]]; then echo \"STATUS: SPARK-TICK-DONE ALERT-MEDIUM mock frozen busy pane\"; elif [[ \"\$line\" == /clear ]]; then echo \"mock clear\"; else echo \"mock ignored\"; fi; done'"
  else
    tmux new-session -d -s "${session}" "bash --noprofile --norc -c 'while IFS= read -r line; do echo \"mock no status\"; done'"
  fi
  SESSIONS+=("${session}")
}

start_child_session() {
  local session="$1"

  tmux new-session -d -s "${session}" "bash --noprofile --norc -c 'printf \"Working (mock tier-1 ambiguous fixture)\\n\"; sleep 120'"
  SESSIONS+=("${session}")
  sleep 0.2
}

write_registry_cache() {
  local registry_cache="$1"
  local run_dir="$2"
  local child_session="$3"

  python3 - "${registry_cache}" "${run_dir}" "${child_session}" <<'PY'
import json
import os
import sys
import time

path, run_dir, child_session = sys.argv[1:4]
os.makedirs(os.path.dirname(path), exist_ok=True)
payload = {
    "fetched_at": "2026-06-01T00:00:00Z",
    "fetched_at_epoch": int(time.time()),
    "response": {
        "runs": [{
            "run_id": "b6-fixture",
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
  local run_dir="$2"
  local child_session="$3"
  local unchanged_ticks="$4"
  local pane_hash

  pane_hash="$(tmux capture-pane -J -p -t "${child_session}" | sha256sum | awk '{ print $1 }')"
  python3 - "${state_cache}" "${run_dir}" "${child_session}" "${pane_hash}" "${unchanged_ticks}" <<'PY'
import json
import os
import sys

path, run_dir, child_session, pane_hash, unchanged_ticks = sys.argv[1:6]
os.makedirs(os.path.dirname(path), exist_ok=True)
payload = {
    "runs": {
        "b6-fixture": {
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

run_once_fixture() {
  local spark_session="$1"
  local child_session="$2"
  local telemetry_dir="$3"
  local run_dir="$4"
  local timeout="$5"
  local stdout_file="$6"
  local stderr_file="$7"

  SPARK_DAEMON_TELEMETRY_DIR="${telemetry_dir}" \
  SPARK_DAEMON_PID_FILE="${telemetry_dir}/pid" \
  SPARK_DAEMON_STATE_CACHE="${telemetry_dir}/state.json" \
  SPARK_DAEMON_REGISTRY_CACHE="${telemetry_dir}/registry.json" \
  SPARK_DAEMON_REGISTRY_TTL=300 \
  SPARK_DAEMON_TICK_TIMEOUT="${timeout}" \
  SPARK_DAEMON_SESSION_NAME="${spark_session}" \
  SPARK_DAEMON_PANE_UNCHANGED_TICKS=2 \
  SPARK_DAEMON_NOTIFY_CMD=/bin/true \
  SPARK_DAEMON_OVERMIND_SH="${TMP_ROOT}/missing-overmind.sh" \
  OVERMIND_TOKEN_FILE="${TMP_ROOT}/missing-token.env" \
    "${DAEMON_UNDER_TEST}" --once >"${stdout_file}" 2>"${stderr_file}"
}

setup_fixture() {
  local spark_session="$1"
  local child_session="$2"
  local telemetry_dir="$3"
  local run_dir="$4"
  local responder_mode="$5"

  mkdir -p "${telemetry_dir}" "${run_dir}/dispatch"
  printf 'progress\n' > "${run_dir}/progress.md"
  printf 'callbacks\n' > "${run_dir}/callbacks.md"
  sleep 120 &
  WATCHER_PID=$!
  printf '%s\n' "${WATCHER_PID}" > "${run_dir}/dispatch/.watcher.pid"
  start_child_session "${child_session}"
  start_responder_session "${spark_session}" "${responder_mode}"
  write_registry_cache "${telemetry_dir}/registry.json" "${run_dir}" "${child_session}"
  write_state_cache "${telemetry_dir}/state.json" "${run_dir}" "${child_session}" 1
}

run_verdict_test() {
  local spark_session="spark-daemon-test-b6-ok-$$"
  local child_session="spark-daemon-test-b6-child-ok-$$"
  local telemetry_dir="${TMP_ROOT}/telemetry-ok"
  local run_dir="${TMP_ROOT}/run-ok"
  local pane_file="${TMP_ROOT}/spark-ok-pane.txt"

  setup_fixture "${spark_session}" "${child_session}" "${telemetry_dir}" "${run_dir}" reply
  run_once_fixture "${spark_session}" "${child_session}" "${telemetry_dir}" "${run_dir}" 3 "${TMP_ROOT}/ok.out" "${TMP_ROOT}/ok.err"
  tmux capture-pane -J -p -t "${spark_session}" > "${pane_file}"
  assert_contains "${pane_file}" 'STATUS: SPARK-TICK-DONE ALERT-MEDIUM' "T7 pane-only spark verdict visible"
  assert_contains "${run_dir}/callbacks.md" '\[projcore SPARK-DAEMON-MEDIUM\] b6-fixture STATUS: SPARK-TICK-DONE ALERT-MEDIUM' "Tier-2 ALERT-MEDIUM feeds R6 callback action"
}

run_timeout_test() {
  local spark_session="spark-daemon-test-b6-timeout-$$"
  local child_session="spark-daemon-test-b6-child-timeout-$$"
  local telemetry_dir="${TMP_ROOT}/telemetry-timeout"
  local run_dir="${TMP_ROOT}/run-timeout"

  setup_fixture "${spark_session}" "${child_session}" "${telemetry_dir}" "${run_dir}" timeout
  run_once_fixture "${spark_session}" "${child_session}" "${telemetry_dir}" "${run_dir}" 1 "${TMP_ROOT}/timeout.out" "${TMP_ROOT}/timeout.err"
  assert_contains "${TMP_ROOT}/timeout.err" 'Tier-2 spark timeout for b6-fixture' "timeout logs spark hang"
  if grep -q 'SPARK-DAEMON-' "${run_dir}/callbacks.md"; then
    fail "timeout ALERT-SOFT should not write callback action"
  fi
  pass "timeout maps to ALERT-SOFT and daemon continues"
}

command -v tmux >/dev/null 2>&1 || fail "tmux is required for B6 pane-only tests"
bash -n "${DAEMON_UNDER_TEST}"
pass "daemon bash -n clean"
run_verdict_test
run_timeout_test
