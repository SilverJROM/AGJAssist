# Batch B7 Changes

## User Report

GO - IMPLEMENTER (codex), /projcore from AGJ-51. SPARK DAEMON new batch - read+execute IN FULL NOW: /home/agjrom/TGBOTS/AGJAssist/spark-daemon-runkit/projcore-run-2026-06-01/prompts/batch-b7.md (R5.4 budget cap 12/hr per-run, 13th AMBIGUOUS log-only no-dispatch + resets hourly; R5.5 reap the spark session on SLEEP; T8/T9 mock-isolated). bash -n. Conventional commit. Callback FIRST. Handshake: STATUS: PROPOSED then WAIT. DISPATCH-MARKER: AGJ-B7

## Root Cause

B6 added Tier-2 dispatch for every AMBIGUOUS classification, but there was no spend limiter. A frozen or repeatedly ambiguous run could keep sending spark briefs indefinitely. B5 also intentionally left the SLEEP-time spark-session reap as a B7 placeholder, so the Tier-2 tmux session stayed alive even when the daemon slowed down due to an empty registry.

## Implementation

- `/home/agjrom/.claude/agents/lib/overmind-spark-daemon.sh`
  - Added `SPARK_DAEMON_BUDGET_PER_HOUR`, default `12`.
  - Added a per-run `spark_budget` object in the existing state cache with `hour_bucket`, `count`, `limit`, and last `action`.
  - Uses UTC epoch-hour buckets: `floor(epoch_seconds / 3600)`. When the bucket changes, the per-run count resets before incrementing the current AMBIGUOUS attempt.
  - Increments every AMBIGUOUS attempt. Counts `1..12` dispatch Tier-2; count `13+` logs `classification=AMBIGUOUS action=budget-capped` and skips spark dispatch.
  - Added `SPARK_DAEMON_NOW_EPOCH` test override for deterministic bucket rollover tests.
  - Added `spark_reap_session_on_sleep`; the SLEEP transition now kills `SPARK_DAEMON_SESSION_NAME` if alive.
- `spark-daemon-runkit/projcore-run-2026-06-01/batch-b7/test-b7.sh`
  - Added mock-isolated T8/T9 tests with temp state/registry files and test-only tmux sessions.
- `spark-daemon-runkit/projcore-run-2026-06-01/batch-b7/artifacts/overmind-spark-daemon.sh`
  - Snapshot of the deployed live daemon after B7 changes.

## Autonomous Decisions

- UTC epoch-hour buckets were used for R5.4 because they give a deterministic clean hourly reset and are straightforward to test with an injectable epoch.
- The budget state lives in the existing JSON state cache so B8 can add telemetry persistence without introducing a second B7-only state store.

## Caveats

- SQLite/event-log persistence for `budget-capped` remains intentionally deferred to B8.
