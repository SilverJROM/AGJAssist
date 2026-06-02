#!/usr/bin/env bash
set -euo pipefail

OVERMIND_SH="${OVERMIND_SH:-${HOME}/.claude/agents/lib/overmind.sh}"

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

tmp_root="$(mktemp -d)"
trap 'rm -rf "$tmp_root"' EXIT

run_dir="$tmp_root/run"
mock_bin="$tmp_root/bin"
token_file="$tmp_root/.env"
body_file="$tmp_root/body.json"

mkdir -p "$run_dir" "$mock_bin"

cat > "$run_dir/queue.md" <<'EOF'
- B10: Estimate-less sync regression [processing]
EOF

cat > "$run_dir/.overmind-state.json" <<'EOF'
{
  "workflow_id": 42,
  "session": "b10-parent",
  "last_hash": "force-sync"
}
EOF

cat > "$token_file" <<'EOF'
OVERMIND_TOKEN=test-token
EOF

cat > "$mock_bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
body=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -d)
      body="${2:-}"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
: "${CAPTURE_BODY:?}"
printf '%s\n' "$body" > "$CAPTURE_BODY"
printf '{"ok":true}\n200\n'
EOF
chmod +x "$mock_bin/curl"

sync_output="$(
  PATH="$mock_bin:$PATH" \
  CAPTURE_BODY="$body_file" \
  OVERMIND_TOKEN_FILE="$token_file" \
  OVERMIND_URL="http://127.0.0.1:65535" \
  "$OVERMIND_SH" sync --run-dir "$run_dir" 2>&1
)" || fail "overmind sync exited non-zero"

if printf '%s\n' "$sync_output" | grep -Eq 'Traceback|NameError'; then
  printf '%s\n' "$sync_output" >&2
  fail "sync emitted a Python traceback"
fi

[[ -s "$body_file" ]] || fail "mock curl did not capture a POST body"

python3 - "$body_file" "$run_dir" <<'PY'
import json
import sys

body_path, run_dir = sys.argv[1], sys.argv[2]
with open(body_path, encoding="utf-8") as fh:
  body = json.load(fh)

assert body["run_dir"] == run_dir, body
assert body["workflow_id"] == 42, body
assert body["session"] == "b10-parent", body
assert body["token"] == "test-token", body
assert body["current_task"] == "Estimate-less sync regression", body

tasks = body["tasks"]
assert len(tasks) == 1, tasks
task = tasks[0]
assert task["id"] == "B10", task
assert task["label"] == "Estimate-less sync regression", task
assert task["state"] == "processing", task
assert "estimate_min" in task, task
assert task["estimate_min"] is None, task
PY

printf 'PASS: sync POST body preserves estimate_min=null for estimate-less tasks\n'
