Batch-W3: Rename workflow in the mini-app (persistent custom name)

Batch ID: W3
Requirements: og-requirements-r3.md (WU3), north-star-r3.md (R3-NS-3)
Branch: feat/overmind (CONTINUE). Schema currently v15.
Estimated: SHORT.

Requirement (WU3): "Add display_name TEXT column. A rename control in the UI lets JROM set a custom name; persisted via an authenticated endpoint (POST /api/overmind/workflows/:id/name, JWT auth — browser action). Dashboard/cards/Telegram show display_name ?? label. register()/tasks-update from projcore MUST NOT overwrite display_name (projcore sets label; user's display_name wins until cleared)."

Expected (acceptance):
1. Schema v16 (15→16): add display_name TEXT (nullable) to SCHEMA_SQL + guarded version<16 migration (PRAGMA table_info + ALTER ADD COLUMN). 
2. overmind-service: OvermindWorkflow includes display_name. register() and setTasks() MUST NOT touch display_name (preserve existing value on upsert). Add setDisplayName(id, name|null).
3. Endpoint: POST /api/overmind/workflows/:id/name body {name} — JWT auth (createAuthMiddleware, like GET workflows), sets display_name (empty/null clears it → falls back to label). Return updated workflow.
4. UI (app.js): a rename control on the workflow card (e.g. a small ✏️ on the header or in expanded detail) → prompt/input → calls the endpoint → refreshes. Cards/dashboard show display_name ?? label everywhere the name is shown.
5. Telegram (/overmind, /om_tasks): show display_name ?? label too.
6. The Telegram notification messages (W1) should also use display_name ?? label.
7. npx tsc clean.

Likely files:
- src/db/database.ts (v16 + migration)
- src/services/overmind-service.ts (display_name field, setDisplayName, preserve-on-upsert)
- src/api/routes/overmind-routes.ts (POST :id/name, JWT)
- src/web/public/app.js (rename control + display name everywhere)
- src/bot/assistant-core.ts (/overmind, /om_tasks show display_name ?? label)
- src/services/overmind-notifications.ts (use display_name ?? label)
- tests: service (register/setTasks preserve display_name; setDisplayName sets/clears) + route (POST :id/name auth + sets) 

Scope: rename/display_name ONLY. Don't touch history (W4). Migration safe on live DB. The preserve-on-upsert is the critical rule (test it). Surgical.

Tests (targeted):
- register a row with display_name set → re-register (upsert) → display_name UNCHANGED (the critical test). setDisplayName sets + clears (null→falls back to label in display logic). Route requires auth. Run vitest + tsc + npm run build.

Plan handshake (MANDATORY): read brief + database.ts + overmind-service.ts (register/setTasks) + overmind-routes.ts + app.js + assistant-core.ts + overmind-notifications.ts. Reply STATUS: PROPOSED with v16 migration, preserve-on-upsert mechanism, endpoint, UI rename control, and display_name ?? label everywhere + tests. WAIT for APPROVED-PLAN.
After APPROVED-PLAN: implement, commit, gate (tests + tsc + npm run build). Artifacts batch-W3/changes.md + test-report.md + independent-validation.md. projcore LIVE-SMOKE: rename a workflow, re-register it, confirm the name sticks.
Completion: callback FIRST to plan/overmind/projcore-run-2026-05-21-r3/callbacks.md [projcore callback] W3 <STATE> <note>, THEN STATUS: <verb> -- reason.
