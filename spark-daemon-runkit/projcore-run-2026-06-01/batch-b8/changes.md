# B8 Changes

## User Report
GO — IMPLEMENTER (codex), /projcore from AGJ-51. SPARK DAEMON new batch — read+execute IN FULL NOW: /home/agjrom/TGBOTS/AGJAssist/spark-daemon-runkit/projcore-run-2026-06-01/prompts/batch-b8.md (R8.1 event log JSON+50MB rotation; R8.2 spark_daemon_ticks SQLite in projcore.db [additive CREATE IF NOT EXISTS, tests use a TEMP DB not the real shared projcore.db]; wire both into every tick; T4/T7/T8 telemetry). Read the real projcore.db schema FIRST to confirm no collision/disturbance. bash -n. Conventional commit. Callback FIRST. Handshake: STATUS: PROPOSED then WAIT. DISPATCH-MARKER: AGJ-B8

## Root Cause / Mechanism
Prior batches classified ticks and applied actions in memory, but B8 telemetry persistence was intentionally deferred. There was no JSONL event sink, no additive `spark_daemon_ticks` table creation, and no per-classification insert path for Tier-1, Tier-2, or budget-capped ticks.

## Files Changed
- `/home/agjrom/.claude/agents/lib/overmind-spark-daemon.sh`: deployed daemon now writes JSONL events with rotation and SQLite rows through configurable telemetry sinks.
- `spark-daemon-runkit/projcore-run-2026-06-01/batch-b8/test-b8.sh`: isolated B8 regression test for T4/T7/T8 telemetry and rotation.
- `spark-daemon-runkit/projcore-run-2026-06-01/batch-b8/artifacts/overmind-spark-daemon.sh`: snapshot of the deployed daemon.

## Implementation Notes
- Added `SPARK_DAEMON_EVENT_LOG`, `SPARK_DAEMON_EVENT_LOG_MAX_BYTES`, and `SPARK_DAEMON_DB` overrides.
- SQLite uses Python `sqlite3` parameter binding and `CREATE TABLE IF NOT EXISTS spark_daemon_ticks (...)`.
- The real shared DB schema was checked before and after tests; existing tables remain `usage_snapshots`, `tasks`, `runs`, and `sqlite_sequence`.

## Caveats
- Event-log rotation is single-depth (`.1`) as required by the batch brief.
- Dashboard tile work remains out of scope for B9.
- Autonomous decisions: none.
