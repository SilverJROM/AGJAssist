# Batch B5 Review

## Scope Review

PASS. The daemon now queries the canonical B2 endpoint `/api/overmind/runs/active`; no older `/api/runs/active` path was added.

PASS. The registry cache defaults to `SPARK_DAEMON_REGISTRY_TTL=30`, avoids a second endpoint fetch within the TTL, refreshes when stale, and reuses the last good cache on a 503 fixture.

PASS. The lifecycle uses the existing `STATE` and `SLEEP_INTERVAL` scaffolding: active runs force AWAKE, repeated empty polls enter SLEEP, and a later active run wakes the daemon.

PASS. B7 sleep-time spark session reaping was not implemented.

PASS. R2.5 is preserved: empty registry moves to SLEEP and the process remains alive; SIGTERM exits 0.

## Autonomous Decisions

- Added `SPARK_DAEMON_SLEEP_AFTER_POLLS` as a test-only/direct override so lifecycle tests can avoid real waits while production continues to derive the threshold from `SPARK_DAEMON_SLEEP_AFTER_MIN`.
- Made `SLEEP_INTERVAL` env-overridable for isolated fast tests; production default remains 300.
