# Batch B5 Changes

## User Report

GO — IMPLEMENTER (codex), /projcore from AGJ-51. SPARK DAEMON new batch — read+execute IN FULL NOW: `/home/agjrom/TGBOTS/AGJAssist/spark-daemon-runkit/projcore-run-2026-06-01/prompts/batch-b5.md` (lifecycle awake/sleep/wake wired to the B2 endpoint + 30s TTL cache, R2.2-R2.5/R7.3 — replace B1's list_active_runs stub with the real GET /api/overmind/runs/active query; daemon NEVER self-exits R2.5; testable without real waits; isolate so no daemon monitors the live run). bash -n. Conventional commit. Callback FIRST. Handshake: STATUS: PROPOSED then WAIT. DISPATCH-MARKER: AGJ-B5

## Root Cause

B1 intentionally left `list_active_runs` as an empty stub and only scaffolded `STATE=AWAKE` plus `SLEEP_INTERVAL=300`. That meant the daemon loop could tick, but it never read the B2 active-runs endpoint, never classified real active runs from the registry, never cached the registry response, and never changed between AWAKE and SLEEP based on registry emptiness.

## Files Changed

- `/home/agjrom/.claude/agents/lib/overmind-spark-daemon.sh`: added Overmind URL/token config, `GET /api/overmind/runs/active`, 30s TTL registry cache with last-good fallback, active-run TSV parsing, lifecycle state transitions, PID state fields, and interval selection through `CURRENT_TICK_INTERVAL`.
- `spark-daemon-runkit/projcore-run-2026-06-01/batch-b5/test-b5.sh`: added isolated mock-endpoint tests for AWAKE/SLEEP/WAKE, TTL cache, fetch-failure fallback, no autonomous exit, and SIGTERM exit 0.
- `spark-daemon-runkit/projcore-run-2026-06-01/batch-b5/artifacts/overmind-spark-daemon.sh`: committed snapshot of the deployed daemon.
- `spark-daemon-runkit/projcore-run-2026-06-01/callbacks.md`: callback status entries for B5.

## Caveats

- R2.3's spark-session kill on sleep is explicitly deferred to B7 and is not implemented in B5.
- The daemon logs fetch failures and reuses the last good cache when available; no fetch failure path exits the daemon.
