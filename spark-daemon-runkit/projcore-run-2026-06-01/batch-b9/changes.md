# B9 Changes

## User Report
GO — IMPLEMENTER (codex), /projcore from AGJ-51. SPARK DAEMON new batch (UI) — read+execute IN FULL NOW: /home/agjrom/TGBOTS/AGJAssist/spark-daemon-runkit/projcore-run-2026-06-01/prompts/batch-b9.md (R8.3 per-run spark watchdog tile on the dashboard; spark_health {state,last_classification,minutes_since_ambiguous} colored per R6; source from spark-daemon-state.json — propose server-augment vs endpoint; Preact+htm; prove via running app + screenshot). Conventional commit. Callback FIRST. Handshake: STATUS: PROPOSED then WAIT. DISPATCH-MARKER: AGJ-B9

APPROVED-PLAN for B9 — option (a) augmenting /api/overmind/workflows + websocket is the right data source (browser-facing, vs the token-guarded daemon-facing runs/active), and good catch on the last_ambiguous_at gap. To satisfy R8.3 'minutes since last AMBIGUOUS' properly (not just while currently AMBIGUOUS), DO add a small durable last_ambiguous_at to the daemon's state-cache write: set it whenever a run classifies AMBIGUOUS, leave it as-is on other classifications, so minutes_since_ambiguous stays accurate after a run recovers. SCOPE-GUARD that daemon change tightly: ONLY add the last_ambiguous_at field to the state-cache write on AMBIGUOUS — do NOT touch classification/lifecycle/telemetry logic; bash -n must pass; and the B3/B5/B8 daemon fixtures must still pass (regression-check them). Then the tile reads last_ambiguous_at. Rest of the plan (R6 colors, UNKNOWN graceful, server helper, screenshot proof) is approved. Proceed. Callback FIRST on DONE.

## Root Cause
R8.3 had no browser-facing path for the daemon cache. `/api/overmind/runs/active` is intentionally loopback/token guarded for the daemon, while the dashboard already consumes `/api/overmind/workflows` and Overmind websocket snapshots. The daemon cache also did not retain a historical `last_ambiguous_at`, so `minutes_since_ambiguous` could not remain correct after recovery.

## Changes
- `/home/agjrom/.claude/agents/lib/overmind-spark-daemon.sh`: state-cache write now sets `last_ambiguous_at` only when `classification == "AMBIGUOUS"` and preserves it otherwise.
- `src/services/overmind/spark-health.ts`: new cache reader/normalizer for workflow `spark_health`.
- `src/api/routes/overmind-routes.ts`: `/api/overmind/workflows` now returns workflows augmented with `spark_health`.
- `src/api/websocket/overmind-stream-manager.ts`: websocket snapshot/update payloads include the same `spark_health` shape.
- `src/web/public/app.js` and `src/web/public/style.css`: active workflow cards render a compact spark watchdog tile with R6 color classes.
- `tests/overmind-routes.test.ts`: API coverage for seeded cache row and UNKNOWN fallback.
- `batch-b3/test-classifier-fixtures.sh`: regression assertion for `last_ambiguous_at` write/preserve behavior.
- `batch-b9/screenshots/01-dashboard-spark-health.png`: running-app proof.

## Autonomous Decisions
None beyond the approved option (a) server augmentation.
