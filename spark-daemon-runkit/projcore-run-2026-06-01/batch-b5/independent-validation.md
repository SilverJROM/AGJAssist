# Batch B5 Independent Validation

Validator: implementer self-check with isolated fixtures and prior-batch regression scripts.

PASS. Real active-run query uses `GET ${OVERMIND_URL}/api/overmind/runs/active` with `X-Overmind-Token` read from `OVERMIND_TOKEN_FILE` using the same `OVERMIND_TOKEN=` format as `overmind.sh`.

PASS. `list_active_runs` parses `runs[]` and feeds run id, run dir, and child sessions into `spark_collect_run_signals`; empty or invalid responses produce no active rows instead of crashing.

PASS. `SPARK_DAEMON_REGISTRY_TTL=30` cache is honored; two ticks inside the TTL make one endpoint request, stale cache re-fetches, and a 503 response reuses the last good cache.

PASS. Lifecycle behavior is test-backed without real waits: temp env overrides shorten tick/sleep thresholds while production defaults remain 30s base tick, 5min empty threshold, and 300s sleep poll.

PASS. R2.5 is test-backed: with an isolated empty registry, the daemon reaches SLEEP and remains alive until SIGTERM; SIGTERM exits 0.

PASS. No daemon in the B5 tests monitors the live run; the only long-lived daemon test uses an empty mock registry and temp telemetry.
