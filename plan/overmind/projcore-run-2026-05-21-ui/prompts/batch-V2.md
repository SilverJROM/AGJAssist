Batch-V2: Active-session attribution — is the PARENT or a CHILD currently working

Batch ID: V2
Requirements: og-requirements-ui.md (RU3), north-star-ui.md (UI-NS-7)
Branch: feat/overmind (CONTINUE)

Estimated: SHORT (<30min). If PROPOSED is bigger, propose a split (V2a watcher+schema / V2b UI).

Context:
The watcher (src/services/overmind-watcher.ts) already captures the coordinator pane + each child pane every tick and scans for busy markers to decide working/stuck. RU3: also attribute WHICH session is the one currently busy — the parent coordinator or a child codex — and show it. Example from JROM: hrcdx-33 (child of hris-d) is working while hris-d-22 (parent) is idle/waiting.

Requirement (verbatim, RU3):
"The watcher determines WHICH session is currently busy — parent coordinator or a child codex — by per-pane busy-marker detection. Persist this (new column active_session TEXT + active_role 'parent'|'child'|null; schema v12 migration). The card (expanded detail) shows who's working, e.g. 'working: hrcdx-33 (child) · hris-d-22 (parent) idle/waiting'. If neither busy → none."

Observed:
- Schema currently v11 (src/db/database.ts: SCHEMA_VERSION=11, SCHEMA_SQL has overmind_workflows, migration blocks `if (current && current.version < N)`).
- overmind-watcher.ts: tick captures coordinator + children panes (capturePaneSafe), busy markers regex (/esc to interrupt|Working \(|Waiting for|Compacting|Thinking/i). classifyWorkflow + applyNudgeLadder.
- overmind-service.ts: OvermindWorkflow interface + CRUD (register/update/setStatus/setTasks). columns mapped at the service boundary.
- GET /api/overmind/workflows returns the row; app.js OvermindWorkflows renders the expanded detail (coordinator, children, tasklist).

Expected (acceptance):
1. Schema v12: add `active_session TEXT` (the busy session's name, or NULL) and `active_role TEXT` (CHECK in ('parent','child') or NULL) to overmind_workflows. SCHEMA_VERSION 11→12 + a `version < 12` migration that ALTERs the existing table (ADD COLUMN — the table already exists in live DBs, so CREATE-IF-NOT-EXISTS won't add columns; use ALTER TABLE ADD COLUMN in the migration, guarded/idempotent). Keep SCHEMA_SQL (fresh-DB path) in sync with the two new columns too.
2. overmind-service.ts: add active_session, active_role to the OvermindWorkflow interface + select/update mapping; update() accepts them.
3. overmind-watcher.ts: in tick, compute per-pane busy: if the COORDINATOR pane has busy markers → active_session=coordinator_session, active_role='parent'. ELSE if any CHILD pane has busy markers → active_session=that child session, active_role='child'. ELSE both null. Persist via update(). (This is independent of the working/stuck classification, which can stay as-is — the OR-of-all-panes busy still drives 'working'.)
4. app.js OvermindWorkflows (expanded detail): show a line attributing current work, e.g. "🔧 working: <active_session> (<active_role>)" and note the other side idle, or "— no session active" when null. Keep density-light.
5. `npx tsc` clean.

Likely files:
- src/db/database.ts (v12 + ALTER migration + SCHEMA_SQL columns)
- src/services/overmind-service.ts (interface + mapping)
- src/services/overmind-watcher.ts (per-pane attribution + persist)
- src/web/public/app.js (display) + maybe overmind-helpers.js (a pure helper to format the attribution line, node-testable)
- tests: extend a test for the attribution logic (pure helper) + a watcher/classifier-level test if feasible with mocked panes

Scope:
- Active-session attribution ONLY. Don't change tabs (V3), nav (V4), colors/collapse (V1 done), backend nudge/brain logic.
- Migration must be safe on the LIVE DB (ALTER ADD COLUMN, idempotent — guard if column exists).
- Surgical.

Tests (targeted):
- A pure helper (e.g. attributionLine(workflow) or the per-pane busy decision extracted) unit-tested in node: coordinator busy → parent; only child busy → child (by name); neither → none. Plus the migration adds columns (a db test). Run targeted vitest + tsc.

Plan handshake (MANDATORY): read brief + og/north-star + database.ts (migration pattern) + overmind-watcher.ts (tick + capture) + overmind-service.ts + app.js. Reply STATUS: PROPOSED with: the v12 ALTER migration approach (idempotent), where per-pane busy is computed in tick, the persisted fields, and the UI line + test approach. WAIT for APPROVED-PLAN.

After APPROVED-PLAN: implement on feat/overmind, commit, gate (targeted test + npx tsc + npm run build). Artifacts batch-V2/changes.md + test-report.md + independent-validation.md + decisions/ if any. NOTE: projcore will LIVE-SMOKE this (register a workflow at a real coordinator+child where the child is busy, confirm attribution).

Completion: append callback FIRST to plan/overmind/projcore-run-2026-05-21-ui/callbacks.md: `[projcore callback] V2 <STATE> <note>`, THEN reply STATUS: <verb> -- reason.
