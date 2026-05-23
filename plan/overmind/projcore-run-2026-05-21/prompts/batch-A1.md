Batch-A1: Schema v11 `overmind_workflows` table + migration + OvermindService CRUD

Batch ID: A1
Plan: /home/agjrom/TGBOTS/AGJAssist/plan/overmind/implementation-plan.md
Requirements: /home/agjrom/TGBOTS/AGJAssist/plan/overmind/og-requirements.md (R1)
Branch: feat/overmind-a1-schema (create from current HEAD)
North-star anchors: NS-1 (host=AGJAssist Node process), NS-2 (watch coordinator+child), NS-8 (token efficiency)

Estimated duration: SHORT (atomic <30min)

Context:
Fresh project. Repo just git-init'd (baseline e72bc09). We are building "Overmind", a supervisor that watches projcore workflows. This first slice is persistence only — no watcher loop, no endpoints, no LLM. Those come in later batches.

Requirements section (verbatim, R1):
"A new `overmind_workflows` table (schema v11, CREATE TABLE IF NOT EXISTS in SCHEMA_SQL + a `version < 11` migration block matching the existing pattern in src/db/database.ts). Columns: id, label, coordinator_session, child_sessions (JSON list, watched-not-nudged), run_dir, status (active|working|waiting_human|awaiting_decision|stuck|paused|completed|failed), current_task (TEXT), tasks (TEXT JSON array of {id,label,state} where state in done|processing|pending), pending_decision (TEXT), last_pane_hash, last_activity_at, stuck_since, nudge_count, tier, created_at, updated_at. CRUD methods on the service layer using synchronous better-sqlite3 prepared statements."

Observed (current state):
- src/db/database.ts: `const SCHEMA_VERSION = 10;` (line ~5). SCHEMA_SQL is a template string of CREATE TABLE IF NOT EXISTS blocks. Migrations are `if (current && current.version < N) { ... }` blocks (existing: <2,<5,<6,<7,<8,<9,<10).
- Services (e.g. src/services/note-service.ts) take the db handle and use `this.db.prepare(sql).all(...params)` / `.get()` / `.run()` — synchronous better-sqlite3.
- Tests: vitest (tests/ dir, vitest.config.ts). better-sqlite3.

Expected (acceptance criteria):
1. `SCHEMA_VERSION` bumped 10 → 11.
2. `overmind_workflows` table added to SCHEMA_SQL with exactly the columns above. `status` constrained via CHECK to the 9 listed values, default 'active'. `child_sessions`, `tasks` stored as TEXT JSON strings (default `'[]'`). `current_task`, `pending_decision` nullable TEXT. Timestamps default to `datetime('now')`. Add an index on `coordinator_session` and on `status`.
3. A `version < 11` migration block added following the existing pattern so existing DBs upgrade in place (CREATE TABLE IF NOT EXISTS is sufficient; ensure the block exists for version-record consistency).
4. New `src/services/overmind-service.ts` exporting class `OvermindService` constructed with the db handle (match NoteService constructor style). Methods (sync): `register(input)` (insert OR upsert by coordinator_session — if a row with that coordinator_session exists, update its fields & set status back to 'active'), `list(status?)`, `get(id)`, `getBySession(coordinator_session)`, `update(id, fields)`, `setStatus(id, status)`, `setTasks(id, current_task, tasks[])`, `delete(id)`. Define `OvermindWorkflow` + `OvermindTask` ({id,label,state}) TS interfaces; `tasks`/`child_sessions` serialize to/from JSON at the service boundary (callers see arrays, DB stores TEXT). NO watcher loop, NO endpoints, NO LLM in this batch.
5. `npx tsc` is clean.

Likely files:
- src/db/database.ts (SCHEMA_VERSION, SCHEMA_SQL, migration block)
- src/services/overmind-service.ts (NEW)
- tests/overmind-service.test.ts (NEW)

Scope:
- ONE atomic vertical slice: schema + CRUD + a round-trip test. Tight diff. If your PROPOSED plan is bigger than ~30min, say so and propose a split — do not widen.
- Do NOT add endpoints, the watcher loop, Telegram commands, UI, or any LLM call — those are A2-A7.
- Do NOT modify unrelated tables or services.
- Surgical only. No "while I'm in here".

Tests (per NS-6, targeted only):
- tests/overmind-service.test.ts (vitest, in-memory or temp better-sqlite3): create schema, then assert register→list→get→getBySession→update→setStatus→delete round-trip, including child_sessions JSON round-trip and the upsert-by-coordinator_session path. ~1-3 focused tests.
- Run: `npx vitest run tests/overmind-service.test.ts`. Also `npx tsc` clean.

Plan handshake protocol (MANDATORY before writing code):
1. Read this brief in full + the referenced files (database.ts schema/migration area, note-service.ts for style).
2. Reply with PROPOSED: mechanism-level approach (exact column DDL, where the migration block goes, OvermindService method signatures) + planned files + risks + estimate confirmation.
3. End reply with: STATUS: PROPOSED — <one-line summary>.
4. WAIT for projcore APPROVED-PLAN before writing code.
5. If REVISE-PLAN, address gaps and re-emit STATUS: PROPOSED.

After APPROVED-PLAN:
6. Implement on branch feat/overmind-a1-schema. Commit with a clear message.
7. Reply STATUS: DONE — <summary> when tsc clean + the vitest test passes.

Required artifacts (write under plan/overmind/projcore-run-2026-05-21/, backend batch — adapt "screenshots" to command output):
- batch-A1/changes.md (Requirement verbatim + Root Cause/Design mechanism + per-file Code Changes with WHY)
- batch-A1/test-report.md (vitest output, what each test proves)
- batch-A1/independent-validation.md (fresh-context self-check: does R1 read as closed?)
- decisions/<date>-<slug>.md for any non-trivial autonomous call, OR state "Autonomous decisions: none — matched brief defaults."

Completion protocol:
- Write the callback FIRST, before prose: append `[projcore callback] A1 <STATE> <note>` to plan/overmind/projcore-run-2026-05-21/callbacks.md, THEN write your reply.
- End every reply with a dedicated line: `STATUS: <PROPOSED|APPROVED-PLAN|REVISE-PLAN|DONE|BLOCKED|NEEDS-INFO> — <short reason>`. Bare tokens without the STATUS prefix don't reach projcore reliably.
- Default to cost-aware model; this is low-risk schema work.
