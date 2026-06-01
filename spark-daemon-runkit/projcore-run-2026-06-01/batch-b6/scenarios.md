# B6 Scenarios

## User Report
GO - IMPLEMENTER (codex), /projcore from AGJ-51. SPARK DAEMON new batch (the namesake Tier-2 spark feature) - read+execute IN FULL NOW: /home/agjrom/TGBOTS/AGJAssist/spark-daemon-runkit/projcore-run-2026-06-01/prompts/batch-b6.md (R5.1-R5.3: on AMBIGUOUS, lazy-spawn literal  codex session gpt-5.3-codex-spark, per-tick /clear+3-call brief, parse STATUS: SPARK-TICK-DONE within 60s, timeout->ALERT-SOFT; T7 pane-only). ISOLATE the T7 test (mock spark responder / temp env) - do NOT burn a real spark against the live run. bash -n. Conventional commit. Callback FIRST. Handshake: STATUS: PROPOSED then WAIT. DISPATCH-MARKER: AGJ-B6

## Covered

- R5.1: AMBIGUOUS ticks lazy-spawn/reuse one tmux session named by `SPARK_DAEMON_SESSION_NAME`, default literal `spark-daemon`, running Codex with `--model gpt-5.3-codex-spark` and `--dangerously-bypass-approvals-and-sandbox`.
- R5.2: each Tier-2 tick sends `/clear` first, then submits one single-line brief via separate send, submit, capture calls using `C-m`.
- R5.2: the brief includes run id, run dir, child sessions, Tier-1 classification reason, all current R3 signal values, pane tails, progress tail, and callbacks tail.
- R5.3: the daemon waits up to `SPARK_DAEMON_TICK_TIMEOUT` seconds for `STATUS: SPARK-TICK-DONE`, parses the verdict, and maps Tier-2 action through existing R6 action handling.
- R5.3 timeout: no status line within the timeout becomes `ALERT-SOFT`, logs the spark hang, and the daemon loop continues.
- T7 isolation: tests use a test-suffixed tmux session and mocked responder; they do not spawn or attach to literal `spark-daemon`.

## Deferred By Contract

- R5.4 budget cap remains B7.
- R5.5 spark session reaping on sleep remains B7.
- Tier-2 telemetry persistence remains B8.
