# B8 Review

## Scope Check
- In scope: R8.1 JSONL event log, 50MB rotation, R8.2 additive SQLite table and per-classification inserts, T4/T7/T8 telemetry tests.
- Out of scope: dashboard tile, new classification logic, destructive DB pragmas or schema changes.

## Diff Review
- Telemetry is added as helper functions and called after classification/action selection.
- AMBIGUOUS Tier-1 telemetry is recorded in `do_tick` so the action can distinguish `escalate-to-tier2` from `budget-capped`.
- Tier-2 telemetry is recorded after verdict parse with `spark_used=1`.
- Non-AMBIGUOUS Tier-1 telemetry is recorded from the existing classification collection path with `spark_used=0`.

## Safety
- Tests use temp DB and temp event-log overrides.
- The shared `projcore.db` was schema-checked and not modified by tests.
- No existing shared DB tables are altered or dropped.
