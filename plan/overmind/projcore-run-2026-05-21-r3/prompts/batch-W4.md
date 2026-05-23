Batch-W4: History tab (Active/Completed/History) + persistent archive

Batch ID: W4
Requirements: og-requirements-r3.md (WU4), north-star-r3.md (R3-NS-4)
Branch: feat/overmind (CONTINUE). Schema currently v16.
Estimated: SHORT* — split W4a (archive table + endpoint) / W4b (History tab UI) if >30min.

Requirement (WU4): "Tabs become Active / Completed / History (rename Done→Completed; add History). History = persistent archive of task-log entries that SURVIVES workflow completion/removal (separate table). Layout: grouped by workflow (display_name ?? label), newest-first, collapsible. Appended whenever a workflow's task log gains an entry; retained on /om_drop / complete."

Expected (acceptance):
1. Schema v17: new table `overmind_task_history` (id INTEGER PK, coordinator_session TEXT, name TEXT [display_name ?? label snapshot at time of entry], at TEXT, current_task TEXT, done INTEGER, total INTEGER) + index on coordinator_session. Guarded version<17 migration (CREATE TABLE IF NOT EXISTS). This table is INDEPENDENT of overmind_workflows (survives its deletion).
2. overmind-service.setTasks: whenever it appends a task_log entry (the existing no-op-skip logic), ALSO insert a row into overmind_task_history (same {at, current_task, done, total} + coordinator_session + name=display_name??label). delete(id)/om_drop must NOT delete history rows.
3. Endpoint: GET /api/overmind/history (JWT auth) → returns archive rows, grouped or orderable by workflow; include the workflow's current display name if still registered else the snapshot name.
4. UI (app.js): dashboard tabs Active / Completed / History (rename the existing "Done" tab → "Completed"). History tab fetches /api/overmind/history, GROUPED BY workflow (name), each group collapsible, entries newest-first (at, current_task, done/total).
5. npx tsc clean.

Likely files:
- src/db/database.ts (v17 + history table + migration)
- src/services/overmind-service.ts (insert history on task_log append; delete preserves history)
- src/api/routes/overmind-routes.ts (GET /history, JWT)
- src/web/public/app.js (Active/Completed/History tabs + History grouped view)
- src/web/public/overmind-helpers.js (group-by-workflow helper, node-testable)
- tests: service (history row inserted on task change; survives delete) + helper (grouping) + route (JWT)

Scope: history archive + tab ONLY. Don't change W1/W2/W3/W5. Migration safe on live DB. The "history survives /om_drop" is the key property (test it). Surgical.

Tests (targeted):
- setTasks appends a history row; delete(workflow) → history rows REMAIN (the critical test). grouping helper groups by workflow newest-first. GET /history requires auth. Run vitest + tsc + npm run build.

Plan handshake (MANDATORY): read brief + database.ts + overmind-service.ts (setTasks task_log + delete) + overmind-routes.ts + app.js (tabs from V3) + overmind-helpers.js. Reply STATUS: PROPOSED with v17 table+migration, history-insert hook, delete-preserves-history, GET /history, the Active/Completed/History tabs + grouped UI, tests. WAIT for APPROVED-PLAN.
After APPROVED-PLAN: implement, commit, gate (tests + tsc + npm run build). Artifacts batch-W4/changes.md + test-report.md + independent-validation.md. projcore LIVE-SMOKE: task change creates history; /om_drop a test workflow → its history remains in GET /history.
Completion: callback FIRST to plan/overmind/projcore-run-2026-05-21-r3/callbacks.md [projcore callback] W4 <STATE> <note>, THEN STATUS: <verb> -- reason.
