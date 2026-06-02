# Batch B7 Changes

## Branch

`feat/ovm-register-hardening`

## User Report

"The main purpose of spark daemon is when the task is >1hr or more... the cadence of spark's check for 1-2hr task estimate (every 7-10 mins) and for >2hrs its 25-30 mins."

## Root Cause

The spark daemon escalated every Tier-1 `AMBIGUOUS` tick directly into the expensive Tier-2 Spark verdict path, so long-running tasks could trigger AI checks at the base tick interval instead of being paced by task estimate.

## Code Changes

- `/home/agjrom/.claude/agents/lib/overmind-spark-daemon.sh` - Added progress dispatch estimate parsing, estimate-band cadence mapping, `last_tier2_check_epoch` cache writes, and a `do_tick` gate before `spark_run_tier2_verdict`.
- `plan/overmind-register-hardening/projcore-run-2026-06-01/batch-b7/test-b7.sh` - Added mock-isolated injected-clock coverage for 1-2h, >2h, <1h, and default estimate cases.
- `plan/overmind-register-hardening/projcore-run-2026-06-01/batch-b7/artifacts/overmind-spark-daemon.sh` - Captured the daemon snapshot used for review.

## Behavior

- Latest `progress.md` dispatch line is the estimate source: `estimate_min: <N> bucket: <X>`.
- `60-120` minutes uses `SPARK_DAEMON_CADENCE_1_2H_MIN`, default `8`.
- `>120` minutes uses `SPARK_DAEMON_CADENCE_GT2H_MIN`, default `27`.
- `<60` minutes records Tier-1 ambiguous telemetry with `tier2-skipped-sub1h` and does not run Tier-2.
- Missing or malformed estimates use `SPARK_DAEMON_CADENCE_DEFAULT_MIN`, default `8`.
- CRASHED and non-AMBIGUOUS paths remain outside the Tier-2 cadence gate.

## Commits

- `HEAD` feat(spark-daemon): Tier-2 check cadence tied to task estimate (B7, R7)

## Verification

- Syntax: PASS (`bash -n /home/agjrom/.claude/agents/lib/overmind-spark-daemon.sh`)
- Syntax: PASS (`bash -n plan/overmind-register-hardening/projcore-run-2026-06-01/batch-b7/test-b7.sh`)
- B7 cadence tests: PASS (`plan/overmind-register-hardening/projcore-run-2026-06-01/batch-b7/test-b7.sh`)
- B6b remediation regression: PASS (`plan/overmind-register-hardening/projcore-run-2026-06-01/batch-b6b/test-b6b.sh`)

## Caveats

- PRE-EXISTING: `scripts/check-hardening.sh` is absent in this repo, so no hardened-module scan could run.
- PRE-EXISTING: the daemon target lives outside this Git worktree; reviewable source is captured in the batch artifact, matching B6a/B6b precedent.
