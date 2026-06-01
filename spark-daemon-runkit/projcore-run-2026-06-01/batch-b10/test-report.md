# B10 Test Report

## Commands

- `bash -n spark-daemon-runkit/projcore-run-2026-06-01/batch-b10/acceptance-t1-t10.sh`
- `bash -n /home/agjrom/.claude/agents/lib/overmind-spark-daemon.sh`
- `spark-daemon-runkit/projcore-run-2026-06-01/batch-b10/acceptance-t1-t10.sh`

## Result Table

| Test | Result | Evidence |
|---|---|---|
| T1 | PASS | `bash -n` clean for daemon and acceptance script; `--help` includes verb table, `--once`, `--help`, and `SPARK_DAEMON_TICK_BASE`. |
| T2 | PASS | Second instance exited 0 silently in 17ms while the first isolated daemon process stayed alive. |
| T3 | PASS | Real `overmind.sh register` against a mock loopback endpoint spawned the daemon into temp telemetry within 5s. |
| T4 | PASS | HEALTHY fixture wrote no SPARK callback and recorded HEALTHY in temp event log plus temp SQLite. |
| T5 | PASS | CRASHED fixture wrote `[projcore SPARK-DAEMON-HARD]`, fired mocked `stall-alert`, and recorded CRASHED/action=`alert-hard` in temp SQLite. |
| T6 | PASS | `projcore-watcher.sh` ignored `[projcore SPARK-DAEMON-HARD]` as a completion callback and exited 5, not 0. |
| T7 | PASS | AMBIGUOUS frozen busy pane dispatched to mocked spark; pane showed `STATUS: SPARK-TICK-DONE ALERT-MEDIUM`; temp telemetry recorded tier=2/spark_used=1. |
| T8 | PASS | 13th AMBIGUOUS in the same hour skipped spark dispatch; log and temp SQLite recorded `action=budget-capped`. |
| T9 | PASS | Empty registry entered SLEEP, used the 300s slow-poll interval, and killed the isolated spark session. |
| T10 | PASS | `--once` exited 0 and emitted exactly one tick. |

## Isolation

- No live `:3101` traffic.
- No `wf=4` mutation.
- No real `~/.claude/agents/telemetry/projcore.db` touch; every test used temp `SPARK_DAEMON_DB`.
- No real spark model/session; Tier-2 used an isolated tmux responder.
- No real TG/stall-alert side effects; notification was `/bin/true`, stall-alert used a temp mock.
