# Batch B5 Scenarios

## Covered Requirements

- R2.2: Active registry keeps daemon in AWAKE mode and uses `SPARK_DAEMON_TICK_BASE`.
- R2.3: Empty registry beyond the configured empty-poll threshold moves daemon to SLEEP and uses `SLEEP_INTERVAL`. Spark session reaping is B7-deferred.
- R2.4: A run appearing during SLEEP wakes the daemon within the next slow-poll cycle.
- R2.5: Empty registry never terminates the daemon; SIGTERM still exits 0.
- R7.3: Active-run registry response is cached for `SPARK_DAEMON_REGISTRY_TTL` seconds and stale/failing fetches fall back to the last good cache.

## Isolation

- Tests use a temp token file with `OVERMIND_TOKEN=test-token`.
- Tests use a temp mock HTTP server bound to `127.0.0.1` and only serving `GET /api/overmind/runs/active`.
- Tests use temp telemetry, PID, state-cache, and registry-cache paths.
- No test daemon monitors the live projcore run; the long-lived daemon test uses an empty registry fixture only.
