# Batch W5 Changes

User Report verbatim:
"W5 = per-run elapsed reset: add run_started_at (reset on every register) + accumulated_ms; current Elapsed times the CURRENT run (resets on re-register), Total = accumulated + current. Schema v15 guarded migration + backfill run_started_at=created_at for existing rows."

Root Cause mechanism:
Overmind elapsed time was computed from `created_at`. Because `created_at` is intentionally preserved across `register()` upserts, re-registering the same coordinator session made the displayed elapsed time accumulate across separate runs.

Changes:
- `src/db/database.ts`: bumped schema to v15, added `run_started_at` and `accumulated_ms`, and added an idempotent guarded migration that backfills `run_started_at = created_at`.
- `src/services/overmind-service.ts`: added workflow fields and changed `register()` to roll the prior run elapsed into `accumulated_ms`, reset `run_started_at` to the current register time, and recompute `ended_at` from the new tasklist.
- `src/web/public/overmind-helpers.js`: added `currentElapsedMs()` and `totalElapsedMs()` with robust ISO/SQLite/null timestamp handling.
- `src/web/public/app.js`: changed the workflow card to show current run elapsed as the primary value and total elapsed as a secondary value.
- `src/web/public/style.css`: made the total elapsed value visually secondary.
- `tests/overmind-service.test.ts`: covered v15 schema, migration backfill, re-register roll-up/reset, and mixed timestamp math.
- `tests/overmind-stream.test.ts`: covered current/total elapsed helpers and preserved legacy helper behavior.

Autonomous decisions: none.
