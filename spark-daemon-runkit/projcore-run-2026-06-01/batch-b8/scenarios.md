# B8 Scenarios

## Covered
- T4-full: HEALTHY tick does not write a run callback, but writes one JSONL event and one SQLite row with `tier=1`, `classification=HEALTHY`, `action=no-op`, `spark_used=0`.
- T7-telemetry: AMBIGUOUS tick escalates to mocked Tier-2 spark verdict and writes a Tier-2 JSONL event plus SQLite row with `spark_used=1`.
- T8-telemetry: budget-capped AMBIGUOUS tick writes a SQLite row with `action=budget-capped` and `spark_used=0`.
- Rotation: oversized event log rotates to `.1` before a fresh event is appended; threshold is lowered by `SPARK_DAEMON_EVENT_LOG_MAX_BYTES` for the test.

## Isolation
- Tests override `SPARK_DAEMON_DB` to a temp SQLite file.
- Tests override `SPARK_DAEMON_EVENT_LOG` to a temp JSONL file.
- Tests use isolated tmux session names and temp run dirs.
- Tests do not write rows into the shared `~/.claude/agents/telemetry/projcore.db`.
