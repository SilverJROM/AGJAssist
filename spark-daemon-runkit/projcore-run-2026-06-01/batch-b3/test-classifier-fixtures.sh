#!/usr/bin/env bash
set -euo pipefail

DAEMON_UNDER_TEST="${SPARK_DAEMON_UNDER_TEST:-${HOME}/.claude/agents/lib/overmind-spark-daemon.sh}"
TMP_ROOT="$(mktemp -d)"
SESSIONS=()

cleanup() {
  local session
  for session in "${SESSIONS[@]:-}"; do
    tmux kill-session -t "${session}" 2>/dev/null || true
  done
  rm -rf "${TMP_ROOT}"
}
trap cleanup EXIT

export SPARK_DAEMON_SOURCE_ONLY=1
export SPARK_DAEMON_TELEMETRY_DIR="${TMP_ROOT}/telemetry"
export SPARK_DAEMON_STATE_CACHE="${SPARK_DAEMON_TELEMETRY_DIR}/spark-daemon-state.json"
export SPARK_DAEMON_PANE_UNCHANGED_TICKS=2
export SPARK_DAEMON_PROGRESS_STALE_MIN=30
export SPARK_DAEMON_PROGRESS_FRESH_MIN=5

source "${DAEMON_UNDER_TEST}"

assert_eq() {
  local expected="$1"
  local actual="$2"
  local label="$3"

  if [[ "${expected}" != "${actual}" ]]; then
    printf 'FAIL %s: expected %q got %q\n' "${label}" "${expected}" "${actual}" >&2
    exit 1
  fi
  printf 'PASS %s\n' "${label}"
}

field_value() {
  local key="$1"
  awk -F= -v key="${key}" '$1 == key { sub(/^[^=]*=/, ""); print; exit }'
}

start_session() {
  local session="$1"
  local payload="$2"

  tmux new-session -d -s "${session}" "printf '%s\n' '${payload}'; exec sleep 3600"
  SESSIONS+=("${session}")
  sleep 0.2
}

make_run_dir() {
  local run_dir="$1"

  mkdir -p "${run_dir}/dispatch"
  printf '%s\n' "$$" > "${run_dir}/dispatch/.watcher.pid"
  printf 'initial callback\n' > "${run_dir}/callbacks.md"
  printf 'progress\n' > "${run_dir}/progress.md"
  git -C "${run_dir}" init -q
  git -C "${run_dir}" config user.email "spark-daemon-test@example.invalid"
  git -C "${run_dir}" config user.name "Spark Daemon Test"
  printf 'initial\n' > "${run_dir}/tracked.txt"
  git -C "${run_dir}" add tracked.txt
  git -C "${run_dir}" commit -q -m "initial"
}

classification="$(spark_classify_run_signals 0 1 1 0 0 0 0 0 0 0)"
assert_eq "HEALTHY" "${classification}" "direct HEALTHY when pane changed"

classification="$(spark_classify_run_signals 1 1 0 0 0 0 0 0 0 0)"
assert_eq "CRASHED" "${classification}" "direct CRASHED when session dead"

classification="$(spark_classify_run_signals 0 1 0 1 0 0 1 0 0 "${SPARK_DAEMON_PANE_UNCHANGED_TICKS}")"
assert_eq "AMBIGUOUS" "${classification}" "direct AMBIGUOUS when busy and frozen"

classification="$(spark_classify_run_signals 0 1 0 0 1 0 0 0 0 1)"
assert_eq "IDLE-CLEAN" "${classification}" "direct IDLE-CLEAN when worked-for and clean idle"

classification="$(spark_classify_run_signals 0 1 0 0 0 0 1 1 0 0)"
assert_eq "AMBIGUOUS" "${classification}" "direct callbacks-delta-only is AMBIGUOUS"

classification="$(spark_classify_run_signals 0 1 0 0 0 0 1 0 1 0)"
assert_eq "AMBIGUOUS" "${classification}" "direct HEAD-delta-only is AMBIGUOUS"

classification="$(spark_classify_run_signals 0 1 0 0 0 1 0 0 0 "${SPARK_DAEMON_PANE_UNCHANGED_TICKS}")"
assert_eq "AMBIGUOUS" "${classification}" "direct fresh progress with frozen pane is AMBIGUOUS"

classification="$(spark_classify_run_signals 0 1 0 0 1 0 1 0 0 "${SPARK_DAEMON_PANE_UNCHANGED_TICKS}")"
assert_eq "IDLE-CLEAN" "${classification}" "direct stale worked-for is IDLE-CLEAN"

healthy_run="${TMP_ROOT}/healthy-run"
healthy_session="spark-b3-healthy-$$"
make_run_dir "${healthy_run}"
start_session "${healthy_session}" "ready"
healthy_key="$(spark_cache_run_key "healthy-run" "${healthy_run}")"
healthy_head="$(spark_signal_git_head "${healthy_run}")"
spark_write_run_cache "${healthy_key}" "0" "0000000000000000000000000000000000000000" "IDLE-CLEAN" "${healthy_session}"$'\t'"previous-hash"$'\n' "${healthy_session}"$'\t'"0"$'\n'
touch -d '40 minutes ago' "${healthy_run}/progress.md"
healthy_output="$(spark_collect_run_signals "healthy-run" "${healthy_run}" "${healthy_session}")"
assert_eq "HEALTHY" "$(printf '%s\n' "${healthy_output}" | field_value classification)" "fixture HEALTHY from changed pane"
assert_eq "1" "$(printf '%s\n' "${healthy_output}" | field_value callbacks_delta)" "fixture callbacks delta"
assert_eq "1" "$(printf '%s\n' "${healthy_output}" | field_value head_delta)" "fixture git HEAD delta"
assert_eq "${healthy_head}" "$(spark_state_get_run_field "${healthy_key}" "last_head" "")" "cache stores last HEAD"

crashed_run="${TMP_ROOT}/crashed-run"
make_run_dir "${crashed_run}"
crashed_output="$(spark_collect_run_signals "crashed-run" "${crashed_run}" "spark-b3-missing-$$")"
assert_eq "CRASHED" "$(printf '%s\n' "${crashed_output}" | field_value classification)" "fixture CRASHED from missing session"

idle_run="${TMP_ROOT}/idle-run"
idle_session="spark-b3-idle-$$"
make_run_dir "${idle_run}"
start_session "${idle_session}" "Worked for 12s"
touch -d '40 minutes ago' "${idle_run}/progress.md"
idle_key="$(spark_cache_run_key "idle-run" "${idle_run}")"
idle_hash="$(spark_signal_pane_hash "${idle_session}")"
idle_count="$(spark_signal_callbacks_count "${idle_run}")"
idle_head="$(spark_signal_git_head "${idle_run}")"
spark_write_run_cache "${idle_key}" "${idle_count}" "${idle_head}" "HEALTHY" "${idle_session}"$'\t'"${idle_hash}"$'\n' "${idle_session}"$'\t'"0"$'\n'
spark_collect_run_signals "idle-run" "${idle_run}" "${idle_session}" >/dev/null
idle_output="$(spark_collect_run_signals "idle-run" "${idle_run}" "${idle_session}")"
assert_eq "IDLE-CLEAN" "$(printf '%s\n' "${idle_output}" | field_value classification)" "fixture IDLE-CLEAN"
assert_eq "1" "$(printf '%s\n' "${idle_output}" | field_value worked_for_marker)" "fixture worked-for marker"

callbacks_run="${TMP_ROOT}/callbacks-run"
callbacks_session="spark-b3-callbacks-$$"
make_run_dir "${callbacks_run}"
start_session "${callbacks_session}" "quiet"
touch -d '40 minutes ago' "${callbacks_run}/progress.md"
callbacks_key="$(spark_cache_run_key "callbacks-run" "${callbacks_run}")"
callbacks_hash="$(spark_signal_pane_hash "${callbacks_session}")"
callbacks_head="$(spark_signal_git_head "${callbacks_run}")"
spark_write_run_cache "${callbacks_key}" "0" "${callbacks_head}" "IDLE-CLEAN" "${callbacks_session}"$'\t'"${callbacks_hash}"$'\n' "${callbacks_session}"$'\t'"0"$'\n'
callbacks_output="$(spark_collect_run_signals "callbacks-run" "${callbacks_run}" "${callbacks_session}")"
assert_eq "AMBIGUOUS" "$(printf '%s\n' "${callbacks_output}" | field_value classification)" "fixture callbacks-delta-only is AMBIGUOUS"
assert_eq "1" "$(printf '%s\n' "${callbacks_output}" | field_value callbacks_delta)" "fixture callbacks delta only collected"
assert_eq "0" "$(printf '%s\n' "${callbacks_output}" | field_value head_delta)" "fixture callbacks delta only has no HEAD delta"

head_run="${TMP_ROOT}/head-run"
head_session="spark-b3-head-$$"
make_run_dir "${head_run}"
start_session "${head_session}" "quiet"
touch -d '40 minutes ago' "${head_run}/progress.md"
head_key="$(spark_cache_run_key "head-run" "${head_run}")"
head_hash="$(spark_signal_pane_hash "${head_session}")"
head_count="$(spark_signal_callbacks_count "${head_run}")"
spark_write_run_cache "${head_key}" "${head_count}" "0000000000000000000000000000000000000000" "IDLE-CLEAN" "${head_session}"$'\t'"${head_hash}"$'\n' "${head_session}"$'\t'"0"$'\n'
head_output="$(spark_collect_run_signals "head-run" "${head_run}" "${head_session}")"
assert_eq "AMBIGUOUS" "$(printf '%s\n' "${head_output}" | field_value classification)" "fixture HEAD-delta-only is AMBIGUOUS"
assert_eq "0" "$(printf '%s\n' "${head_output}" | field_value callbacks_delta)" "fixture HEAD delta only has no callbacks delta"
assert_eq "1" "$(printf '%s\n' "${head_output}" | field_value head_delta)" "fixture HEAD delta only collected"

fresh_frozen_run="${TMP_ROOT}/fresh-frozen-run"
fresh_frozen_session="spark-b3-fresh-frozen-$$"
make_run_dir "${fresh_frozen_run}"
start_session "${fresh_frozen_session}" "quiet"
fresh_frozen_key="$(spark_cache_run_key "fresh-frozen-run" "${fresh_frozen_run}")"
fresh_frozen_hash="$(spark_signal_pane_hash "${fresh_frozen_session}")"
fresh_frozen_count="$(spark_signal_callbacks_count "${fresh_frozen_run}")"
fresh_frozen_head="$(spark_signal_git_head "${fresh_frozen_run}")"
spark_write_run_cache "${fresh_frozen_key}" "${fresh_frozen_count}" "${fresh_frozen_head}" "HEALTHY" "${fresh_frozen_session}"$'\t'"${fresh_frozen_hash}"$'\n' "${fresh_frozen_session}"$'\t'"1"$'\n'
fresh_frozen_output="$(spark_collect_run_signals "fresh-frozen-run" "${fresh_frozen_run}" "${fresh_frozen_session}")"
assert_eq "AMBIGUOUS" "$(printf '%s\n' "${fresh_frozen_output}" | field_value classification)" "fixture fresh-progress frozen pane is AMBIGUOUS"
assert_eq "1" "$(printf '%s\n' "${fresh_frozen_output}" | field_value progress_fresh)" "fixture fresh-progress frozen pane has fresh progress"
assert_eq "2" "$(printf '%s\n' "${fresh_frozen_output}" | field_value unchanged_ticks)" "fixture fresh-progress frozen pane reached N"

ambiguous_run="${TMP_ROOT}/ambiguous-run"
ambiguous_session="spark-b3-ambiguous-$$"
make_run_dir "${ambiguous_run}"
start_session "${ambiguous_session}" "Working (99%)"
touch -d '40 minutes ago' "${ambiguous_run}/progress.md"
ambiguous_key="$(spark_cache_run_key "ambiguous-run" "${ambiguous_run}")"
spark_collect_run_signals "ambiguous-run" "${ambiguous_run}" "${ambiguous_session}" >/dev/null
spark_collect_run_signals "ambiguous-run" "${ambiguous_run}" "${ambiguous_session}" >/dev/null
ambiguous_output="$(spark_collect_run_signals "ambiguous-run" "${ambiguous_run}" "${ambiguous_session}")"
assert_eq "AMBIGUOUS" "$(printf '%s\n' "${ambiguous_output}" | field_value classification)" "fixture AMBIGUOUS from busy frozen pane"
assert_eq "2" "$(printf '%s\n' "${ambiguous_output}" | field_value unchanged_ticks)" "fixture unchanged tick counter"
assert_eq "AMBIGUOUS" "$(spark_state_get_run_field "${ambiguous_key}" "last_classification" "")" "cache stores classification"

python3 -m json.tool "${SPARK_DAEMON_STATE_CACHE}" >/dev/null
if compgen -G "${SPARK_DAEMON_TELEMETRY_DIR}/spark-daemon-state.json.tmp.*" >/dev/null; then
  printf 'FAIL atomic cache left tmp file behind\n' >&2
  exit 1
fi
printf 'PASS atomic cache write leaves valid JSON and no tmp file\n'
