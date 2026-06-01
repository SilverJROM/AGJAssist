# Decision: Spark Model Launch And Pane Parse

## Context

B6 requires a literal `spark-daemon` tmux session running Codex model `gpt-5.3-codex-spark`. The installed Codex CLI supports `--model`, and the pane also echoes user-entered prompt text that contains the required status protocol.

## Decision

- Default launch command: `codex --model gpt-5.3-codex-spark --dangerously-bypass-approvals-and-sandbox`.
- Keep `SPARK_DAEMON_CODEX_CMD` as an override for future Codex CLI model-mechanism changes.
- Filter prompt/request lines while parsing `STATUS: SPARK-TICK-DONE` so the daemon cannot parse its own brief as the spark verdict.

## Consequence

The production default satisfies R5.1 while tests can safely pre-create a mocked responder with a test session name. Verdict parsing waits for responder output, not the daemon's own instructions.
