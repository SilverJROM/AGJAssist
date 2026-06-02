# Batch B6b Changes

## Scope

- Implemented remediation-first spark daemon behavior in `/home/agjrom/.claude/agents/lib/overmind-spark-daemon.sh`.
- Added `SPARK_DAEMON_REMEDIATION_MAX`, default `3`.
- Added per-run cache fields:
  - `remediation_state`
  - `remediation_count`
  - `last_remediation_epoch`
- Added an artifact snapshot at `artifacts/overmind-spark-daemon.sh`.

## Behavior

- Alert-facing states (`CRASHED`, `ALERT-HARD`, `ALERT-MEDIUM`) now nudge the run coordinator before any JROM escalation.
- Coordinator nudges are single-line tmux sends prefixed with `spark-daemon:` and include attempt count plus the diagnosis.
- Re-nudges reuse the B6a repeat window from `SPARK_DAEMON_ALERT_REPEAT_MIN`, including the existing 60-second floor.
- JROM escalation happens only after `SPARK_DAEMON_REMEDIATION_MAX` nudges are exhausted, the problem is still present, and the final B6a de-dup gate allows it.
- The final JROM-facing reason is consolidated as a true blocker and records how many remediation nudges spark already tried.
- Recovery / non-alert classifications clear remediation state and B6a alert state.
- Tier-2 `ALERT-HARD` and `ALERT-MEDIUM` verdicts now drive the same coordinator nudge ladder instead of directly alerting JROM.
- `ALERT-SOFT` and other transient/non-alert classifications do not nudge or escalate.

## Files

- `/home/agjrom/.claude/agents/lib/overmind-spark-daemon.sh`
- `plan/overmind-register-hardening/projcore-run-2026-06-01/batch-b6b/artifacts/overmind-spark-daemon.sh`
- `plan/overmind-register-hardening/projcore-run-2026-06-01/batch-b6b/test-b6b.sh`
- `plan/overmind-register-hardening/projcore-run-2026-06-01/batch-b6b/changes.md`
- `plan/overmind-register-hardening/projcore-run-2026-06-01/batch-b6b/test-report.md`
