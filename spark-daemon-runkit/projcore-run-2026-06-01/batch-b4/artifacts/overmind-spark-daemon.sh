#!/usr/bin/env bash
set -euo pipefail

TELEMETRY_DIR="${SPARK_DAEMON_TELEMETRY_DIR:-${HOME}/.claude/agents/telemetry}"
PID_FILE="${SPARK_DAEMON_PID_FILE:-${TELEMETRY_DIR}/overmind-spark-daemon.pid}"
STATE_CACHE_FILE="${SPARK_DAEMON_STATE_CACHE:-${TELEMETRY_DIR}/spark-daemon-state.json}"
SPARK_DAEMON_TICK_BASE="${SPARK_DAEMON_TICK_BASE:-30}"
SPARK_DAEMON_PANE_UNCHANGED_TICKS="${SPARK_DAEMON_PANE_UNCHANGED_TICKS:-4}"
SPARK_DAEMON_PROGRESS_STALE_MIN="${SPARK_DAEMON_PROGRESS_STALE_MIN:-30}"
SPARK_DAEMON_PROGRESS_FRESH_MIN="${SPARK_DAEMON_PROGRESS_FRESH_MIN:-5}"
SPARK_DAEMON_OVERMIND_SH="${SPARK_DAEMON_OVERMIND_SH:-${HOME}/.claude/agents/lib/overmind.sh}"
SPARK_DAEMON_NOTIFY_URL="${SPARK_DAEMON_NOTIFY_URL:-http://127.0.0.1:8701/notify}"
SPARK_DAEMON_NOTIFY_CMD="${SPARK_DAEMON_NOTIFY_CMD:-}"
STATE="AWAKE"
SLEEP_INTERVAL=300
RUN_ONCE=0
SLEEP_PID=""

usage() {
  cat <<'USAGE'
overmind-spark-daemon.sh

Verb / option table:
  default mode                  Run as a long-lived daemon loop until SIGTERM, SIGINT, or kernel termination.
  --once                        Run one tick across active runs, then exit 0.
  --help                        Print this verb / option table.
  SPARK_DAEMON_TICK_BASE=<sec>  Seconds between default-mode ticks; default: 30.

State scaffold:
  STATE=AWAKE
  SLEEP_INTERVAL=300
USAGE
}

timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

spark_hash_text() {
  sha256sum | awk '{ print $1 }'
}

spark_now_epoch() {
  date -u +%s
}

spark_cache_run_key() {
  local run_id="$1"
  local run_dir="$2"
  if [[ -n "${run_id}" ]]; then
    printf '%s\n' "${run_id}"
  else
    printf '%s\n' "${run_dir}"
  fi
}

spark_state_get_run_field() {
  local run_key="$1"
  local field="$2"
  local default_value="${3:-}"
  python3 - "$STATE_CACHE_FILE" "$run_key" "$field" "$default_value" <<'PY'
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
if value is None:
    print(default)
else:
    print(value)
PY
}

spark_state_get_pane_hash() {
  local run_key="$1"
  local session="$2"
  python3 - "$STATE_CACHE_FILE" "$run_key" "$session" <<'PY'
import json
import sys

path, run_key, session = sys.argv[1:4]
try:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
except Exception:
    raise SystemExit(0)

print(data.get("runs", {}).get(run_key, {}).get("last_pane_hashes", {}).get(session, ""))
PY
}

spark_state_get_unchanged_ticks() {
  local run_key="$1"
  local session="$2"
  python3 - "$STATE_CACHE_FILE" "$run_key" "$session" <<'PY'
import json
import sys

path, run_key, session = sys.argv[1:4]
try:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
except Exception:
    print("0")
    raise SystemExit(0)

print(data.get("runs", {}).get(run_key, {}).get("unchanged_ticks", {}).get(session, 0))
PY
}

spark_write_run_cache() {
  local run_key="$1"
  local callbacks_count="$2"
  local head="$3"
  local classification="$4"
  local pane_hash_pairs="$5"
  local unchanged_tick_pairs="$6"
  local now
  local cache_dir
  local tmp_file

  now="$(timestamp)"
  cache_dir="$(dirname "${STATE_CACHE_FILE}")"
  mkdir -p "${cache_dir}"
  tmp_file="$(mktemp "${cache_dir}/spark-daemon-state.json.tmp.XXXXXX")"

  SPARK_PANE_HASH_PAIRS="${pane_hash_pairs}" \
  SPARK_UNCHANGED_TICK_PAIRS="${unchanged_tick_pairs}" \
  python3 - "$STATE_CACHE_FILE" "$tmp_file" "$run_key" "$callbacks_count" "$head" "$classification" "$now" <<'PY'
import json
import os
import sys

cache_path, tmp_path, run_key, callbacks_count, head, classification, now = sys.argv[1:8]

def parse_pairs(raw):
    parsed = {}
    for line in raw.splitlines():
        if not line:
            continue
        key, _, value = line.partition("\t")
        if key:
            parsed[key] = value
    return parsed

try:
    with open(cache_path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
except Exception:
    data = {}

if not isinstance(data, dict):
    data = {}
runs = data.setdefault("runs", {})
run_state = runs.setdefault(run_key, {})

run_state["last_pane_hashes"] = parse_pairs(os.environ.get("SPARK_PANE_HASH_PAIRS", ""))
run_state["last_callbacks_line_count"] = int(callbacks_count or 0)
run_state["last_head"] = head
run_state["unchanged_ticks"] = {
    key: int(value or 0)
    for key, value in parse_pairs(os.environ.get("SPARK_UNCHANGED_TICK_PAIRS", "")).items()
}
run_state["last_classification"] = classification
run_state["last_tick"] = now

with open(tmp_path, "w", encoding="utf-8") as handle:
    json.dump(data, handle, sort_keys=True, indent=2)
    handle.write("\n")
PY

  mv "${tmp_file}" "${STATE_CACHE_FILE}"
}

spark_signal_session_alive() {
  local session="$1"
  tmux has-session -t "${session}" 2>/dev/null
}

spark_capture_pane() {
  local session="$1"
  tmux capture-pane -J -p -t "${session}" 2>/dev/null || true
}

spark_signal_pane_hash() {
  local session="$1"
  spark_capture_pane "${session}" | spark_hash_text
}

spark_signal_busy_marker() {
  grep -Eq 'esc to interrupt|Working \(|Waiting for|Compacting|Thinking|Worked for'
}

spark_signal_active_busy_marker() {
  grep -Eq 'esc to interrupt|Working \(|Waiting for|Compacting|Thinking'
}

spark_signal_worked_for_marker() {
  grep -Eq 'Worked for'
}

spark_signal_watcher_alive() {
  local run_dir="$1"
  local pid_file="${run_dir}/dispatch/.watcher.pid"
  local watcher_pid

  [[ -s "${pid_file}" ]] || return 1
  watcher_pid="$(awk 'NF { print $1; exit }' "${pid_file}" 2>/dev/null || true)"
  [[ -n "${watcher_pid}" ]] || return 1
  kill -0 "${watcher_pid}" 2>/dev/null
}

spark_signal_progress_age_seconds() {
  local run_dir="$1"
  local progress_file="${run_dir}/progress.md"
  local now
  local mtime

  [[ -e "${progress_file}" ]] || {
    printf -- '-1\n'
    return 0
  }

  now="$(spark_now_epoch)"
  mtime="$(stat -c %Y "${progress_file}" 2>/dev/null || printf '0')"
  printf '%s\n' "$((now - mtime))"
}

spark_signal_callbacks_count() {
  local run_dir="$1"
  local callbacks_file="${run_dir}/callbacks.md"

  [[ -e "${callbacks_file}" ]] || {
    printf '0\n'
    return 0
  }
  wc -l < "${callbacks_file}" | awk '{ print $1 }'
}

spark_signal_git_head() {
  local run_dir="$1"
  git -C "${run_dir}" rev-parse HEAD 2>/dev/null || true
}

spark_classify_run_signals() {
  local session_dead="$1"
  local watcher_alive="$2"
  local pane_changed="$3"
  local active_busy_marker="$4"
  local worked_for_marker="$5"
  local progress_fresh="$6"
  local progress_stale="$7"
  local callbacks_delta="$8"
  local head_delta="$9"
  local unchanged_ticks="${10}"
  local unchanged_threshold="${11:-${SPARK_DAEMON_PANE_UNCHANGED_TICKS}}"

  if [[ "${session_dead}" == "1" || "${watcher_alive}" != "1" ]]; then
    printf 'CRASHED\n'
    return 0
  fi

  if [[ "${pane_changed}" == "1" ]]; then
    printf 'HEALTHY\n'
    return 0
  fi

  if [[ "${progress_fresh}" == "1" ]] && (( unchanged_ticks < unchanged_threshold )); then
    printf 'HEALTHY\n'
    return 0
  fi

  if [[ "${worked_for_marker}" == "1" && "${active_busy_marker}" == "0" && "${progress_fresh}" == "0" ]]; then
    printf 'IDLE-CLEAN\n'
    return 0
  fi

  if (( unchanged_ticks >= unchanged_threshold )) && [[ "${progress_stale}" == "1" || "${active_busy_marker}" == "1" || "${progress_fresh}" == "1" ]]; then
    printf 'AMBIGUOUS\n'
    return 0
  fi

  printf 'AMBIGUOUS\n'
}

spark_reason_for_classification() {
  local classification="$1"
  local session_dead="$2"
  local watcher_alive="$3"
  local pane_changed="$4"
  local active_busy_marker="$5"
  local worked_for_marker="$6"
  local progress_fresh="$7"
  local progress_stale="$8"
  local callbacks_delta="$9"
  local head_delta="${10}"
  local unchanged_ticks="${11}"

  case "${classification}" in
    CRASHED)
      if [[ "${session_dead}" == "1" && "${watcher_alive}" != "1" ]]; then
        printf 'registered session dead and watcher pid dead'
      elif [[ "${session_dead}" == "1" ]]; then
        printf 'registered session dead'
      else
        printf 'watcher pid dead'
      fi
      ;;
    AMBIGUOUS)
      printf 'ambiguous tier-1 signals: pane_changed=%s active_busy=%s worked_for=%s progress_fresh=%s progress_stale=%s callbacks_delta=%s head_delta=%s unchanged_ticks=%s' \
        "${pane_changed}" "${active_busy_marker}" "${worked_for_marker}" "${progress_fresh}" "${progress_stale}" "${callbacks_delta}" "${head_delta}" "${unchanged_ticks}"
      ;;
    IDLE-CLEAN)
      printf 'worked-for marker present with no active busy marker and no fresh progress'
      ;;
    HEALTHY)
      printf 'healthy tier-1 signals'
      ;;
    ALERT-MEDIUM|ALERT-HARD|ALERT-SOFT)
      printf 'tier-2 verdict %s' "${classification}"
      ;;
    *)
      printf 'classification %s' "${classification}"
      ;;
  esac
}

spark_append_alert_callback() {
  local run_id="$1"
  local run_dir="$2"
  local severity="$3"
  local reason="$4"
  local callbacks_file="${run_dir}/callbacks.md"

  mkdir -p "$(dirname "${callbacks_file}")"
  printf '[projcore SPARK-DAEMON-%s] %s %s\n' "${severity}" "${run_id}" "${reason}" >> "${callbacks_file}"
}

spark_notification_project() {
  local run_dir="$1"
  local root

  root="$(git -C "${run_dir}" rev-parse --show-toplevel 2>/dev/null || true)"
  [[ -n "${root}" ]] || root="${run_dir}"
  basename "${root}"
}

spark_send_urgent_notification() {
  local run_id="$1"
  local run_dir="$2"
  local reason="$3"
  local project
  local payload

  project="$(spark_notification_project "${run_dir}")"
  payload="$(python3 - "$project" "$run_id" "$run_dir" "$reason" <<'PY'
import json
import sys

project, run_id, run_dir, reason = sys.argv[1:5]
message = (
    f"\U0001f6a8 URGENT · {project} · spark-daemon\n\n"
    f"\u2753 Spark daemon detected a crashed projcore run.\n"
    f"Question: Recover run {run_id}.\n"
    f"Why you: Tier-1 classified CRASHED: {reason}.\n"
    f"If unanswered: daemon keeps monitoring; no automatic recovery runs.\n"
    f"Where: {run_dir}/callbacks.md"
)
print(json.dumps({
    "name": "spark-daemon",
    "project": project,
    "model": "gpt-5.3-codex-spark",
    "message": message,
}))
PY
)"

  if [[ -n "${SPARK_DAEMON_NOTIFY_CMD}" ]]; then
    printf '%s\n' "${payload}" | "${SPARK_DAEMON_NOTIFY_CMD}" >/dev/null 2>&1 || true
  else
    curl -sS -X POST "${SPARK_DAEMON_NOTIFY_URL}" \
      -H "Content-Type: application/json" \
      -d "${payload}" >/dev/null 2>&1 || true
  fi
}

spark_fire_stall_alert() {
  local run_dir="$1"
  local reason="$2"

  [[ -x "${SPARK_DAEMON_OVERMIND_SH}" ]] || return 0
  "${SPARK_DAEMON_OVERMIND_SH}" stall-alert "${reason}" --run-dir "${run_dir}" >/dev/null 2>&1 || true
}

spark_apply_classification_action() {
  local run_id="$1"
  local run_dir="$2"
  local classification="$3"
  local reason="$4"
  local run_key

  run_key="$(spark_cache_run_key "${run_id}" "${run_dir}")"
  case "${classification}" in
    CRASHED|ALERT-HARD)
      spark_append_alert_callback "${run_key}" "${run_dir}" "HARD" "${reason}"
      spark_fire_stall_alert "${run_dir}" "${reason}"
      spark_send_urgent_notification "${run_key}" "${run_dir}" "${reason}"
      ;;
    ALERT-MEDIUM)
      spark_append_alert_callback "${run_key}" "${run_dir}" "MEDIUM" "${reason}"
      ;;
    *)
      return 0
      ;;
  esac
}

spark_collect_run_signals() {
  local run_id="$1"
  local run_dir="$2"
  shift 2

  local run_key
  local watcher_alive=0
  local session_dead=0
  local any_pane_changed=0
  local any_active_busy=0
  local any_busy=0
  local any_worked_for=0
  local max_unchanged_ticks=0
  local callbacks_count
  local previous_callbacks_count
  local callbacks_delta=0
  local head
  local previous_head
  local head_delta=0
  local progress_age
  local progress_fresh=0
  local progress_stale=1
  local classification
  local reason
  local pane_hash_pairs=""
  local unchanged_tick_pairs=""
  local stale_seconds
  local fresh_seconds

  run_key="$(spark_cache_run_key "${run_id}" "${run_dir}")"

  if spark_signal_watcher_alive "${run_dir}"; then
    watcher_alive=1
  fi

  progress_age="$(spark_signal_progress_age_seconds "${run_dir}")"
  stale_seconds=$((SPARK_DAEMON_PROGRESS_STALE_MIN * 60))
  fresh_seconds=$((SPARK_DAEMON_PROGRESS_FRESH_MIN * 60))
  if (( progress_age >= 0 && progress_age < fresh_seconds )); then
    progress_fresh=1
  fi
  if (( progress_age >= 0 && progress_age <= stale_seconds )); then
    progress_stale=0
  fi

  callbacks_count="$(spark_signal_callbacks_count "${run_dir}")"
  previous_callbacks_count="$(spark_state_get_run_field "${run_key}" "last_callbacks_line_count" "0")"
  if (( callbacks_count > previous_callbacks_count )); then
    callbacks_delta=1
  fi

  head="$(spark_signal_git_head "${run_dir}")"
  previous_head="$(spark_state_get_run_field "${run_key}" "last_head" "")"
  if [[ -n "${head}" && -n "${previous_head}" && "${head}" != "${previous_head}" ]]; then
    head_delta=1
  fi

  local session
  for session in "$@"; do
    local pane=""
    local pane_hash=""
    local previous_pane_hash=""
    local unchanged_ticks=0

    if ! spark_signal_session_alive "${session}"; then
      session_dead=1
      continue
    fi

    pane="$(spark_capture_pane "${session}")"
    pane_hash="$(spark_signal_pane_hash "${session}")"
    previous_pane_hash="$(spark_state_get_pane_hash "${run_key}" "${session}")"

    if [[ -n "${previous_pane_hash}" && "${pane_hash}" == "${previous_pane_hash}" ]]; then
      unchanged_ticks="$(spark_state_get_unchanged_ticks "${run_key}" "${session}")"
      unchanged_ticks=$((unchanged_ticks + 1))
    else
      unchanged_ticks=0
      if [[ -n "${previous_pane_hash}" ]]; then
        any_pane_changed=1
      fi
    fi

    if (( unchanged_ticks > max_unchanged_ticks )); then
      max_unchanged_ticks="${unchanged_ticks}"
    fi

    if printf '%s\n' "${pane}" | spark_signal_busy_marker; then
      any_busy=1
    fi
    if printf '%s\n' "${pane}" | spark_signal_active_busy_marker; then
      any_active_busy=1
    fi
    if printf '%s\n' "${pane}" | spark_signal_worked_for_marker; then
      any_worked_for=1
    fi

    pane_hash_pairs+="${session}"$'\t'"${pane_hash}"$'\n'
    unchanged_tick_pairs+="${session}"$'\t'"${unchanged_ticks}"$'\n'
  done

  classification="$(spark_classify_run_signals \
    "${session_dead}" \
    "${watcher_alive}" \
    "${any_pane_changed}" \
    "${any_active_busy}" \
    "${any_worked_for}" \
    "${progress_fresh}" \
    "${progress_stale}" \
    "${callbacks_delta}" \
    "${head_delta}" \
    "${max_unchanged_ticks}" \
    "${SPARK_DAEMON_PANE_UNCHANGED_TICKS}")"
  reason="$(spark_reason_for_classification \
    "${classification}" \
    "${session_dead}" \
    "${watcher_alive}" \
    "${any_pane_changed}" \
    "${any_active_busy}" \
    "${any_worked_for}" \
    "${progress_fresh}" \
    "${progress_stale}" \
    "${callbacks_delta}" \
    "${head_delta}" \
    "${max_unchanged_ticks}")"

  spark_write_run_cache "${run_key}" "${callbacks_count}" "${head}" "${classification}" "${pane_hash_pairs}" "${unchanged_tick_pairs}"
  if [[ "${SPARK_DAEMON_SOURCE_ONLY:-0}" != "1" ]]; then
    spark_apply_classification_action "${run_id}" "${run_dir}" "${classification}" "${reason}"
  fi

  cat <<EOF
run_key=${run_key}
classification=${classification}
reason=${reason}
session_dead=${session_dead}
watcher_alive=${watcher_alive}
pane_changed=${any_pane_changed}
busy_marker=${any_busy}
active_busy_marker=${any_active_busy}
worked_for_marker=${any_worked_for}
progress_age=${progress_age}
progress_fresh=${progress_fresh}
progress_stale=${progress_stale}
callbacks_delta=${callbacks_delta}
head_delta=${head_delta}
unchanged_ticks=${max_unchanged_ticks}
EOF
}

write_pid_file() {
  local now
  now="$(timestamp)"
  : > "${PID_FILE}"
  {
    printf 'pid=%s\n' "$$"
    printf 'last_tick=%s\n' "${now}"
    printf 'state=%s\n' "${STATE}"
  } > "${PID_FILE}"
}

read_pid_file_pid() {
  awk -F= '$1 == "pid" { print $2; exit }' "${PID_FILE}" 2>/dev/null || true
}

acquire_singleton_lock() {
  mkdir -p "${TELEMETRY_DIR}"
  touch "${PID_FILE}"
  exec 9<>"${PID_FILE}"

  if ! flock -n 9; then
    local existing_pid
    existing_pid="$(read_pid_file_pid)"
    if [[ -n "${existing_pid}" ]] && kill -0 "${existing_pid}" 2>/dev/null; then
      exit 0
    fi
    exit 0
  fi
}

list_active_runs() {
  return 0
}

log_tick() {
  printf '%s tick\n' "$(timestamp)"
}

do_tick() {
  list_active_runs >/dev/null
  write_pid_file
  log_tick
}

handle_shutdown() {
  if [[ -n "${SLEEP_PID}" ]] && kill -0 "${SLEEP_PID}" 2>/dev/null; then
    kill "${SLEEP_PID}" 2>/dev/null || true
  fi
  exit 0
}

sleep_between_ticks() {
  sleep "${SPARK_DAEMON_TICK_BASE}" &
  SLEEP_PID=$!
  wait "${SLEEP_PID}" || true
  SLEEP_PID=""
}

main_loop() {
  while true; do
    do_tick || true
    sleep_between_ticks
  done
}

main() {
  while (($#)); do
    case "$1" in
      --once)
        RUN_ONCE=1
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        printf 'Unknown option: %s\n\n' "$1" >&2
        usage >&2
        exit 2
        ;;
    esac
    shift
  done

  acquire_singleton_lock
  trap handle_shutdown TERM INT
  write_pid_file

  if [[ "${RUN_ONCE}" == "1" ]]; then
    do_tick
    exit 0
  fi

  main_loop
}

if [[ "${SPARK_DAEMON_SOURCE_ONLY:-0}" != "1" ]]; then
  main "$@"
fi
