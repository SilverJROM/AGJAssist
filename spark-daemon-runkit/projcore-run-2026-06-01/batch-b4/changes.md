# Batch B4 Changes

## User Report

APPROVED-PLAN for B4. Scope-guard + isolation are exactly right (cmd_register-only with a byte-identical diff of the other verbs, snapshot-first, bash -n both; T3 fully isolated temp env that can't touch the live AGJ-51 run; R6 Tier1-CRASHED→HARD now + Tier2-MEDIUM/HARD deferred to B6; R9.4 grep-proof). One confirm: in T5, MOCK the TG send + stall-alert (don't fire a real TG to JROM or a real stall-alert against any live run during the test) — use a fixture run only. Proceed. Callback FIRST on DONE.

## Root Cause / Need

B3 classified run state but did not act on classifications. B4 wires the live register entrypoint to keep the daemon alive and wires daemon alert actions for HARD/MEDIUM outcomes.

## Files Changed

- `~/.claude/agents/lib/overmind.sh`: in `cmd_register` success path only, added daemon spawn-if-needed after a successful register.
- `~/.claude/agents/lib/overmind-spark-daemon.sh`: added R6 action helpers for HARD/MEDIUM callback writes, mocked-testable stall-alert invocation, and notification-protocol TG payloads.
- `spark-daemon-runkit/projcore-run-2026-06-01/batch-b4/artifacts/overmind.sh`: snapshot of deployed `overmind.sh`.
- `spark-daemon-runkit/projcore-run-2026-06-01/batch-b4/artifacts/overmind-spark-daemon.sh`: snapshot of deployed daemon.
- `spark-daemon-runkit/projcore-run-2026-06-01/batch-b4/test-b4.sh`: T3/T5/T6 fixture tests.
- `spark-daemon-runkit/projcore-run-2026-06-01/batch-b4/*.md`: batch evidence artifacts.
- `spark-daemon-runkit/projcore-run-2026-06-01/callbacks.md`: B4 callbacks.

## Scope Notes

- `overmind.sh` diff is limited to `cmd_register`; a byte comparison of the file outside `cmd_register` passed.
- `complete` remains a registry terminal call only; no daemon kill was added.
- Tier-2 dispatch and verdict generation remain assigned to B6. B4 includes action handling for `ALERT-MEDIUM` and `ALERT-HARD` once B6 supplies those classifications.
- Autonomous decisions: none.
