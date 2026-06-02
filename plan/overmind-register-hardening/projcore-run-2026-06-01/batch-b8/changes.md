## Batch B8 Changes

Implemented R8 token-aware Tier-2 model selection in `/home/agjrom/.claude/agents/lib/overmind-spark-daemon.sh`.

### What changed

- Added `SPARK_DAEMON_TOKEN_FLOOR_PCT`, default `5`.
- Added `SPARK_DAEMON_USAGE_SH`, default `${HOME}/.claude/agents/lib/agent-usage.sh`.
- Added Sonnet fallback controls:
  - `SPARK_DAEMON_SONNET_SESSION_NAME`, default `${SPARK_DAEMON_SESSION_NAME}-sonnet`
  - `SPARK_DAEMON_SONNET_CMD`, default `claude --dangerously-skip-permissions --model sonnet`
- Added `spark_select_tier2_model`, which calls `agent-usage.sh check` once per Tier-2 dispatch and parses `rungs.spark.headroom`, `rungs.spark.depleted`, `rungs.sonnet.headroom`, and `rungs.sonnet.depleted`.
- Generalized Tier-2 spawn/send/wait helpers to accept a selected session/cmd while preserving the existing default spark call shape.
- Updated `spark_run_tier2_verdict` selection behavior:
  - Spark headroom >= floor: dispatch to spark.
  - Spark headroom < floor and Sonnet is healthier/not depleted: dispatch to Sonnet.
  - Spark and Sonnet depleted/under floor: skip Tier-2 for this round, log `tier2-token-depleted`, and record `spark_used=0`.

### Files

- `/home/agjrom/.claude/agents/lib/overmind-spark-daemon.sh`
- `plan/overmind-register-hardening/projcore-run-2026-06-01/batch-b8/artifacts/overmind-spark-daemon.sh`
- `plan/overmind-register-hardening/projcore-run-2026-06-01/batch-b8/test-b8.sh`
- `plan/overmind-register-hardening/projcore-run-2026-06-01/batch-b8/changes.md`
- `plan/overmind-register-hardening/projcore-run-2026-06-01/batch-b8/test-report.md`

### Notes

- The kill-switch remains in `~/.claude/agents/lib/overmind.sh`: the disable marker `${HOME}/.claude/agents/telemetry/spark-daemon.disabled` and `SPARK_DAEMON_DISABLED=1` still prevent daemon spawning.
- The daemon does not call direct usage endpoints; usage is read only through `agent-usage.sh check`.
