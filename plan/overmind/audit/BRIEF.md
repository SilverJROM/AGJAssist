Task: Build a timed algo-vs-spark audit script for overmind's session-status classifier

Repo: /home/agjrom/TGBOTS/AGJAssist. Build script under `plan/overmind/audit/`. Node ESM (.mjs), uses better-sqlite3 + tmux CLI + spark/Opus via shell. NO TS, NO build step. Make it REUSABLE for future timed experiments via env vars.

Goal (JROM verbatim): "catch or improve our algorithm on reporting the status of the sessions." So this is not just a check — Opus's end-report must propose concrete classifier improvements.

Design (already locked with JROM):

A. CRON-DRIVEN one-shot (no long-running process). Cron fires every 10 min: `*/10 * * * * cd /home/agjrom/TGBOTS/AGJAssist && /usr/bin/env node plan/overmind/audit/algo-vs-spark-audit.mjs >> plan/overmind/audit/cron.log 2>&1`. Script self-gates via state file.

B. STATE FILE: `plan/overmind/audit/audit-state.json` — `{started_at, next_fire_at, tick_count, done}`. On first run: bootstrap (started_at=now, next_fire_at=now). On each cron fire: read state, if `done` → exit; if `now < next_fire_at` → exit silently (cron fired but not our slot); if `now >= started_at + AUDIT_DAYS*86400000` → run FINALIZE path then set done=true and exit. Otherwise run a tick then schedule next_fire_at = now + random interval (20 min with prob `AUDIT_CADENCE_20_WEIGHT` default 0.6, else 30 min).

C. TICK: read `data/agjassist.db` for workflows where `status NOT IN ('completed','failed','paused') AND monitoring_paused=0`. If none → log "no active workflows" + skip (still schedule next). Else for each workflow:
   - Capture parent pane: `tmux capture-pane -p -t <coordinator_session>` (tail last 50 lines).
   - For each entry in `child_sessions`: capture child pane (last 50 lines). If `tmux has-session` fails → mark as `closed` (don't ask spark; the algo already calls it closed).
   - Compose ONE spark prompt listing all sessions for this workflow with their pane snippets, asking for STRICT JSON: `{"sessions":[{"name":"<session>","role":"parent|child","status":"working|idle|stuck|closed|unknown","reason":"<short, ≤12 words>"}]}`. The system instruction: "You judge each tmux session's status from its pane snippet. 'working' = active turn (spinner, esc to interrupt, mid-thought) OR substantive new output. 'idle' = stable composer + no activity. 'stuck' = appears active but no real progress (chrome timer ticking but body unchanged). 'closed' = session terminated/empty. 'unknown' = can't tell. Reply STRICT JSON only."
   - Invoke spark: `${AUDIT_SPARK_CMD}` (default `codex exec --model gpt-5.3-codex --skip-git-repo-check`) by spawning with the prompt on stdin; capture stdout; parse JSON (handle code fences). On parse error → log `spark_parse_error` for that workflow and continue.
   - For each session in spark's reply, read overmind's tag from the DB: parent → `parent_status`; child → look up `child_statuses` array for that session name. Normalize spark→algo vocab (spark `working` matches algo `working`; spark `idle` matches algo `idle`/`waiting_human`/`awaiting_decision` — treat any non-`working`/non-`stuck`/non-`closed` algo tag as "idle" for tally comparison; spark `closed` matches algo `closed`).
   - Append one JSONL row per session to `plan/overmind/audit/audit-log.jsonl`:
     `{at: ISO, tick_n, workflow_id, workflow_label, session, role, algo_status, spark_status, agreement: bool, spark_reason, pane_excerpt_hash}` (hash only — don't dump panes inline).
   - Also store the pane snippets in a per-tick sidecar `plan/overmind/audit/panes/<tick_n>.json` keyed by session, so the Opus analyst can pull samples for evidence.

D. FINALIZE (when 3 days elapsed):
   1. Compute tallies: total ticks, total sessions sampled, overall agreement %, per-role agreement % (parent vs child), most common (algo_status, spark_status) disagreement pairs with counts, top 10 worst single disagreements (pick by recency + role=parent priority), and per-workflow tally.
   2. Write a structured `audit-summary.json` next to the log.
   3. Invoke ANALYST (default Opus): `${AUDIT_ANALYST_MODEL}` — `claude -p --dangerously-skip-permissions --model ${AUDIT_ANALYST_MODEL}` with a prompt: "Read this 3-day overmind algo-vs-spark audit. Goal: catch/improve the deterministic classifier. Summarize agreement %. Then propose 3–7 SPECIFIC, ACTIONABLE improvements to src/services/overmind-watcher.ts — `extractBody`, `hasActiveTurn`, `hashPane`, `classifyWorkflow`, `classifyParentSession`, `classifyChildSessionStatus`, the mtime check — with file:line hints and a 1-line patch idea each. Cite evidence from the worst-disagreement samples. End with a prioritized list (P0/P1/P2)." Pass `audit-summary.json` + the worst-disagreement excerpts as the user message; cap input size.
   4. Save Opus's reply to `plan/overmind/audit/audit-report-<startdate>.md` (markdown). Always also write a minimal fallback summary so the file exists even if the analyst call fails.
   5. SEND TO JROM via Telegram. Use the localhost notification endpoint per `~/.claude/agents/NOTIFICATION_PROTOCOL.md`: `curl -s -m 10 -X POST http://127.0.0.1:8701/notify -H 'Content-Type: application/json' -d '{"name":"overmind/audit","model":"opus","verdict":"✅","title":"3-day algo-vs-spark audit complete","summary":"<one-line agreement % + top improvement>","action":"see plan/overmind/audit/audit-report-<startdate>.md"}'` (adapt to the actual NOTIFICATION_PROTOCOL.md JSON shape — READ THE PROTOCOL FILE FIRST and match its expected payload). If 8701 is unreachable, log + continue (do not crash).
   6. Set `state.done = true` so future cron fires exit immediately. (JROM removes the cron entry at his leisure.)

E. ENV VARS (reusable defaults):
   - `AUDIT_DAYS=3`
   - `AUDIT_CADENCE_20_WEIGHT=0.6` (probability of choosing 20-min over 30-min)
   - `AUDIT_SPARK_CMD="codex exec --model gpt-5.3-codex --skip-git-repo-check"`
   - `AUDIT_ANALYST_MODEL="opus"`
   - `AUDIT_LOG_DIR="plan/overmind/audit"` (where state, log, panes, report live)

F. Provide a `--render-only` flag that skips ticking + finalizes immediately against the existing JSONL (so JROM can produce an interim report without waiting 3 days).

G. Provide a small `README.md` next to the script: how to enable (the cron line), how to peek progress (`cat audit-state.json` + `wc -l audit-log.jsonl`), how to render interim, how to kill (remove cron entry + `done=true` in state).

H. Idempotent + resilient: every external call (tmux, spark, claude, curl) wrapped in try/catch; partial failures logged but don't crash the script. The cron MUST be able to fire even mid-tick of a previous run without corrupting state (atomic write of audit-state.json + audit-log.jsonl via append-mode).

Scope/DON'T: do NOT change overmind production code (this is a passive observer). Read-only against `data/agjassist.db` (no writes). The script touches only `plan/overmind/audit/*`. No npm install — use already-installed `better-sqlite3` + node builtins + shelling out to tmux/codex/claude/curl.

Deliverables (all under `plan/overmind/audit/`):
   - `algo-vs-spark-audit.mjs` (the script).
   - `README.md` (operator notes).
   - The script auto-creates `audit-state.json`, `audit-log.jsonl`, `panes/`, `cron.log`, `audit-summary.json`, `audit-report-*.md` on use.

Verify: run with `--dry-run` or just trigger a single tick manually (`node plan/overmind/audit/algo-vs-spark-audit.mjs`) and confirm: state file created, at least one JSONL row written if any workflows are active (else "no active workflows" log + skip), next_fire_at scheduled. `npx tsc` (the repo's typecheck) stays clean (no .ts touched). Existing vitest suite still 321/321.

Commit on the current branch: `[audit] add timed algo-vs-spark audit script (cron-driven, 60/40 20-30min random cadence, 3-day auto-stop + Opus analysis + TG)`. End with STATUS marker.
