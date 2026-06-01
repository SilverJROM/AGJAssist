# Batch B5 Decisions

- Added `SPARK_DAEMON_SLEEP_AFTER_POLLS` for deterministic lifecycle tests without waiting minutes. Production behavior still derives from `SPARK_DAEMON_SLEEP_AFTER_MIN=5`.
- Allowed `SLEEP_INTERVAL` to be env-overridden for isolated tests. Production default remains 300.
- Deferred the R2.3 spark-session kill-on-sleep behavior to B7 as required by the B5 brief.
