# Batch B6a Changes

## Scope

- Implemented R6.3 alert de-duplication in `/home/agjrom/.claude/agents/lib/overmind-spark-daemon.sh`.
- Added `SPARK_DAEMON_ALERT_REPEAT_MIN`, default `60`.
- Added per-run cache fields:
  - `last_alert_state`
  - `last_alert_epoch`
- Added an artifact snapshot at `artifacts/overmind-spark-daemon.sh`.

## Alert Rule

- Alert-facing states are classifications whose mapped action is `alert-hard` or `alert-medium`: `CRASHED`, `ALERT-HARD`, `ALERT-MEDIUM`.
- First transition into an alert-facing state emits the existing side effects.
- Repeated ticks in the same alert-facing state suppress the JROM-facing side effects.
- Persistent same-state alerts re-surface only when `now_epoch - last_alert_epoch >= SPARK_DAEMON_ALERT_REPEAT_MIN * 60`; values below one minute are clamped to 60 seconds.
- Any non-alert-facing classification clears `last_alert_state` and `last_alert_epoch`, so recovery followed by a new crash alerts again.
- Telemetry rows still write every tick; only callback/stall-alert/notify side effects are gated.

## Files

- `/home/agjrom/.claude/agents/lib/overmind-spark-daemon.sh`
- `plan/overmind-register-hardening/projcore-run-2026-06-01/batch-b6a/artifacts/overmind-spark-daemon.sh`
- `plan/overmind-register-hardening/projcore-run-2026-06-01/batch-b6a/test-b6a.sh`
- `plan/overmind-register-hardening/projcore-run-2026-06-01/batch-b6a/changes.md`
- `plan/overmind-register-hardening/projcore-run-2026-06-01/batch-b6a/test-report.md`
