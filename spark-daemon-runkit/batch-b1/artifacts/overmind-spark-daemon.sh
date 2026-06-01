#!/usr/bin/env bash
set -euo pipefail

TELEMETRY_DIR="${HOME}/.claude/agents/telemetry"
PID_FILE="${TELEMETRY_DIR}/overmind-spark-daemon.pid"
SPARK_DAEMON_TICK_BASE="${SPARK_DAEMON_TICK_BASE:-30}"
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

main "$@"
