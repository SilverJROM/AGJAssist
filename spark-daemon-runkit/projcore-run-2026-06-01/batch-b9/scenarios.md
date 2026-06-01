# B9 Scenarios

## Scope
- R8.3 dashboard surface for per-run spark watchdog health.
- Source is the existing daemon state cache at `~/.claude/agents/telemetry/spark-daemon-state.json`.
- Browser-facing data is attached to `/api/overmind/workflows` and websocket workflow snapshots as `spark_health`.

## Covered
1. Active workflow with no daemon cache row renders `UNKNOWN` with neutral styling and `—` timestamp/ambiguous values.
2. Active workflow with cache row renders the daemon state, last classification timestamp, and minutes since the last AMBIGUOUS.
3. `last_ambiguous_at` is durable in the daemon state cache: set on AMBIGUOUS and preserved after later non-AMBIGUOUS classifications.
4. R6 tile colors are mapped in the dashboard: HEALTHY green, warning states yellow/amber, HARD/CRASHED red, UNKNOWN neutral.
5. Running app proof at `http://localhost:3101/#/overmind` uses a seeded state cache row for workflow 4.
