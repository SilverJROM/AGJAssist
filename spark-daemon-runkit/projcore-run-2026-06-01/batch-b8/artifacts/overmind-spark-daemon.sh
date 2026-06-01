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
SPARK_DAEMON_REGISTRY_TTL="${SPARK_DAEMON_REGISTRY_TTL:-30}"
SPARK_DAEMON_REGISTRY_CACHE="${SPARK_DAEMON_REGISTRY_CACHE:-${TELEMETRY_DIR}/spark-daemon-registry.json}"
SPARK_DAEMON_REGISTRY_CURL_TIMEOUT="${SPARK_DAEMON_REGISTRY_CURL_TIMEOUT:-5}"
SPARK_DAEMON_SLEEP_AFTER_MIN="${SPARK_DAEMON_SLEEP_AFTER_MIN:-5}"
SPARK_DAEMON_TICK_TIMEOUT="${SPARK_DAEMON_TICK_TIMEOUT:-60}"
SPARK_DAEMON_SESSION_NAME="${SPARK_DAEMON_SESSION_NAME:-spark-daemon}"
SPARK_DAEMON_MODEL="${SPARK_DAEMON_MODEL:-gpt-5.3-codex-spark}"
SPARK_DAEMON_CODEX_CMD="${SPARK_DAEMON_CODEX_CMD:-codex --model ${SPARK_DAEMON_MODEL} --dangerously-bypass-approvals-and-sandbox}"
SPARK_DAEMON_BUDGET_PER_HOUR="${SPARK_DAEMON_BUDGET_PER_HOUR:-12}"
SPARK_DAEMON_EVENT_LOG="${SPARK_DAEMON_EVENT_LOG:-${TELEMETRY_DIR}/spark-daemon-events.log}"
SPARK_DAEMON_EVENT_LOG_MAX_BYTES="${SPARK_DAEMON_EVENT_LOG_MAX_BYTES:-52428800}"
SPARK_DAEMON_DB="${SPARK_DAEMON_DB:-${TELEMETRY_DIR}/projcore.db}"
OVERMIND_URL="${OVERMIND_URL:-http://127.0.0.1:3101}"
OVERMIND_TOKEN_FILE="${OVERMIND_TOKEN_FILE:-/home/agjrom/TGBOTS/AGJAssist/.env}"
STATE="AWAKE"
SLEEP_INTERVAL="${SLEEP_INTERVAL:-300}"
CURRENT_TICK_INTERVAL="${SPARK_DAEMON_TICK_BASE}"
EMPTY_POLLS=0
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
  SPARK_DAEMON_REGISTRY_TTL=<s> Cache active-run registry responses; default: 30.
  SPARK_DAEMON_SLEEP_AFTER_MIN=<m>
                                Empty-registry minutes before slow poll; default: 5.
  SPARK_DAEMON_TICK_TIMEOUT=<s>
                                Seconds to wait for Tier-2 spark verdict; default: 60.
  SPARK_DAEMON_SESSION_NAME=<s>
                                Tier-2 tmux session name; default: spark-daemon.

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
  if [[ -n "${SPARK_DAEMON_NOW_EPOCH:-}" ]]; then
    printf '%s\n' "${SPARK_DAEMON_NOW_EPOCH}"
    return 0
  fi
  date -u +%s
}

spark_log() {
  printf '%s %s\n' "$(timestamp)" "$*" >&2
}

spark_rotate_event_log_if_needed() {
  local log_file="${SPARK_DAEMON_EVENT_LOG}"
  local max_bytes="${SPARK_DAEMON_EVENT_LOG_MAX_BYTES}"
  local size_bytes

  [[ -n "${log_file}" ]] || return 0
  [[ "${max_bytes}" =~ ^[0-9]+$ ]] || max_bytes=52428800
  [[ -f "${log_file}" ]] || return 0

  size_bytes="$(wc -c < "${log_file}" 2>/dev/null | awk '{ print $1 }')" || return 0
  if (( size_bytes > max_bytes )); then
    mv -f "${log_file}" "${log_file}.1" 2>/dev/null || return 0
  fi
}

spark_append_event_log() {
  local ts="$1"
  local run_id="$2"
  local tier="$3"
  local classification="$4"
  local action="$5"
  local spark_used="$6"
  local reason="$7"
  local log_file="${SPARK_DAEMON_EVENT_LOG}"

  [[ -n "${log_file}" ]] || return 0
  mkdir -p "$(dirname "${log_file}")" 2>/dev/null || return 1
  spark_rotate_event_log_if_needed
  python3 - "${log_file}" "${ts}" "${run_id}" "${tier}" "${classification}" "${action}" "${spark_used}" "${reason}" <<'PY'
import json
import sys

path, ts, run_id, tier, classification, action, spark_used, reason = sys.argv[1:9]
event = {
    "ts": int(ts),
    "run_id": run_id,
    "tier": int(tier),
    "classification": classification,
    "action": action,
    "spark_used": int(spark_used),
    "reason": reason,
}
with open(path, "a", encoding="utf-8") as handle:
    handle.write(json.dumps(event, separators=(",", ":"), sort_keys=True))
    handle.write("\n")
PY
}

spark_insert_tick_row() {
  local ts="$1"
  local run_id="$2"
  local tier="$3"
  local classification="$4"
  local action="$5"
  local spark_used="$6"
  local reason="$7"
  local db_path="${SPARK_DAEMON_DB}"

  [[ -n "${db_path}" ]] || return 0
  mkdir -p "$(dirname "${db_path}")" 2>/dev/null || return 1
  python3 - "${db_path}" "${ts}" "${run_id}" "${tier}" "${classification}" "${action}" "${spark_used}" "${reason}" <<'PY'
import sqlite3
import sys

db_path, ts, run_id, tier, classification, action, spark_used, reason = sys.argv[1:9]
with sqlite3.connect(db_path) as conn:
    conn.execute(
        "CREATE TABLE IF NOT EXISTS spark_daemon_ticks "
        "(ts INTEGER, run_id TEXT, tier INTEGER, classification TEXT, action TEXT, spark_used INTEGER, reason TEXT)"
    )
    conn.execute(
        "INSERT INTO spark_daemon_ticks "
        "(ts, run_id, tier, classification, action, spark_used, reason) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (int(ts), run_id, int(tier), classification, action, int(spark_used), reason),
    )
PY
}

spark_record_tick() {
  local run_id="$1"
  local tier="$2"
  local classification="$3"
  local action="$4"
  local spark_used="$5"
  local reason="$6"
  local ts

  ts="$(spark_now_epoch)"
  if ! spark_append_event_log "${ts}" "${run_id}" "${tier}" "${classification}" "${action}" "${spark_used}" "${reason}"; then
    spark_log "telemetry event-log write failed run=${run_id} classification=${classification}"
  fi
  if ! spark_insert_tick_row "${ts}" "${run_id}" "${tier}" "${classification}" "${action}" "${spark_used}" "${reason}"; then
    spark_log "telemetry sqlite write failed run=${run_id} classification=${classification}"
  fi
}

spark_action_for_classification() {
  local classification="$1"

  case "${classification}" in
    CRASHED|ALERT-HARD)
      printf 'alert-hard\n'
      ;;
    ALERT-MEDIUM)
      printf 'alert-medium\n'
      ;;
    AMBIGUOUS)
      printf 'escalate-to-tier2\n'
      ;;
    *)
      printf 'no-op\n'
      ;;
  esac
}

read_overmind_token() {
  if [[ -n "${_OVERMIND_TOKEN:-}" ]]; then
    printf '%s' "${_OVERMIND_TOKEN}"
    return 0
  fi
  if [[ ! -r "${OVERMIND_TOKEN_FILE}" ]]; then
    _OVERMIND_TOKEN=""
    return 0
  fi
  _OVERMIND_TOKEN="$(grep -E '^OVERMIND_TOKEN=' "${OVERMIND_TOKEN_FILE}" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"' \r\n')"
  printf '%s' "${_OVERMIND_TOKEN}"
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

spark_record_ambiguous_budget() {
  local run_key="$1"
  local now_epoch
  local bucket
  local limit
  local cache_dir
  local tmp_file

  now_epoch="$(spark_now_epoch)"
  bucket=$((now_epoch / 3600))
  limit="${SPARK_DAEMON_BUDGET_PER_HOUR}"
  cache_dir="$(dirname "${STATE_CACHE_FILE}")"
  mkdir -p "${cache_dir}"
  tmp_file="$(mktemp "${cache_dir}/spark-daemon-state.json.tmp.XXXXXX")"

  if ! python3 - "$STATE_CACHE_FILE" "$tmp_file" "$run_key" "$bucket" "$limit" <<'PY'
import json
import os
import sys

cache_path, tmp_path, run_key, bucket_raw, limit_raw = sys.argv[1:6]
try:
    bucket = int(bucket_raw)
except Exception:
    bucket = 0
try:
    limit = int(limit_raw)
except Exception:
    limit = 12
if limit < 1:
    limit = 1

try:
    with open(cache_path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
except Exception:
    data = {}

if not isinstance(data, dict):
    data = {}
runs = data.setdefault("runs", {})
run_state = runs.setdefault(run_key, {})
budget = run_state.setdefault("spark_budget", {})
previous_bucket = budget.get("hour_bucket")
if previous_bucket != bucket:
    count = 0
else:
    try:
        count = int(budget.get("count", 0))
    except Exception:
        count = 0
count += 1
budget["hour_bucket"] = bucket
budget["count"] = count
budget["limit"] = limit
budget["action"] = "budget-capped" if count > limit else "dispatch"

with open(tmp_path, "w", encoding="utf-8") as handle:
    json.dump(data, handle, sort_keys=True, indent=2)
    handle.write("\n")

print(f"budget_bucket={bucket}")
print(f"budget_count={count}")
print(f"budget_limit={limit}")
print(f"action={budget['action']}")
PY
  then
    rm -f "${tmp_file}"
    printf 'budget_bucket=%s\n' "${bucket}"
    printf 'budget_count=1\n'
    printf 'budget_limit=%s\n' "${limit}"
    printf 'action=dispatch\n'
    return 0
  fi

  mv "${tmp_file}" "${STATE_CACHE_FILE}"
}

spark_reap_session_on_sleep() {
  if tmux has-session -t "${SPARK_DAEMON_SESSION_NAME}" 2>/dev/null; then
    tmux kill-session -t "${SPARK_DAEMON_SESSION_NAME}" 2>/dev/null || true
    spark_log "registry empty; action=spark-session-reaped session=${SPARK_DAEMON_SESSION_NAME}"
  fi
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

spark_collapse_one_line() {
  tr '\n' ' ' | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//'
}

spark_signal_value() {
  local signals="$1"
  local key="$2"
  awk -F= -v key="${key}" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' <<< "${signals}"
}

spark_tail_file_one_line() {
  local file="$1"
  local lines="${2:-30}"

  if [[ ! -r "${file}" ]]; then
    printf '<missing>'
    return 0
  fi
  tail -n "${lines}" "${file}" 2>/dev/null | spark_collapse_one_line
}

spark_tail_pane_one_line() {
  local session="$1"
  local lines="${2:-30}"

  tmux capture-pane -J -p -S "-${lines}" -t "${session}" 2>/dev/null | spark_collapse_one_line || printf '<capture-failed>'
}

spark_join_sessions() {
  local first=1
  local session

  for session in "$@"; do
    if (( first )); then
      first=0
    else
      printf ','
    fi
    printf '%s' "${session}"
  done
}

spark_spawn_session_if_needed() {
  if tmux has-session -t "${SPARK_DAEMON_SESSION_NAME}" 2>/dev/null; then
    return 0
  fi

  tmux new-session -d -s "${SPARK_DAEMON_SESSION_NAME}"
  tmux send-keys -t "${SPARK_DAEMON_SESSION_NAME}" "${SPARK_DAEMON_CODEX_CMD}"
  tmux send-keys -t "${SPARK_DAEMON_SESSION_NAME}" C-m
  tmux capture-pane -p -t "${SPARK_DAEMON_SESSION_NAME}" >/dev/null 2>&1 || true
}

spark_send_submit_capture() {
  local text="$1"

  tmux send-keys -t "${SPARK_DAEMON_SESSION_NAME}" "${text}"
  tmux send-keys -t "${SPARK_DAEMON_SESSION_NAME}" C-m
  tmux capture-pane -p -t "${SPARK_DAEMON_SESSION_NAME}" >/dev/null 2>&1 || true
}

spark_build_tier2_brief() {
  local run_id="$1"
  local run_dir="$2"
  local signals="$3"
  shift 3

  local run_key
  local sessions_csv
  local pane_tails=""
  local session
  local reason
  local progress_tail
  local callbacks_tail

  run_key="$(spark_cache_run_key "${run_id}" "${run_dir}")"
  sessions_csv="$(spark_join_sessions "$@")"
  reason="$(spark_signal_value "${signals}" "reason")"
  progress_tail="$(spark_tail_file_one_line "${run_dir}/progress.md" 30)"
  callbacks_tail="$(spark_tail_file_one_line "${run_dir}/callbacks.md" 30)"

  for session in "$@"; do
    pane_tails+=" [${session}] $(spark_tail_pane_one_line "${session}" 30)"
  done

  printf 'Spark Tier-2 watchdog tick. run_id=%s run_dir=%s child_sessions=%s tier1_classification=AMBIGUOUS ambiguous_reason=%s signals={session_dead=%s watcher_alive=%s pane_changed=%s busy_marker=%s active_busy_marker=%s worked_for_marker=%s progress_age=%s progress_fresh=%s progress_stale=%s callbacks_delta=%s head_delta=%s unchanged_ticks=%s} pane_tails=%s progress_tail=%s callbacks_tail=%s Job: judge whether this run is HEALTHY or STUCK; classify as HEALTHY, ALERT-SOFT, ALERT-MEDIUM, or ALERT-HARD. Reply with one line ending in exactly: STATUS: SPARK-TICK-DONE <CLASS> <one-line reason>.' \
    "${run_key}" \
    "${run_dir}" \
    "${sessions_csv:-<none>}" \
    "${reason}" \
    "$(spark_signal_value "${signals}" "session_dead")" \
    "$(spark_signal_value "${signals}" "watcher_alive")" \
    "$(spark_signal_value "${signals}" "pane_changed")" \
    "$(spark_signal_value "${signals}" "busy_marker")" \
    "$(spark_signal_value "${signals}" "active_busy_marker")" \
    "$(spark_signal_value "${signals}" "worked_for_marker")" \
    "$(spark_signal_value "${signals}" "progress_age")" \
    "$(spark_signal_value "${signals}" "progress_fresh")" \
    "$(spark_signal_value "${signals}" "progress_stale")" \
    "$(spark_signal_value "${signals}" "callbacks_delta")" \
    "$(spark_signal_value "${signals}" "head_delta")" \
    "$(spark_signal_value "${signals}" "unchanged_ticks")" \
    "${pane_tails:-<none>}" \
    "${progress_tail}" \
    "${callbacks_tail}"
}

spark_normalize_tier2_class() {
  local line="$1"

  if grep -Eq 'ALERT-HARD|STUCK' <<< "${line}"; then
    printf 'ALERT-HARD\n'
  elif grep -Eq 'ALERT-MEDIUM' <<< "${line}"; then
    printf 'ALERT-MEDIUM\n'
  elif grep -Eq 'ALERT-SOFT' <<< "${line}"; then
    printf 'ALERT-SOFT\n'
  elif grep -Eq 'HEALTHY|CLEAR' <<< "${line}"; then
    printf 'HEALTHY\n'
  fi
}

spark_wait_for_tier2_verdict() {
  local run_key="$1"
  local deadline
  local pane
  local line
  local classification

  deadline=$(( $(spark_now_epoch) + SPARK_DAEMON_TICK_TIMEOUT ))
  while (( $(spark_now_epoch) <= deadline )); do
    pane="$(tmux capture-pane -J -p -t "${SPARK_DAEMON_SESSION_NAME}" 2>/dev/null || true)"
    line="$(grep 'STATUS: SPARK-TICK-DONE' <<< "${pane}" | grep -Ev 'Spark Tier-2 watchdog tick|Reply with|<CLASS>' | tail -1 || true)"
    if [[ -n "${line}" ]]; then
      classification="$(spark_normalize_tier2_class "${line}")"
      if [[ -n "${classification}" ]]; then
        printf 'classification=%s\n' "${classification}"
        printf 'reason=%s\n' "$(printf '%s' "${line}" | spark_collapse_one_line)"
        return 0
      fi
      printf 'classification=ALERT-SOFT\n'
      printf 'reason=unparseable spark verdict: %s\n' "$(printf '%s' "${line}" | spark_collapse_one_line)"
      return 0
    fi
    sleep 1
  done

  spark_log "Tier-2 spark timeout for ${run_key}: no STATUS: SPARK-TICK-DONE within ${SPARK_DAEMON_TICK_TIMEOUT}s"
  printf 'classification=ALERT-SOFT\n'
  printf 'reason=spark timeout after %ss waiting for STATUS: SPARK-TICK-DONE\n' "${SPARK_DAEMON_TICK_TIMEOUT}"
}

spark_run_tier2_verdict() {
  local run_id="$1"
  local run_dir="$2"
  local signals="$3"
  shift 3

  local run_key
  local brief
  local verdict
  local classification
  local reason

  run_key="$(spark_cache_run_key "${run_id}" "${run_dir}")"
  spark_spawn_session_if_needed
  spark_send_submit_capture "/clear"
  brief="$(spark_build_tier2_brief "${run_id}" "${run_dir}" "${signals}" "$@")"
  spark_send_submit_capture "${brief}"
  verdict="$(spark_wait_for_tier2_verdict "${run_key}")"
  classification="$(spark_signal_value "${verdict}" "classification")"
  reason="$(spark_signal_value "${verdict}" "reason")"
  spark_apply_classification_action "${run_id}" "${run_dir}" "${classification}" "${reason}"
  if [[ "${SPARK_DAEMON_SOURCE_ONLY:-0}" != "1" ]]; then
    spark_record_tick "${run_key}" "2" "${classification}" "$(spark_action_for_classification "${classification}")" "1" "${reason}"
  fi
  printf '%s\n' "${verdict}"
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
    if [[ "${classification}" != "AMBIGUOUS" ]]; then
      spark_record_tick "${run_key}" "1" "${classification}" "$(spark_action_for_classification "${classification}")" "0" "${reason}"
    fi
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
    printf 'tick_interval=%s\n' "${CURRENT_TICK_INTERVAL}"
    printf 'empty_polls=%s\n' "${EMPTY_POLLS}"
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

registry_cache_payload() {
  python3 - "$SPARK_DAEMON_REGISTRY_CACHE" <<'PY'
import json
import sys

path = sys.argv[1]
try:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
except Exception:
    raise SystemExit(1)

response = data.get("response")
if not isinstance(response, dict):
    raise SystemExit(1)
print(json.dumps(response))
PY
}

registry_cache_age_seconds() {
  local now
  now="$(spark_now_epoch)"
  python3 - "$SPARK_DAEMON_REGISTRY_CACHE" "$now" <<'PY'
import json
import sys

path, now = sys.argv[1], int(sys.argv[2])
try:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    fetched_at = int(data.get("fetched_at_epoch", 0))
except Exception:
    raise SystemExit(1)

if fetched_at <= 0:
    raise SystemExit(1)
print(max(0, now - fetched_at))
PY
}

registry_cache_is_fresh() {
  local age
  age="$(registry_cache_age_seconds 2>/dev/null || true)"
  [[ -n "${age}" ]] && (( age < SPARK_DAEMON_REGISTRY_TTL ))
}

write_registry_cache() {
  local response_file="$1"
  local now
  local cache_dir
  local tmp_file

  now="$(spark_now_epoch)"
  cache_dir="$(dirname "${SPARK_DAEMON_REGISTRY_CACHE}")"
  mkdir -p "${cache_dir}"
  tmp_file="$(mktemp "${cache_dir}/spark-daemon-registry.json.tmp.XXXXXX")"
  if ! python3 - "$response_file" "$tmp_file" "$now" "$(timestamp)" <<'PY'
import json
import sys

response_path, tmp_path, fetched_epoch, fetched_iso = sys.argv[1:5]
with open(response_path, "r", encoding="utf-8") as handle:
    response = json.load(handle)
if not isinstance(response, dict) or not isinstance(response.get("runs", []), list):
    raise SystemExit(1)

with open(tmp_path, "w", encoding="utf-8") as handle:
    json.dump({
        "fetched_at": fetched_iso,
        "fetched_at_epoch": int(fetched_epoch),
        "response": response,
    }, handle, sort_keys=True, indent=2)
    handle.write("\n")
PY
  then
    rm -f "${tmp_file}"
    return 1
  fi
  mv "${tmp_file}" "${SPARK_DAEMON_REGISTRY_CACHE}"
}

fetch_active_runs_registry() {
  local token
  local response_file
  local code

  token="$(read_overmind_token)"
  if [[ -z "${token}" ]]; then
    spark_log "active-runs fetch skipped: OVERMIND_TOKEN not found"
    return 1
  fi

  mkdir -p "${TELEMETRY_DIR}"
  response_file="$(mktemp "${TELEMETRY_DIR}/spark-daemon-active-runs.XXXXXX")"
  code="$(curl -sS -m "${SPARK_DAEMON_REGISTRY_CURL_TIMEOUT}" -o "${response_file}" -w '%{http_code}' \
    -H "X-Overmind-Token: ${token}" \
    "${OVERMIND_URL}/api/overmind/runs/active" 2>/dev/null || printf '000')"

  if [[ "${code}" =~ ^2 ]]; then
    if write_registry_cache "${response_file}"; then
      rm -f "${response_file}"
      return 0
    fi
    spark_log "active-runs fetch returned invalid JSON; reusing last good cache if available"
  else
    spark_log "active-runs fetch failed: http_status=${code}; reusing last good cache if available"
  fi

  rm -f "${response_file}"
  return 1
}

active_runs_registry_json() {
  if registry_cache_is_fresh; then
    registry_cache_payload
    return 0
  fi

  fetch_active_runs_registry || true
  registry_cache_payload 2>/dev/null || printf '{"runs":[]}\n'
}

list_active_runs() {
  active_runs_registry_json | python3 -c '
import json
import sys

try:
    data = json.load(sys.stdin)
except Exception:
    raise SystemExit(0)

runs = data.get("runs", [])
if not isinstance(runs, list):
    raise SystemExit(0)

for run in runs:
    if not isinstance(run, dict):
        continue
    run_id = str(run.get("run_id") or "")
    run_dir = str(run.get("run_dir") or "")
    if not run_dir:
        continue
    sessions = []
    children = run.get("children") or []
    if isinstance(children, list):
        for child in children:
            if not isinstance(child, dict):
                continue
            session = str(child.get("session") or "")
            if session:
                sessions.append(session)
    print("\t".join([run_id, run_dir, *sessions]))
'
}

log_tick() {
  printf '%s tick state=%s interval=%s empty_polls=%s\n' "$(timestamp)" "${STATE}" "${CURRENT_TICK_INTERVAL}" "${EMPTY_POLLS}"
}

sleep_after_empty_polls() {
  if [[ -n "${SPARK_DAEMON_SLEEP_AFTER_POLLS:-}" ]]; then
    printf '%s\n' "${SPARK_DAEMON_SLEEP_AFTER_POLLS}"
    return 0
  fi

  python3 - "$SPARK_DAEMON_SLEEP_AFTER_MIN" "$SPARK_DAEMON_TICK_BASE" <<'PY'
import math
import sys

minutes = float(sys.argv[1])
tick_base = max(1, int(float(sys.argv[2])))
print(max(1, math.ceil((minutes * 60) / tick_base)))
PY
}

update_lifecycle_state() {
  local active_count="$1"
  local sleep_after_polls

  if (( active_count > 0 )); then
    if [[ "${STATE}" == "SLEEP" ]]; then
      spark_log "active run found during SLEEP; waking daemon"
    fi
    STATE="AWAKE"
    EMPTY_POLLS=0
    CURRENT_TICK_INTERVAL="${SPARK_DAEMON_TICK_BASE}"
    return 0
  fi

  EMPTY_POLLS=$((EMPTY_POLLS + 1))
  sleep_after_polls="$(sleep_after_empty_polls)"
  if [[ "${STATE}" != "SLEEP" && "${EMPTY_POLLS}" -gt "${sleep_after_polls}" ]]; then
    STATE="SLEEP"
    CURRENT_TICK_INTERVAL="${SLEEP_INTERVAL}"
    spark_log "registry empty; entering SLEEP with ${SLEEP_INTERVAL}s poll interval"
    spark_reap_session_on_sleep
    return 0
  fi

  if [[ "${STATE}" == "SLEEP" ]]; then
    CURRENT_TICK_INTERVAL="${SLEEP_INTERVAL}"
  else
    CURRENT_TICK_INTERVAL="${SPARK_DAEMON_TICK_BASE}"
  fi
}

do_tick() {
  local active_runs=()
  local row

  mapfile -t active_runs < <(list_active_runs || true)
  update_lifecycle_state "${#active_runs[@]}"

  for row in "${active_runs[@]}"; do
    local fields=()
    local run_id=""
    local run_dir=""
    local sessions=()
    local signals=""
    local classification=""
    local reason=""
    local run_key=""
    local budget=""
    local budget_action=""

    IFS=$'\t' read -r -a fields <<< "${row}"
    run_id="${fields[0]:-}"
    run_dir="${fields[1]:-}"
    sessions=("${fields[@]:2}")
    [[ -n "${run_dir}" ]] || continue
    run_key="$(spark_cache_run_key "${run_id}" "${run_dir}")"
    signals="$(spark_collect_run_signals "${run_id}" "${run_dir}" "${sessions[@]}" || true)"
    classification="$(spark_signal_value "${signals}" "classification")"
    reason="$(spark_signal_value "${signals}" "reason")"
    if [[ "${classification}" == "AMBIGUOUS" ]]; then
      budget="$(spark_record_ambiguous_budget "${run_key}")"
      budget_action="$(spark_signal_value "${budget}" "action")"
      if [[ "${budget_action}" == "budget-capped" ]]; then
        spark_record_tick "${run_key}" "1" "${classification}" "budget-capped" "0" "${reason}"
        spark_log "run=${run_key} classification=AMBIGUOUS action=budget-capped budget_count=$(spark_signal_value "${budget}" "budget_count") budget_limit=$(spark_signal_value "${budget}" "budget_limit") budget_bucket=$(spark_signal_value "${budget}" "budget_bucket")"
        continue
      fi
      spark_record_tick "${run_key}" "1" "${classification}" "escalate-to-tier2" "0" "${reason}"
      spark_run_tier2_verdict "${run_id}" "${run_dir}" "${signals}" "${sessions[@]}" >/dev/null || true
    fi
  done

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
  sleep "${CURRENT_TICK_INTERVAL}" &
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
