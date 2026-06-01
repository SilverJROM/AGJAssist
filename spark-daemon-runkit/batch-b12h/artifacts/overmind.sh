#!/usr/bin/env bash
# overmind.sh — projcore↔overmind gateway. State-diff-driven, cheat-resistant.
#
# Principle: `sync` fires ONLY when filesystem work-evidence changed since the last
# sync. A hung projcore cannot fake liveness — calling sync on an unchanged
# filesystem is a no-op. Real work (commits / progress lines / queue transitions /
# new artifacts) is the only thing that refreshes overmind's row.
#
# Subcommands:
#   detect-self --run-dir <abs> [--expected <name>] [--session <explicit>]
#                                  Phase 0 own-session capture. MUST run BEFORE
#                                  any child tmux session is spawned. Strict —
#                                  uses $TMUX-gated detection only (never the
#                                  unreliable `tmux display-message` default).
#                                  --expected matches against the canonical
#                                  session declared in project_specs.md; mismatch
#                                  = exit 3 (launch in wrong session caught at
#                                  Phase 0, not visible only in overmind's UI).
#                                  Writes session to state cache. Exit 3 if
#                                  unresolvable → ask JROM and re-run --session.
#   register    --run-dir <abs> --label <name> [--session <coord>]
#               [--child <session>:<role>]...
#                                  One-shot at Phase 0. Reads --session from state
#                                  cache (populated by detect-self) when omitted.
#                                  Stores workflow_id in cache.
#   sync        [--run-dir <abs>] [--explain] [--dry-run]
#                                  Compute work-evidence hash. If unchanged → no-op
#                                  (exit 0, nothing sent). If changed → POST /tasks
#                                  with current_task + tasks derived from queue.md.
#                                  --explain prints the diff signals + send/no-op.
#                                  --dry-run forces no network call.
#   child-add   <session> <role>   Append to cached child set + re-register (upsert).
#   child-rm    <session>          Drop from cached child set + re-register.
#   complete    [--run-dir <abs>]  Terminal state change — always fires. Use BEFORE
#                                  hand-back message.
#   pause       [--run-dir <abs>]  JROM-relay only. Uses cached workflow_id.
#   resume      [--run-dir <abs>]  JROM-relay only.
#   stall-alert <reason> [--run-dir <abs>]
#                                  Negative-signal sender (work has STOPPED). Embeds
#                                  "⚠ STALLED: <reason>" prefix in current_task.
#                                  Rate-limited (default 5min) — won't spam overmind.
#                                  Does NOT bypass cheat-resistance: a stall prefix
#                                  marks the row as broken, not as working.
#   self-test   --run-dir <abs>    Dry-run sync; prints state cache + computed hash.
#   show        [--run-dir <abs>]  Print current state cache (JSON).
#
# Env overrides:
#   OVERMIND_URL          default http://127.0.0.1:3101
#   OVERMIND_TOKEN_FILE   default /home/agjrom/TGBOTS/AGJAssist/.env
#   OVERMIND_RUN_DIR      default $PWD (when --run-dir omitted)
#   OVERMIND_STALL_RATELIMIT_SEC   default 300 (5min between same-reason stall-alerts)
#
# All overmind calls are best-effort: on curl fail/non-2xx, log to progress.md +
# continue (exit 0). Never blocks the run. Register retries once.
set -euo pipefail

OVERMIND_URL="${OVERMIND_URL:-http://127.0.0.1:3101}"
OVERMIND_TOKEN_FILE="${OVERMIND_TOKEN_FILE:-/home/agjrom/TGBOTS/AGJAssist/.env}"
STALL_RATELIMIT="${OVERMIND_STALL_RATELIMIT_SEC:-300}"

# ----- token (lazy, cached in the script process) -----
read_token() {
  if [[ -n "${_TOKEN:-}" ]]; then printf '%s' "$_TOKEN"; return; fi
  if [[ ! -r "$OVERMIND_TOKEN_FILE" ]]; then _TOKEN=""; return; fi
  _TOKEN="$(grep -E '^OVERMIND_TOKEN=' "$OVERMIND_TOKEN_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"' \r\n')"
  printf '%s' "$_TOKEN"
}

# ----- run-dir resolution + state cache -----
resolve_run_dir() {
  local rd="${1:-${OVERMIND_RUN_DIR:-$PWD}}"
  if [[ ! -d "$rd" ]]; then
    printf 'overmind.sh: run-dir not found: %s\n' "$rd" >&2
    exit 2
  fi
  cd "$rd" && pwd
}

state_path()    { printf '%s/.overmind-state.json' "$1"; }
progress_path() { printf '%s/progress.md' "$1"; }

log_progress() {
  local rd="$1"; shift
  local msg="$*"
  local ts; ts="$(date -Iseconds)"
  printf '[overmind] %s %s\n' "$ts" "$msg" >&2
  [[ -w "$rd" ]] && printf '[overmind] %s %s\n' "$ts" "$msg" >> "$(progress_path "$rd")" 2>/dev/null || true
}

state_read() {
  local sp; sp="$(state_path "$1")"
  [[ -f "$sp" ]] && cat "$sp" || printf '{}'
}

state_write() {
  local rd="$1"; local json="$2"
  local sp; sp="$(state_path "$rd")"
  printf '%s\n' "$json" > "$sp.tmp" && mv "$sp.tmp" "$sp"
}

state_get() {
  # state_get <run-dir> <key>  → value or empty
  python3 -c "
import json,sys
try: s=json.load(open(sys.argv[1]))
except Exception: s={}
v=s.get(sys.argv[2])
if v is None: pass
elif isinstance(v,(dict,list)): print(json.dumps(v))
else: print(v)
" "$(state_path "$1")" "$2" 2>/dev/null || true
}

state_set() {
  # state_set <run-dir> <key> <json-value-or-string>
  python3 - "$(state_path "$1")" "$2" "$3" <<'PY'
import json,sys
sp,k,v=sys.argv[1],sys.argv[2],sys.argv[3]
try: s=json.load(open(sp))
except Exception: s={}
# Try parse as JSON; if fails, treat as string
try: s[k]=json.loads(v)
except Exception: s[k]=v
tmp=sp+'.tmp'
open(tmp,'w').write(json.dumps(s,indent=2))
import os; os.replace(tmp,sp)
PY
}

# ----- own-session detection (strict — $TMUX-gated, never guesses) -----
# Returns this process's own tmux session name on stdout, or empty if not attached.
# Naked `tmux display-message -p '#S'` is DANGEROUS without $TMUX: tmux falls back
# to the most-recently-active session, which after we spawn a child is the CHILD —
# the exact bug that produced overmind's parent/child swap (JROM 2026-05-24,
# workflow `lokal-home-dnd` with parent shown as `lokal-home-dnd-codex`). Trust
# only $TMUX: it's set by tmux when this shell is genuinely inside a session, and
# `display-message` with $TMUX set correctly reports the attached session.
detect_own_session() {
  if [[ -z "${TMUX:-}" ]]; then
    return 0  # not attached — caller decides (state cache lookup, explicit arg, ask JROM)
  fi
  tmux display-message -p '#S' 2>/dev/null || true
}

# ----- work-evidence hash (the cheat-resistance gate) -----
# Hash a fixed set of artifacts. If hash unchanged since last successful sync,
# sync is a no-op. Pane output is DELIBERATELY excluded — only filesystem.
compute_work_hash() {
  local rd="$1"
  {
    # Content of state-bearing files (if present)
    for f in queue.md progress.md req-matrix.md callbacks.md; do
      if [[ -f "$rd/$f" ]]; then
        printf '=== %s ===\n' "$f"
        cat "$rd/$f"
      fi
    done
    # File listings of artifact dirs (new files = work landed)
    for d in batch-* validation decisions corrections prompts; do
      if compgen -G "$rd/$d" > /dev/null 2>&1; then
        printf '=== files:%s ===\n' "$d"
        find "$rd/"$d -type f 2>/dev/null | sort
      fi
    done
  } | sha256sum | awk '{print $1}'
}

# Build a human-readable diff explanation for --explain mode
explain_work() {
  local rd="$1"
  local prev_hash; prev_hash="$(state_get "$rd" last_hash)"
  local now_hash;  now_hash="$(compute_work_hash "$rd")"
  printf 'prev_hash: %s\n' "${prev_hash:-<none>}"
  printf 'curr_hash: %s\n' "$now_hash"
  if [[ "$prev_hash" == "$now_hash" ]]; then
    printf 'verdict:   no-op (no filesystem change)\n'
  else
    printf 'verdict:   send (filesystem changed)\n'
  fi
  # Surface the latest signals
  for f in queue.md progress.md req-matrix.md; do
    if [[ -f "$rd/$f" ]]; then
      local mt; mt="$(date -Iseconds -r "$rd/$f" 2>/dev/null || echo '?')"
      printf '  %-15s mtime=%s lines=%s\n' "$f" "$mt" "$(wc -l <"$rd/$f")"
    fi
  done
}

# ----- queue.md → tasks JSON -----
# Flexible parser. Recognizes rows like:
#   - [PENDING] A1: title
#   - [DONE]    batch-3: title
#   - A4 (processing): title
#   - [VERIFIED] req-7 ...
# Falls back to req-matrix.md if queue.md is missing.
build_tasks_json() {
  local rd="$1"
  python3 - "$rd" <<'PY'
import json,os,re,sys
rd=sys.argv[1]
STATES={
  'pending':'pending','queued':'pending','unassigned':'pending','todo':'pending',
  'processing':'processing','in-progress':'processing','in_progress':'processing','active':'processing','assigned':'processing','dispatched':'processing',
  'done':'done','verified':'done','passed':'done','complete':'done','completed':'done',
  'failed':'failed','blocked':'blocked','revise':'failed','needs-info':'blocked',
}
def parse(path):
  tasks=[]; current=None
  if not os.path.exists(path): return tasks,current
  for raw in open(path,errors='ignore'):
    line=raw.strip()
    if not line or line.startswith('#'): continue
    # Try to find a state token in []
    m=re.search(r'\[([A-Za-z_\-]+)\]', line)
    state=None; rest=line
    if m:
      tok=m.group(1).lower()
      state=STATES.get(tok)
      rest=line.replace(m.group(0),'',1).strip()
    else:
      # parenthesized state e.g. "A1 (processing): foo"
      m=re.search(r'\(([A-Za-z_\-]+)\)', line)
      if m:
        tok=m.group(1).lower()
        if tok in STATES:
          state=STATES[tok]
          rest=line.replace(m.group(0),'',1).strip()
    # Drop list bullet
    rest=re.sub(r'^[-*+]\s*','',rest).strip()
    # Split id from label: "A1: title" or "batch-3 — title" or "Req-7: title"
    m=re.match(r'^([A-Za-z]+[\-_]?\d+[a-z]?)\s*[:\-—]\s*(.+)$', rest)
    if m:
      tid,label=m.group(1),m.group(2).strip()
    else:
      # Fallback: first 60 chars as label, no id
      tid=f'row-{len(tasks)+1}'; label=rest[:120]
    if not label: continue
    state=state or 'pending'
    tasks.append({'id':tid,'label':label,'state':state})
    if current is None and state=='processing': current=label
  if current is None:
    for t in tasks:
      if t['state']=='pending': current=t['label']; break
  return tasks,current
tasks,current=parse(os.path.join(rd,'queue.md'))
if not tasks:
  tasks,current=parse(os.path.join(rd,'req-matrix.md'))
print(json.dumps({'tasks':tasks,'current':current}))
PY
}

# ----- curl wrapper -----
post_json() {
  # post_json <path> <json-body>  → "<http-code>\n<body>"
  local path="$1"; local body="$2"
  curl -sS -m 5 -w '\n%{http_code}' -X POST "$OVERMIND_URL$path" \
    -H 'Content-Type: application/json' \
    -d "$body" 2>/dev/null || printf '\n000'
}

# Returns 0 if 2xx, else 1
post_ok() {
  local resp="$1"
  local code; code="$(printf '%s' "$resp" | tail -n1)"
  [[ "$code" =~ ^2 ]]
}

json_identity_fields() {
  # json_identity_fields <run-dir> → JSON fragment with workflow_id/run_dir/session.
  local rd="$1"
  local wf_id session
  wf_id="$(state_get "$rd" workflow_id)"
  session="$(state_get "$rd" session)"
  python3 - "$wf_id" "$rd" "$session" <<'PY'
import json,sys
raw_wf,run_dir,session=sys.argv[1],sys.argv[2],sys.argv[3]
body={"run_dir": run_dir}
if raw_wf and raw_wf != "null":
  try: body["workflow_id"]=int(raw_wf)
  except Exception: body["workflow_id"]=raw_wf
if session:
  body["session"]=session
print(json.dumps(body)[1:-1])
PY
}

# ----- agent-pane classifier (sourceable; R11.1) -----
is_agent_pane() {
  local session="${1:-}"
  if [[ -z "$session" ]]; then
    printf 'no-session\n'
    return 0
  fi

  if ! tmux has-session -t "$session" 2>/dev/null; then
    printf 'no-session\n'
    return 0
  fi

  local pane
  pane="$(tmux capture-pane -J -p -t "$session" -S -50 2>/dev/null || true)"

  if printf '%s\n' "$pane" | grep -Eq 'Claude Code v[0-9]|bypass permissions on|for agents|↓ to manage|Claude Max|claude --dangerously-skip-permissions|claude --model'; then
    printf 'claude\n'
    return 0
  fi

  if printf '%s\n' "$pane" | grep -Eq 'OpenAI Codex|codex --dangerously-bypass|gpt-5|▌'; then
    printf 'codex\n'
    return 0
  fi

  if printf '%s\n' "$pane" | grep -Eq '^[a-z]+@[a-z-]+:'; then
    printf 'bare-bash\n'
    return 0
  fi

  printf 'unknown\n'
}

# ----- verbs -----
cmd_register() {
  local run_dir="" rejected_flag=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --run-dir)      run_dir="$2"; shift 2;;
      --label|--session|--parent-label)
        rejected_flag="$1"; shift
        [[ $# -gt 0 && "${1:0:2}" != "--" ]] && shift
        ;;
      --child) shift 2;;
      *) shift;;
    esac
  done
  if [[ -n "$rejected_flag" ]]; then
    printf '[overmind] register: --label/--parent-label/--session are no longer accepted (project-owned). Use: overmind.sh register --run-dir <abs>\n' >&2
    exit 2
  fi
  [[ -z "$run_dir" ]] && run_dir="${OVERMIND_RUN_DIR:-$PWD}"
  run_dir="$(resolve_run_dir "$run_dir")"
  local token; token="$(read_token)"
  if [[ -z "$token" ]]; then
    log_progress "$run_dir" "register skipped: OVERMIND_TOKEN not found"
    exit 0
  fi
  local body
  body="$(python3 - <<PY
import json
print(json.dumps({
  "run_dir": "$run_dir",
  "token": "$token"
}))
PY
)"
  local resp; resp="$(post_json /api/overmind/register "$body")"
  local code; code="$(printf '%s' "$resp" | tail -n1)"
  if [[ "$code" != "404" ]] && ! post_ok "$resp"; then
    sleep 1
    resp="$(post_json /api/overmind/register "$body")"
    code="$(printf '%s' "$resp" | tail -n1)"
  fi
  if post_ok "$resp"; then
    local wf_id
    wf_id="$(printf '%s' "$resp" | sed '$d' | python3 -c 'import sys,json
try: d=json.load(sys.stdin)
except: d={}
w=(d or {}).get("workflow") or {}
print(d.get("workflow_id") or w.get("id") or "")' 2>/dev/null)"
    state_set "$run_dir" workflow_id "${wf_id:-null}"
    state_set "$run_dir" last_hash "$(compute_work_hash "$run_dir")"
    state_set "$run_dir" last_sync_at "$(date -Iseconds)"
    log_progress "$run_dir" "register OK run_dir=$run_dir wf=$wf_id"
  elif [[ "$code" == "404" ]]; then
    local app_path_guess="$run_dir"
    local walk="$run_dir"
    while [[ "$walk" != "/" ]]; do
      if [[ -d "$walk/.git" ]]; then
        app_path_guess="$walk"
        break
      fi
      walk="$(dirname "$walk")"
    done
    local suggested_slug; suggested_slug="$(basename "$app_path_guess")"
    local reject_msg="[overmind REGISTER-REJECTED] no-project-for-run-dir — JROM must create the project for $app_path_guess via the dashboard before this run can register. Suggested slug: $suggested_slug. Run: $run_dir."
    printf '%s\n' "$reject_msg" >> "$run_dir/callbacks.md"
    log_progress "$run_dir" "register REJECTED no-project-for-run-dir app_path_guess=$app_path_guess run=$run_dir"
    exit 1
  else
    log_progress "$run_dir" "register FAIL (best-effort, continuing): $(printf '%s' "$resp" | tr -d '\n' | tail -c 200)"
  fi
}

cmd_sync() {
  local run_dir="" explain=0 dry=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --run-dir) run_dir="$2"; shift 2;;
      --explain) explain=1; shift;;
      --dry-run) dry=1; shift;;
      *) shift;;
    esac
  done
  [[ -z "$run_dir" ]] && run_dir="${OVERMIND_RUN_DIR:-$PWD}"
  run_dir="$(resolve_run_dir "$run_dir")"
  if [[ $explain -eq 1 ]]; then explain_work "$run_dir"; fi
  local prev_hash; prev_hash="$(state_get "$run_dir" last_hash)"
  local now_hash;  now_hash="$(compute_work_hash "$run_dir")"
  if [[ "$prev_hash" == "$now_hash" ]]; then
    # No real work — no-op. The cheat-resistance gate.
    [[ $explain -eq 1 ]] && printf 'action:    no-op (hash match)\n'
    exit 0
  fi
  if [[ $dry -eq 1 ]]; then
    [[ $explain -eq 1 ]] && printf 'action:    would-send (--dry-run)\n'
    exit 0
  fi
  local token; token="$(read_token)"
  if [[ -z "$token" ]]; then
    log_progress "$run_dir" "sync skipped: OVERMIND_TOKEN not found"
    exit 0
  fi
  local tasksinfo; tasksinfo="$(build_tasks_json "$run_dir")"
  local tasks_json current_task
  tasks_json="$(printf '%s' "$tasksinfo" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(json.dumps(d["tasks"]))')"
  current_task="$(printf '%s' "$tasksinfo" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("current") or "")')"
  local body
  body="$(python3 - <<PY
import json
print(json.dumps({
  **{ $(json_identity_fields "$run_dir") },
  "current_task": "$current_task" or None,
  "tasks": $tasks_json,
  "token": "$token"
}))
PY
)"
  local resp; resp="$(post_json /api/overmind/tasks "$body")"
  if post_ok "$resp"; then
    state_set "$run_dir" last_hash "$now_hash"
    state_set "$run_dir" last_sync_at "$(date -Iseconds)"
    log_progress "$run_dir" "sync OK current='$current_task' tasks=$(printf '%s' "$tasks_json" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')"
  else
    log_progress "$run_dir" "sync FAIL (best-effort, continuing): $(printf '%s' "$resp" | tr -d '\n' | tail -c 200)"
  fi
}

cmd_child_add() {
  local session_to_add="${1:-}"; local role="${2:-}"
  local run_dir="${OVERMIND_RUN_DIR:-$PWD}"
  run_dir="$(resolve_run_dir "$run_dir")"
  [[ -z "$session_to_add" || -z "$role" ]] && { echo "usage: child-add <session> <role>" >&2; exit 2; }
  python3 - "$(state_path "$run_dir")" "$session_to_add" "$role" <<'PY'
import json,os,sys
sp,s,r=sys.argv[1],sys.argv[2],sys.argv[3]
try: st=json.load(open(sp))
except: st={}
cs=st.get('child_sessions') or []
cr=st.get('child_roles') or []
if s not in cs:
  cs.append(s); cr.append(r)
  st['child_sessions']=cs; st['child_roles']=cr
  open(sp+'.tmp','w').write(json.dumps(st,indent=2))
  os.replace(sp+'.tmp',sp)
PY
  _reregister_from_cache "$run_dir" "child-add $session_to_add:$role"
}

cmd_child_rm() {
  local session_to_rm="${1:-}"
  local run_dir="${OVERMIND_RUN_DIR:-$PWD}"
  run_dir="$(resolve_run_dir "$run_dir")"
  [[ -z "$session_to_rm" ]] && { echo "usage: child-rm <session>" >&2; exit 2; }
  python3 - "$(state_path "$run_dir")" "$session_to_rm" <<'PY'
import json,os,sys
sp,s=sys.argv[1],sys.argv[2]
try: st=json.load(open(sp))
except: st={}
cs=st.get('child_sessions') or []
cr=st.get('child_roles') or []
if s in cs:
  i=cs.index(s); cs.pop(i)
  if i < len(cr): cr.pop(i)
  st['child_sessions']=cs; st['child_roles']=cr
  open(sp+'.tmp','w').write(json.dumps(st,indent=2))
  os.replace(sp+'.tmp',sp)
PY
  _reregister_from_cache "$run_dir" "child-rm $session_to_rm"
}

_reregister_from_cache() {
  local run_dir="$1"; local reason="$2"
  local label session cs cr
  label="$(state_get "$run_dir" label)"
  session="$(state_get "$run_dir" session)"
  cs="$(state_get "$run_dir" child_sessions)"; [[ -z "$cs" ]] && cs='[]'
  cr="$(state_get "$run_dir" child_roles)"; [[ -z "$cr" ]] && cr='[]'
  local token; token="$(read_token)"
  [[ -z "$token" ]] && { log_progress "$run_dir" "child sync skipped ($reason): no token"; return; }
  local body
  body="$(python3 - <<PY
import json
print(json.dumps({
  **{ $(json_identity_fields "$run_dir") },
  "child_sessions": $cs,
  "child_roles": $cr,
  "token": "$token"
}))
PY
)"
  local resp; resp="$(post_json /api/overmind/children "$body")"
  if post_ok "$resp"; then
    log_progress "$run_dir" "child sync OK ($reason) children=$cs"
  else
    if [[ -n "$label" && -n "$session" ]]; then
      local tasksinfo tasks_json current_task
      tasksinfo="$(build_tasks_json "$run_dir")"
      tasks_json="$(printf '%s' "$tasksinfo" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(json.dumps(d["tasks"]))')"
      current_task="$(printf '%s' "$tasksinfo" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("current") or "")')"
      body="$(python3 - <<PY
import json
print(json.dumps({
  "label": "$label",
  "session": "$session",
  "child_sessions": $cs,
  "child_roles": $cr,
  "run_dir": "$run_dir",
  "current_task": "$current_task" or None,
  "tasks": $tasks_json,
  "token": "$token"
}))
PY
)"
      resp="$(post_json /api/overmind/register "$body")"
    fi
    if post_ok "$resp"; then
      log_progress "$run_dir" "re-register OK ($reason) children=$cs"
    else
      log_progress "$run_dir" "child sync FAIL ($reason; best-effort): $(printf '%s' "$resp" | tr -d '\n' | tail -c 200)"
    fi
  fi
}

cmd_complete() {
  local run_dir=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --run-dir) run_dir="$2"; shift 2;;
      *) shift;;
    esac
  done
  [[ -z "$run_dir" ]] && run_dir="${OVERMIND_RUN_DIR:-$PWD}"
  run_dir="$(resolve_run_dir "$run_dir")"
  local token; token="$(read_token)"
  [[ -z "$token" ]] && { log_progress "$run_dir" "complete skipped: no token"; exit 0; }
  local body
  body="$(python3 - <<PY
import json
print(json.dumps({
  **{ $(json_identity_fields "$run_dir") },
  "token": "$token"
}))
PY
)"
  local resp; resp="$(post_json /api/overmind/complete "$body")"
  if post_ok "$resp"; then
    log_progress "$run_dir" "complete OK"
  else
    log_progress "$run_dir" "complete FAIL (best-effort): $(printf '%s' "$resp" | tr -d '\n' | tail -c 200)"
  fi
}

cmd_pause_resume() {
  local action="$1"; shift
  local run_dir=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --run-dir) run_dir="$2"; shift 2;;
      *) shift;;
    esac
  done
  [[ -z "$run_dir" ]] && run_dir="${OVERMIND_RUN_DIR:-$PWD}"
  run_dir="$(resolve_run_dir "$run_dir")"
  local wf_id; wf_id="$(state_get "$run_dir" workflow_id)"
  [[ -z "$wf_id" || "$wf_id" == "null" ]] && { log_progress "$run_dir" "$action skipped: no workflow_id in cache"; exit 0; }
  local token; token="$(read_token)"
  [[ -z "$token" ]] && { log_progress "$run_dir" "$action skipped: no token"; exit 0; }
  local body
  body="$(python3 - <<PY
import json
print(json.dumps({
  **{ $(json_identity_fields "$run_dir") },
  "token": "$token"
}))
PY
)"
  local resp; resp="$(post_json "/api/overmind/workflows/$wf_id/$action" "$body")"
  if post_ok "$resp"; then
    log_progress "$run_dir" "$action OK wf=$wf_id"
  else
    log_progress "$run_dir" "$action FAIL (best-effort): $(printf '%s' "$resp" | tr -d '\n' | tail -c 200)"
  fi
}

cmd_stall_alert() {
  local reason="${1:-unspecified}"; shift || true
  local run_dir=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --run-dir) run_dir="$2"; shift 2;;
      *) shift;;
    esac
  done
  [[ -z "$run_dir" ]] && run_dir="${OVERMIND_RUN_DIR:-$PWD}"
  run_dir="$(resolve_run_dir "$run_dir")"
  # Rate-limit: same reason within STALL_RATELIMIT sec → drop
  local last_reason last_at now_epoch last_epoch
  last_reason="$(state_get "$run_dir" last_stall_reason)"
  last_at="$(state_get "$run_dir" last_stall_alert_at)"
  now_epoch="$(date +%s)"
  if [[ "$last_reason" == "$reason" && -n "$last_at" ]]; then
    last_epoch="$(date -d "$last_at" +%s 2>/dev/null || echo 0)"
    if (( now_epoch - last_epoch < STALL_RATELIMIT )); then
      exit 0
    fi
  fi
  local token; token="$(read_token)"
  [[ -z "$token" ]] && { log_progress "$run_dir" "stall-alert skipped: no token"; exit 0; }
  # Embed STALLED prefix in current_task. Tasks list is the same — only current_task changes.
  local tasksinfo; tasksinfo="$(build_tasks_json "$run_dir")"
  local tasks_json
  tasks_json="$(printf '%s' "$tasksinfo" | python3 -c 'import sys,json; d=json.load(sys.stdin); print(json.dumps(d["tasks"]))')"
  local stall_current="⚠ STALLED: $reason"
  local body
  body="$(python3 - <<PY
import json
print(json.dumps({
  **{ $(json_identity_fields "$run_dir") },
  "current_task": "$stall_current",
  "tasks": $tasks_json,
  "token": "$token"
}))
PY
)"
  local resp; resp="$(post_json /api/overmind/tasks "$body")"
  if post_ok "$resp"; then
    state_set "$run_dir" last_stall_alert_at "$(date -Iseconds)"
    state_set "$run_dir" last_stall_reason "$reason"
    log_progress "$run_dir" "stall-alert SENT reason='$reason'"
  else
    log_progress "$run_dir" "stall-alert FAIL (best-effort): $(printf '%s' "$resp" | tr -d '\n' | tail -c 200)"
  fi
}

cmd_self_test() {
  local run_dir=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --run-dir) run_dir="$2"; shift 2;;
      *) shift;;
    esac
  done
  [[ -z "$run_dir" ]] && run_dir="${OVERMIND_RUN_DIR:-$PWD}"
  run_dir="$(resolve_run_dir "$run_dir")"
  printf '=== overmind.sh self-test ===\n'
  printf 'run-dir:      %s\n' "$run_dir"
  printf 'overmind URL: %s\n' "$OVERMIND_URL"
  local token; token="$(read_token)"
  if [[ -z "$token" ]]; then
    printf 'token:        MISSING (file=%s) — calls will skip\n' "$OVERMIND_TOKEN_FILE"
  else
    printf 'token:        OK (%d chars)\n' "${#token}"
  fi
  echo '--- state cache ---'
  state_read "$run_dir" | python3 -m json.tool 2>/dev/null || echo '(empty)'
  echo '--- work-evidence ---'
  explain_work "$run_dir"
  echo '--- reachability ---'
  local code; code="$(curl -s -o /dev/null -w '%{http_code}' -m 3 "$OVERMIND_URL/api/overmind/workflows" || echo '000')"
  printf 'GET /api/overmind/workflows: HTTP %s\n' "$code"
  echo '--- tasks JSON (dry) ---'
  build_tasks_json "$run_dir" | python3 -m json.tool
}

cmd_show() {
  local run_dir="${1:-${OVERMIND_RUN_DIR:-$PWD}}"
  run_dir="$(resolve_run_dir "$run_dir")"
  state_read "$run_dir" | python3 -m json.tool 2>/dev/null || echo '{}'
}

# detect-self: Phase 0 own-session capture. MUST be called BEFORE spawning any
# child tmux session — once a child exists, naked tmux-default detection becomes
# unreliable (see comment on detect_own_session). Writes the resolved session to
# the state cache so all later `overmind.sh` calls read from a single source of
# truth, eliminating the parent/child swap class of bug.
#
# Usage: overmind.sh detect-self --run-dir <abs> [--expected <name>] [--session <explicit>]
#   --expected <name>  Match-check: the canonical projcore-session name from the
#                      project's project_specs.md. If detected session disagrees,
#                      fail with a clear "launch me in <expected>" message. This
#                      is the structural guard: project identity (declared in repo)
#                      and runtime self (detected via $TMUX) must agree.
#   --session <name>   Explicit override, skips detection.
# Exits 0 with session on stdout when resolved + (if --expected) matched.
# Exits 3 + stderr on unresolvable OR mismatch — projcore must NOT fall back to
# guessing; ask JROM / fix the launch.
cmd_detect_self() {
  local run_dir="" explicit="" expected=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --run-dir)  run_dir="$2"; shift 2;;
      --session)  explicit="$2"; shift 2;;
      --expected) expected="$2"; shift 2;;
      *) shift;;
    esac
  done
  [[ -z "$run_dir" ]] && run_dir="${OVERMIND_RUN_DIR:-$PWD}"
  run_dir="$(resolve_run_dir "$run_dir")"
  local session=""
  if [[ -n "$explicit" ]]; then
    session="$explicit"
  else
    session="$(detect_own_session)"
  fi
  if [[ -z "$session" ]]; then
    {
      echo "overmind.sh detect-self: cannot resolve own tmux session."
      echo "  \$TMUX is unset — this Claude Code process is NOT attached to a tmux session."
      echo "  Do NOT guess via \`tmux display-message\` (returns wrong session after children spawn)."
      if [[ -n "$expected" ]]; then
        echo "  Expected: $expected"
        echo "  Resolution: launch projcore inside the canonical session:"
        echo "    tmux new-session -s $expected   # or: tmux attach -t $expected"
        echo "    # then inside: claude"
      else
        echo "  Resolution: ask JROM for the coordinator session name and re-run:"
        echo "    overmind.sh detect-self --run-dir $run_dir --session <name>"
      fi
    } >&2
    exit 3
  fi
  if [[ -n "$expected" && "$session" != "$expected" ]]; then
    {
      echo "overmind.sh detect-self: session MISMATCH."
      echo "  Expected (from project_specs.md): $expected"
      echo "  Detected (from \$TMUX):           $session"
      echo "  This run will report to overmind under the WRONG project identity."
      echo "  Resolution: relaunch projcore in the canonical session:"
      echo "    tmux new-session -s $expected   # or: tmux attach -t $expected"
      echo "    # then inside: claude"
      echo "  (Override at your own risk: --session $session to force.)"
    } >&2
    exit 3
  fi
  state_set "$run_dir" session "$session"
  [[ -n "$expected" ]] && state_set "$run_dir" expected_session "$expected"
  log_progress "$run_dir" "detect-self: own session = $session${expected:+ (matched expected=$expected)}"
  printf '%s\n' "$session"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  # ----- dispatch -----
  case "${1:-}" in
    register)    shift; cmd_register "$@";;
    sync)        shift; cmd_sync "$@";;
    child-add)   shift; cmd_child_add "$@";;
    child-rm)    shift; cmd_child_rm "$@";;
    complete)    shift; cmd_complete "$@";;
    pause)       shift; cmd_pause_resume pause "$@";;
    resume)      shift; cmd_pause_resume resume "$@";;
    stall-alert) shift; cmd_stall_alert "$@";;
    self-test)   shift; cmd_self_test "$@";;
    detect-self) shift; cmd_detect_self "$@";;
    show)        shift; cmd_show "$@";;
    ""|-h|--help|help)
      sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
      ;;
    *)
      printf 'overmind.sh: unknown subcommand: %s\n' "$1" >&2
      exit 2
      ;;
  esac
fi
