#!/usr/bin/env bash
set -euo pipefail

DAEMON_UNDER_TEST="${SPARK_DAEMON_UNDER_TEST:-${HOME}/.claude/agents/lib/overmind-spark-daemon.sh}"
TMP_ROOT="$(mktemp -d)"

cleanup() {
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
  local actual="$1"
  local expected="$2"
  local label="$3"

  [[ "${actual}" == "${expected}" ]] || fail "${label}: expected ${expected}, got ${actual}"
  pass "${label}"
}

assert_contains() {
  local file="$1"
  local pattern="$2"
  local label="$3"

  grep -Eq "${pattern}" "${file}" || fail "${label}: missing pattern ${pattern}"
  pass "${label}"
}

assert_not_contains() {
  local file="$1"
  local pattern="$2"
  local label="$3"

  if grep -Eq "${pattern}" "${file}"; then
    fail "${label}: unexpected pattern ${pattern}"
  fi
  pass "${label}"
}

write_usage_mock() {
  cat > "${MOCK_USAGE_SH}" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "${1:-}" >> "${MOCK_USAGE_LOG}"
[[ "${1:-}" == "check" ]] || exit 2
printf '%s\n' "${MOCK_USAGE_JSON}"
MOCK
  chmod +x "${MOCK_USAGE_SH}"
}

run_tier2_case() {
  local label="$1"
  local usage_json="$2"

  : > "${MOCK_SPAWN_LOG}"
  : > "${MOCK_SEND_LOG}"
  : > "${MOCK_WAIT_LOG}"
  : > "${MOCK_RECORD_LOG}"
  : > "${MOCK_USAGE_LOG}"
  export MOCK_USAGE_JSON="${usage_json}"

  spark_run_tier2_verdict "${label}" "${TMP_ROOT}/${label}" "coord-b8" "classification=AMBIGUOUS"$'\n'"reason=fixture" "child-b8" >/dev/null
}

run_t_healthy_spark() {
  run_tier2_case "healthy-spark" '{"rungs":{"spark":{"headroom":10,"depleted":false},"sonnet":{"headroom":80,"depleted":false}}}'

  assert_contains "${MOCK_SPAWN_LOG}" '^spark-daemon-b8-test\|codex --model gpt-5.3-codex-spark --dangerously-bypass-approvals-and-sandbox$' "T-healthy-spark spark command"
  assert_not_contains "${MOCK_SPAWN_LOG}" 'sonnet' "T-healthy-spark no sonnet spawn"
  assert_eq "$(wc -l < "${MOCK_USAGE_LOG}" | awk '{ print $1 }')" "1" "T-healthy-spark usage once"
}

run_t_spark_low_sonnet_ok() {
  run_tier2_case "spark-low-sonnet-ok" '{"rungs":{"spark":{"headroom":4,"depleted":false},"sonnet":{"headroom":40,"depleted":false}}}'

  assert_contains "${MOCK_SPAWN_LOG}" '^spark-daemon-b8-test-sonnet\|claude --dangerously-skip-permissions --model sonnet$' "T-spark-low-sonnet-ok sonnet command"
  assert_not_contains "${MOCK_SPAWN_LOG}" 'gpt-5.3-codex-spark' "T-spark-low-sonnet-ok no spark spawn"
  assert_eq "$(wc -l < "${MOCK_USAGE_LOG}" | awk '{ print $1 }')" "1" "T-spark-low-sonnet-ok usage once"
}

run_t_both_low() {
  local verdict

  : > "${MOCK_SPAWN_LOG}"
  : > "${MOCK_SEND_LOG}"
  : > "${MOCK_WAIT_LOG}"
  : > "${MOCK_RECORD_LOG}"
  : > "${MOCK_USAGE_LOG}"
  export MOCK_USAGE_JSON='{"rungs":{"spark":{"headroom":2,"depleted":true},"sonnet":{"headroom":3,"depleted":true}}}'

  verdict="$(spark_run_tier2_verdict "both-low" "${TMP_ROOT}/both-low" "coord-b8" "classification=AMBIGUOUS"$'\n'"reason=fixture" "child-b8")"

  assert_eq "$(wc -l < "${MOCK_SPAWN_LOG}" | awk '{ print $1 }')" "0" "T-both-low no spawn"
  assert_contains "${MOCK_RECORD_LOG}" '^both-low\|2\|AMBIGUOUS\|tier2-token-depleted\|0\|' "T-both-low spark_used zero"
  assert_contains <(printf '%s\n' "${verdict}") '^classification=AMBIGUOUS$' "T-both-low graceful verdict"
  assert_eq "$(wc -l < "${MOCK_USAGE_LOG}" | awk '{ print $1 }')" "1" "T-both-low usage once"
}

run_t_usage_via_gateway() {
  assert_contains "${MOCK_USAGE_LOG}" '^check$' "T-usage-via-gateway mocked check verb"
  assert_not_contains "${DAEMON_UNDER_TEST}" 'chatgpt\.com|api\.anthropic\.com' "T-usage-via-gateway no direct usage endpoint"
}

mkdir -p "${TMP_ROOT}/telemetry"
mkdir -p "${TMP_ROOT}/healthy-spark" "${TMP_ROOT}/spark-low-sonnet-ok" "${TMP_ROOT}/both-low"

export SPARK_DAEMON_SOURCE_ONLY=1
export SPARK_DAEMON_SESSION_NAME="spark-daemon-b8-test"
export SPARK_DAEMON_SONNET_SESSION_NAME="spark-daemon-b8-test-sonnet"
export SPARK_DAEMON_MODEL="gpt-5.3-codex-spark"
export SPARK_DAEMON_CODEX_CMD="codex --model gpt-5.3-codex-spark --dangerously-bypass-approvals-and-sandbox"
export SPARK_DAEMON_SONNET_CMD="claude --dangerously-skip-permissions --model sonnet"
export SPARK_DAEMON_TOKEN_FLOOR_PCT=5
export SPARK_DAEMON_TELEMETRY_DIR="${TMP_ROOT}/telemetry"
export SPARK_DAEMON_EVENT_LOG="${SPARK_DAEMON_TELEMETRY_DIR}/spark-daemon-events.log"
export SPARK_DAEMON_DB="${SPARK_DAEMON_TELEMETRY_DIR}/projcore.db"
export SPARK_DAEMON_STATE_CACHE="${SPARK_DAEMON_TELEMETRY_DIR}/spark-daemon-state.json"
export MOCK_USAGE_SH="${TMP_ROOT}/agent-usage.sh"
export MOCK_USAGE_LOG="${TMP_ROOT}/usage.log"
export MOCK_SPAWN_LOG="${TMP_ROOT}/spawn.log"
export MOCK_SEND_LOG="${TMP_ROOT}/send.log"
export MOCK_WAIT_LOG="${TMP_ROOT}/wait.log"
export MOCK_RECORD_LOG="${TMP_ROOT}/record.log"
export SPARK_DAEMON_USAGE_SH="${MOCK_USAGE_SH}"

write_usage_mock
source "${DAEMON_UNDER_TEST}"
export SPARK_DAEMON_SOURCE_ONLY=0

spark_spawn_session_if_needed() {
  local session="$1"
  local cmd="$2"

  printf '%s|%s\n' "${session}" "${cmd}" >> "${MOCK_SPAWN_LOG}"
}

spark_send_submit_capture() {
  local session="$1"
  local text="$2"

  printf '%s|%s\n' "${session}" "${text}" >> "${MOCK_SEND_LOG}"
}

spark_wait_for_tier2_verdict() {
  local run_key="$1"
  local session="$2"

  printf '%s|%s\n' "${run_key}" "${session}" >> "${MOCK_WAIT_LOG}"
  printf 'classification=HEALTHY\n'
  printf 'reason=mock tier-2 verdict\n'
}

spark_apply_classification_action() {
  return 0
}

spark_record_tick() {
  printf '%s|%s|%s|%s|%s|%s\n' "$@" >> "${MOCK_RECORD_LOG}"
}

run_t_healthy_spark
run_t_spark_low_sonnet_ok
run_t_both_low
run_t_usage_via_gateway
