Batch-V6: Workflow audit — elapsed-time (frozen on all-tasks-done) + task history log

Batch ID: V6
Requirements: og-requirements-ui.md (RU8, RU9)
Branch: feat/overmind (CONTINUE)

Estimated: SHORT* — if PROPOSED shows >30min, split V6a (backend: schema v13 + ended_at + task_log) / V6b (UI: elapsed stat + history list).

Context:
overmind_workflows has created_at, tasks (JSON array of {id,label,state done|processing|pending}), current_task, status. RU8 = elapsed-time stat that FREEZES when all tasks done. RU9 = a task history log for review. Schema currently v12 (active_session/active_role added in V2).

Requirements (verbatim):
RU8: "elapsed since started = (ended_at ?? now) − created_at, ticking live while in play. When ALL tasks reach state done (or status completed), stamp ended_at once and FREEZE. (add ended_at TEXT.)"
RU9: "per-workflow log of previous tasks/transitions (timestamped). Append an entry whenever the tasklist/current_task changes ({at, current_task, done/total, note}). Show in expanded card as History. (add task_log TEXT JSON array; appended in setTasks.)"

Expected (acceptance):
1. Schema v13: SCHEMA_VERSION 12→13. Add `ended_at TEXT` (nullable) + `task_log TEXT NOT NULL DEFAULT '[]'` to SCHEMA_SQL (fresh path) AND a guarded `version < 13` migration (PRAGMA table_info + ALTER ADD COLUMN, idempotent on live DB — same pattern as v12).
2. ended_at logic in overmind-service (setTasks + setStatus):
   - When the tasklist is non-empty AND every task.state === 'done' (OR status set to 'completed') AND ended_at is null → set ended_at = now (freeze).
   - If a later update introduces a non-done task again (e.g. a new injected task) → CLEAR ended_at back to null (clock resumes). So elapsed reflects "currently all-done or not".
3. task_log in overmind-service.setTasks: append an entry {at: ISO now, current_task, done: <doneCount>, total: <taskCount>} when current_task changes OR the done-count changes (avoid logging no-op identical updates). Cap to the last ~50 entries. Expose task_log (parsed array) on OvermindWorkflow.
4. OvermindWorkflow interface + GET mapping include ended_at + task_log.
5. UI (app.js, expanded card):
   - Elapsed stat: pure helper elapsedMs(createdAt, endedAt, now) + formatElapsed (in overmind-helpers.js, node-testable). Show "Elapsed: <Xh Ym>" — live-ticking when ended_at null (a setInterval re-render is fine, ~1s/30s), frozen when ended_at set (show e.g. "Elapsed: 2h 14m (done)").
   - History: render task_log entries (timestamp + current_task + done/total) in the expanded detail, newest first, in a compact list.
6. npx tsc clean.

Likely files:
- src/db/database.ts (v13 + migration + SCHEMA_SQL)
- src/services/overmind-service.ts (interface + ended_at/task_log logic in setTasks/setStatus)
- src/web/public/overmind-helpers.js (elapsedMs, formatElapsed — pure, tested)
- src/web/public/app.js (elapsed stat + history list; live-tick for elapsed)
- tests: service tests (ended_at freeze on all-done, clears on new not-done, task_log append + cap + no-op skip) + helper test (elapsedMs/formatElapsed)

Scope:
- RU8 + RU9 ONLY. Don't touch V1-V4 features or backend nudge/brain logic. Migration safe on live DB.
- Surgical.

Tests (targeted):
- service: setTasks all-done → ended_at set; subsequent setTasks with a pending task → ended_at cleared; task_log appends on change, skips identical, caps ~50. setStatus('completed') → ended_at set.
- helper: elapsedMs/formatElapsed (ticking vs frozen). Run targeted vitest + tsc + npm run build.

Plan handshake (MANDATORY): read brief + database.ts (v12 migration pattern) + overmind-service.ts (setTasks/setStatus) + app.js (expanded card) + overmind-helpers.js. Reply STATUS: PROPOSED with: v13 migration, ended_at freeze/resume rule, task_log append+cap rule, the elapsed helper + live-tick approach, and tests. Split if needed. WAIT for APPROVED-PLAN.

After APPROVED-PLAN: implement, commit, gate (targeted tests + tsc + npm run build). Artifacts batch-V6/changes.md + test-report.md + independent-validation.md. NOTE projcore will LIVE-SMOKE the v13 migration + ended_at freeze.

Completion: callback FIRST to plan/overmind/projcore-run-2026-05-21-ui/callbacks.md `[projcore callback] V6 <STATE> <note>`, THEN STATUS: <verb> -- reason.
