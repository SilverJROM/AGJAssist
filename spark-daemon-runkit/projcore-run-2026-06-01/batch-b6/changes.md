# B6 Changes

## User Report
GO - IMPLEMENTER (codex), /projcore from AGJ-51. SPARK DAEMON new batch (the namesake Tier-2 spark feature) - read+execute IN FULL NOW: /home/agjrom/TGBOTS/AGJAssist/spark-daemon-runkit/projcore-run-2026-06-01/prompts/batch-b6.md (R5.1-R5.3: on AMBIGUOUS, lazy-spawn literal  codex session gpt-5.3-codex-spark, per-tick /clear+3-call brief, parse STATUS: SPARK-TICK-DONE within 60s, timeout->ALERT-SOFT; T7 pane-only). ISOLATE the T7 test (mock spark responder / temp env) - do NOT burn a real spark against the live run. bash -n. Conventional commit. Callback FIRST. Handshake: STATUS: PROPOSED then WAIT. DISPATCH-MARKER: AGJ-B6

## Root Cause Mechanism

B3/B5 could classify a run as `AMBIGUOUS`, but the daemon had no Tier-2 path after the classifier. `do_tick` discarded the signal summary, so no spark pane was spawned, no per-tick brief was sent, and no Tier-2 verdict could feed R6.

## Files Changed

- `/home/agjrom/.claude/agents/lib/overmind-spark-daemon.sh`
  - Added Tier-2 settings: `SPARK_DAEMON_TICK_TIMEOUT`, `SPARK_DAEMON_SESSION_NAME`, `SPARK_DAEMON_MODEL`, and `SPARK_DAEMON_CODEX_CMD`.
  - Added lazy tmux spawn/reuse for the spark session.
  - Added `/clear` plus single-line brief dispatch with `C-m` submit.
  - Added verdict wait/parse and timeout-to-`ALERT-SOFT` handling.
  - Wired only `AMBIGUOUS` Tier-1 classifications to Tier-2; direct Tier-1 action behavior remains unchanged.
- `spark-daemon-runkit/projcore-run-2026-06-01/batch-b6/artifacts/overmind-spark-daemon.sh`
  - Snapshot of the deployed daemon.
- `spark-daemon-runkit/projcore-run-2026-06-01/batch-b6/test-b6.sh`
  - Isolated T7 and timeout test harness with temp state/registry/run dirs and test-suffixed mocked tmux spark responders.

## Model Selection

The daemon defaults to:

```bash
codex --model gpt-5.3-codex-spark --dangerously-bypass-approvals-and-sandbox
```

This uses the current Codex CLI model flag. `SPARK_DAEMON_CODEX_CMD` can override the whole launch command if a future Codex version changes the model mechanism or an operator needs a profile/env-based launch.

## Safety Notes

- The default production session name is literally `spark-daemon`.
- Tests override the session name with `spark-daemon-test-b6-*` and pre-create mocked responders, so no real spark session is launched and the live run is not monitored.
- The parser ignores the daemon's own prompt/request lines containing `STATUS: SPARK-TICK-DONE`; otherwise the pane could parse the brief instead of the spark response.

## Autonomous Decisions

- See `decisions/2026-06-01-spark-model-and-pane-parse.md`.
