# B6 Review

## Scope Check

- In scope: R5.1-R5.3 daemon Tier-2 spark session, per-tick brief, verdict parsing, timeout behavior, and T7 pane-only isolation.
- Out of scope untouched: R5.4 budget cap, R5.5 sleep reaping, R8 telemetry persistence, dashboard.

## Diff Review

- `do_tick` now preserves the `spark_collect_run_signals` output and invokes Tier-2 only when `classification=AMBIGUOUS`.
- Tier-1 CRASHED/ALERT action handling remains in `spark_collect_run_signals`; no extra spark action runs for non-AMBIGUOUS classifications.
- Spark dispatch uses separate tmux calls for text, `C-m`, and capture.
- Verdict parsing filters out the daemon's own prompt/request lines before parsing a status line.

## Risks

- The `spark-daemon` tmux pane is long-lived by design; B7 owns budget caps and sleep reaping.
- The spark response is free-form except for the required status protocol; parser supports `HEALTHY`, `ALERT-SOFT`, `ALERT-MEDIUM`, `ALERT-HARD`, and maps `STUCK` to `ALERT-HARD`.

## Result

PASS. The isolated T7 mocked responder proves pane-visible verdict parsing and R6 callback action without spawning real Codex.
