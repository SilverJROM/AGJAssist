# Batch B7 Scenarios

## User Report

GO - IMPLEMENTER (codex), /projcore from AGJ-51. SPARK DAEMON new batch - read+execute IN FULL NOW: /home/agjrom/TGBOTS/AGJAssist/spark-daemon-runkit/projcore-run-2026-06-01/prompts/batch-b7.md (R5.4 budget cap 12/hr per-run, 13th AMBIGUOUS log-only no-dispatch + resets hourly; R5.5 reap the spark session on SLEEP; T8/T9 mock-isolated). bash -n. Conventional commit. Callback FIRST. Handshake: STATUS: PROPOSED then WAIT. DISPATCH-MARKER: AGJ-B7

## Covered Requirements

- R5.4: Per-run `SPARK_DAEMON_BUDGET_PER_HOUR` cap defaults to `12`, resets by hourly UTC epoch bucket, and caps further AMBIGUOUS Tier-2 spend during the same hour.
- R5.5: On SLEEP transition, the daemon reaps `SPARK_DAEMON_SESSION_NAME` if that tmux session exists.

## Tests

- T8 behavior: drive 13 AMBIGUOUS ticks for one run in the same hour. The first 12 dispatch Tier-2, the 13th logs `action=budget-capped`, does not dispatch, and increments the counter to 13.
- T8 reset: advance the injectable epoch to the next UTC hour bucket. The next AMBIGUOUS dispatches and resets the per-run counter to 1.
- T9 full: force empty registry lifecycle into SLEEP with an isolated `SPARK_DAEMON_SESSION_NAME`; assert slow-poll interval and that `tmux has-session` fails after the reap.

## Isolation

- Tests use temp telemetry, registry, state, pid files, and run directories.
- Tests use unique tmux session names suffixed with the test PID.
- Tests do not spawn or kill the real `spark-daemon` session.
- Tests use a mock Tier-2 responder and do not invoke a real Codex spark model.
