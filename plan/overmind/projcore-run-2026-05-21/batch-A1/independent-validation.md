# Batch A1 Independent Validation

## Fresh-Context Check Against R1

R1 asks for schema v11 persistence only: an `overmind_workflows` table, a matching migration block, and service-layer CRUD with synchronous better-sqlite3 statements.

## Requirement Closure

- Schema version is now 11.
- `SCHEMA_SQL` creates `overmind_workflows` with the required columns.
- `status` is constrained to `active`, `working`, `waiting_human`, `awaiting_decision`, `stuck`, `paused`, `completed`, and `failed`, with default `active`.
- `child_sessions` and `tasks` are TEXT JSON in SQLite and arrays at the service boundary.
- Indexes exist for `coordinator_session` and `status`.
- A `current.version < 11` migration block exists.
- `OvermindService` provides `register`, `list`, `get`, `getBySession`, `update`, `setStatus`, `setTasks`, and `delete`.
- `register` upserts by `coordinator_session` and resets the workflow to `active`.
- Tests prove insert/list/get/update/setStatus/delete and JSON round-trip behavior.

## Out-Of-Scope Check

No endpoints, watcher loop, Telegram commands, UI, tmux calls, or LLM calls were added.

## Autonomous Decisions

Added `tests/**/*.test.ts` to `vitest.config.ts` because the approved gate requires `npx vitest run tests/overmind-service.test.ts`, while the repo only discovered `*.spec.ts`. This was limited to test discovery and does not affect runtime behavior.
