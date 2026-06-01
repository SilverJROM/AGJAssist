# Batch B3 Changes

## User Report

APPROVED-PLAN for B3. Verified your classifier against og-requirements R4 — it matches EXACTLY (CRASHED = session-dead OR watcher-pid-dead is correct per spec; HEALTHY requires watcher-alive; IDLE-CLEAN = Worked-for + no-busy + no-fresh-progress; AMBIGUOUS precedence right). 7 signals + atomic state cache + fixtures all good. One care point you flagged: add the source/test-mode guard so functions are callable without launching main, WITHOUT changing the daemon's runtime behavior (default invocation must still run main exactly as B1) — and bash -n must pass on the deployed file. Proceed. Callback FIRST on DONE.

## Root Cause / Need

The B1 daemon skeleton only provided singleton/loop scaffolding. B3 needed the detection core: per-run Tier-1 signal collection, R4 classification, and persistent prior-tick state so later batches can wire active-run iteration, alerts, Tier-2 spark, and telemetry.

## Files Changed

- `~/.claude/agents/lib/overmind-spark-daemon.sh`: deployed daemon implementation with source-only guard, R3 signal helpers, R4 classifier, collection function, and atomic JSON state cache.
- `spark-daemon-runkit/projcore-run-2026-06-01/batch-b3/artifacts/overmind-spark-daemon.sh`: reference snapshot of the deployed daemon.
- `spark-daemon-runkit/projcore-run-2026-06-01/batch-b3/test-classifier-fixtures.sh`: fixture-based shell tests.
- `spark-daemon-runkit/projcore-run-2026-06-01/batch-b3/*.md`: batch evidence artifacts.
- `spark-daemon-runkit/projcore-run-2026-06-01/callbacks.md`: B3 state callbacks.

## Scope Notes

- No R5 spark session, R6 callback alerting, R7 endpoint polling, R8 telemetry persistence, R9 overmind.sh integration, or lifecycle sleep/wake wiring was added.
- Default runtime behavior remains `main "$@"`; tests opt out with `SPARK_DAEMON_SOURCE_ONLY=1`.
- Autonomous decisions: none.
