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

assert_eq() {
  local expected="$1"
  local actual="$2"
  local label="$3"

  [[ "${expected}" == "${actual}" ]] || fail "${label}: expected ${expected}, got ${actual}"
  pass "${label}"
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
  local count_file="$2"

  tmux new-session -d -s "${session}" "bash --noprofile --norc -c 'while IFS= read -r line; do if [[ \"\$line\" == Spark\\ Tier-2* ]]; then printf \"dispatch\\n\" >> \"${count_file}\"; echo \"STATUS: SPARK-TICK-DONE HEALTHY mock budget fixture\"; elif [[ \"\$line\" == /clear ]]; then echo \"mock clear\"; fi; done'"
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

path, run_dir, child_session = sys.argv[1:4]
os.makedirs(os.path.dirname(path), exist_ok=True)
payload = {
    "fetched_at": "2026-06-01T00:00:00Z",
    "fetched_at_epoch": 32503680000,
    "response": {
        "runs": [{
            "run_id": "b7-fixture",
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
  local child_session="$2"
  local unchanged_ticks="$3"
  local pane_hash

  pane_hash="$(tmux capture-pane -J -p -t "${child_session}" | sha256sum | awk '{ print $1 }')"
  python3 - "${state_cache}" "${child_session}" "${pane_hash}" "${unchanged_ticks}" <<'PY'
import json
import os
import sys

path, child_session, pane_hash, unchanged_ticks = sys.argv[1:5]
os.makedirs(os.path.dirname(path), exist_ok=True)
payload = {
    "runs": {
        "b7-fixture": {
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

budget_count_from_state() {
  local state_cache="$1"

  python3 - "${state_cache}" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    data = json.load(handle)
print(data["runs"]["b7-fixture"]["spark_budget"]["count"])
PY
}

run_once_budget_fixture() {
  local spark_session="$1"
  local telemetry_dir="$2"
  local now_epoch="$3"
  local stdout_file="$4"
  local stderr_file="$5"

  SPARK_DAEMON_TELEMETRY_DIR="${telemetry_dir}" \
  SPARK_DAEMON_PID_FILE="${telemetry_dir}/pid" \
  SPARK_DAEMON_STATE_CACHE="${telemetry_dir}/state.json" \
  SPARK_DAEMON_REGISTRY_CACHE="${telemetry_dir}/registry.json" \
  SPARK_DAEMON_REGISTRY_TTL=300 \
  SPARK_DAEMON_TICK_TIMEOUT=2 \
  SPARK_DAEMON_SESSION_NAME="${spark_session}" \
  SPARK_DAEMON_PANE_UNCHANGED_TICKS=1 \
  SPARK_DAEMON_BUDGET_PER_HOUR=12 \
  SPARK_DAEMON_NOW_EPOCH="${now_epoch}" \
  SPARK_DAEMON_NOTIFY_CMD=/bin/true \
  SPARK_DAEMON_OVERMIND_SH="${TMP_ROOT}/missing-overmind.sh" \
  OVERMIND_TOKEN_FILE="${TMP_ROOT}/missing-token.env" \
    "${DAEMON_UNDER_TEST}" --once >>"${stdout_file}" 2>>"${stderr_file}"
}

run_budget_cap_test() {
  local spark_session="spark-daemon-test-b7-budget-$$"
  local child_session="spark-daemon-test-b7-child-$$"
  local telemetry_dir="${TMP_ROOT}/telemetry-budget"
  local run_dir="${TMP_ROOT}/run-budget"
  local count_file="${TMP_ROOT}/dispatch.count"
  local out_file="${TMP_ROOT}/budget.out"
  local err_file="${TMP_ROOT}/budget.err"
  local now_epoch=360000
  local dispatches

  mkdir -p "${telemetry_dir}" "${run_dir}/dispatch"
  : > "${count_file}"
  printf 'progress\n' > "${run_dir}/progress.md"
  printf 'callbacks\n' > "${run_dir}/callbacks.md"
  sleep 120 &
  WATCHER_PID=$!
  printf '%s\n' "${WATCHER_PID}" > "${run_dir}/dispatch/.watcher.pid"
  start_child_session "${child_session}"
  start_responder_session "${spark_session}" "${count_file}"
  write_registry_cache "${telemetry_dir}/registry.json" "${run_dir}" "${child_session}"
  write_state_cache "${telemetry_dir}/state.json" "${child_session}" 1

  for _ in $(seq 1 13); do
    run_once_budget_fixture "${spark_session}" "${telemetry_dir}" "${now_epoch}" "${out_file}" "${err_file}"
  done

  dispatches="$(wc -l < "${count_file}" | awk '{ print $1 }')"
  assert_eq "12" "${dispatches}" "T8 13th AMBIGUOUS skips spark dispatch"
  assert_eq "13" "$(budget_count_from_state "${telemetry_dir}/state.json")" "T8 budget counter increments past cap"
  assert_contains "${err_file}" 'action=budget-capped budget_count=13 budget_limit=12' "T8 budget-capped log emitted"

  run_once_budget_fixture "${spark_session}" "${telemetry_dir}" "$((now_epoch + 3600))" "${out_file}" "${err_file}"
  dispatches="$(wc -l < "${count_file}" | awk '{ print $1 }')"
  assert_eq "13" "${dispatches}" "budget resets after UTC hour bucket rolls"
  assert_eq "1" "$(budget_count_from_state "${telemetry_dir}/state.json")" "new hour bucket resets per-run counter"
}

run_sleep_reap_test() {
  local spark_session="spark-daemon-test-b7-sleep-$$"
  local telemetry_dir="${TMP_ROOT}/telemetry-sleep"

  mkdir -p "${telemetry_dir}"
  tmux new-session -d -s "${spark_session}" "bash --noprofile --norc -c 'sleep 120'"
  SESSIONS+=("${spark_session}")

  export SPARK_DAEMON_SOURCE_ONLY=1
  export SPARK_DAEMON_TELEMETRY_DIR="${telemetry_dir}"
  export SPARK_DAEMON_STATE_CACHE="${telemetry_dir}/state.json"
  export SPARK_DAEMON_SESSION_NAME="${spark_session}"
  export SPARK_DAEMON_TICK_BASE=1
  export SPARK_DAEMON_SLEEP_AFTER_POLLS=0
  source "${DAEMON_UNDER_TEST}"
  SLEEP_INTERVAL=2
  update_lifecycle_state 0

  assert_eq "SLEEP" "${STATE}" "T9 empty registry enters SLEEP"
  assert_eq "2" "${CURRENT_TICK_INTERVAL}" "T9 SLEEP uses slow poll interval"
  if tmux has-session -t "${spark_session}" 2>/dev/null; then
    fail "T9 spark session still alive after SLEEP reap"
  fi
  pass "T9 SLEEP reaps isolated spark session"
}

command -v tmux >/dev/null 2>&1 || fail "tmux is required for B7 tests"
bash -n "${DAEMON_UNDER_TEST}"
pass "daemon bash -n clean"
run_budget_cap_test
run_sleep_reap_test
