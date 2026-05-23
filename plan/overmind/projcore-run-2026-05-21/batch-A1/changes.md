# Batch A1 Changes

## Requirement

"A new `overmind_workflows` table (schema v11, CREATE TABLE IF NOT EXISTS in SCHEMA_SQL + a `version < 11` migration block matching the existing pattern in src/db/database.ts). Columns: id, label, coordinator_session, child_sessions (JSON list, watched-not-nudged), run_dir, status (active|working|waiting_human|awaiting_decision|stuck|paused|completed|failed), current_task (TEXT), tasks (TEXT JSON array of {id,label,state} where state in done|processing|pending), pending_decision (TEXT), last_pane_hash, last_activity_at, stuck_since, nudge_count, tier, created_at, updated_at. CRUD methods on the service layer using synchronous better-sqlite3 prepared statements."

## Root Cause / Design Mechanism

AGJAssist had schema version 10 and no Overmind persistence surface. Batch A1 adds only the persistence layer needed by later batches: a versioned SQLite table, upgrade path, and a synchronous service that keeps JSON serialization inside the service boundary.

## Code Changes

- `src/db/database.ts`
  - Bumped `SCHEMA_VERSION` from 10 to 11.
  - Added `CREATE TABLE IF NOT EXISTS overmind_workflows` with the required columns.
  - Added status CHECK constraint for the nine approved statuses and default `active`.
  - Stored `child_sessions` and `tasks` as TEXT JSON with default `'[]'`.
  - Added indexes on `coordinator_session` and `status`.
  - Added explicit `current.version < 11` migration block following the existing migration pattern.

- `src/services/overmind-service.ts`
  - Added `OvermindService` with synchronous better-sqlite3 prepared statements.
  - Added `register`, `list`, `get`, `getBySession`, `update`, `setStatus`, `setTasks`, and `delete`.
  - Added `OvermindWorkflow`, `OvermindTask`, and status/task-state TS types.
  - Kept `child_sessions` and `tasks` as arrays for callers and TEXT JSON in SQLite.
  - Implemented `register` as an upsert by `coordinator_session`, resetting existing rows to `active`.

- `tests/overmind-service.test.ts`
  - Added focused schema and CRUD round-trip coverage, including JSON array round-trip and upsert by coordinator session.

- `tests/unit/database.spec.ts`
  - Updated schema-version assertion from 10 to 11.

- `vitest.config.ts`
  - Added `tests/**/*.test.ts` to the include list so the required command `npx vitest run tests/overmind-service.test.ts` discovers the mandated test file.
