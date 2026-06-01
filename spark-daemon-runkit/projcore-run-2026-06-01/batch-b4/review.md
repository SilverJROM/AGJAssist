# Batch B4 Review

- `cmd_register` spawn runs only after `post_ok "$resp"` and therefore does not spawn on rejected 404 or failed registration.
- Isolated tests set `SPARK_DAEMON_TELEMETRY_DIR`/`SPARK_DAEMON_PID_FILE`, so T3 does not consult the live singleton process and cannot attach to AGJ-51.
- HARD action order is callback write, stall-alert, then TG payload; test mocks both external side effects.
- MEDIUM action writes only the daemon callback prefix and leaves TG/stall logs unchanged.
- Watcher callback detection remains exact: it searches `\[projcore callback\][[:space:]]+<batch-id>\b`, so SPARK-DAEMON prefixes are non-completion alerts.
