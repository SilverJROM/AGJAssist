# B10 Scenarios

User report:

GO - IMPLEMENTER (codex), /projcore from AGJ-51. SPARK DAEMON CAPSTONE - read+execute IN FULL NOW: /home/agjrom/TGBOTS/AGJAssist/spark-daemon-runkit/projcore-run-2026-06-01/prompts/batch-b10.md (R10 full T1-T10 acceptance sweep against the complete deployed daemon, ONE durable acceptance-t1-t10.sh, ALL mock-isolated; any real failure->BLOCK/flag, do NOT weaken). bash -n. Conventional commit. Callback FIRST. Handshake: STATUS: PROPOSED then WAIT. DISPATCH-MARKER: AGJ-B10

Scenarios:

| Test | Scenario |
|---|---|
| T1 | Daemon `bash -n` is clean, the acceptance script `bash -n` is clean, and `--help` prints the verb/option table. |
| T2 | A second daemon instance against the same temp PID/flock exits 0 silently in less than 100ms while the first stays alive. |
| T3 | Real `overmind.sh register` against a mock loopback register endpoint spawns the daemon into temp telemetry within 5s. |
| T4 | HEALTHY fixture writes no callbacks and records HEALTHY in temp event log and temp SQLite. |
| T5 | CRASHED fixture writes `[projcore SPARK-DAEMON-HARD]` and invokes a mocked `overmind.sh stall-alert`. |
| T6 | `projcore-watcher.sh` sees a `[projcore SPARK-DAEMON-HARD]` line but does not exit 0 as if it were `[projcore callback]`. |
| T7 | AMBIGUOUS frozen busy pane dispatches to a mocked spark tmux session and records Tier-2 telemetry. |
| T8 | The 13th AMBIGUOUS in the same hour is budget-capped, does not dispatch spark, and records `action=budget-capped`. |
| T9 | Empty registry beyond the sleep threshold enters SLEEP, uses 300s slow poll, and kills the isolated spark session. |
| T10 | `--once` runs one tick and exits 0. |

Isolation:

- Temp PID files, state caches, registry caches, event logs, SQLite DBs, run dirs, and callback files.
- Mock spark tmux responder for Tier-2 verdicts.
- Mock register endpoint for T3 and mock `stall-alert` command for T5.
- No live `:3101`, no `wf=4`, no real `projcore.db`, no real TG, and no real `spark-daemon` session.
