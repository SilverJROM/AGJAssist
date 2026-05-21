# Batch A3 Independent Validation

## Fresh-Context Check Against R4 / R5 / R15 Detection

A3 should add deterministic detection only. It should observe coordinator and child tmux panes, detect busy, decision, waiting-human, and stuck states, and persist those fields. It should not nudge, call LLMs, send Telegram messages, add UI, change endpoints, or start the watcher interval.

## Requirement Closure

- `classifyWorkflow` is exported and pure.
- The classifier accepts coordinator pane text, child pane text, previous coordinator hash, run-dir mtime activity, previous stuck timestamp, and current timestamp.
- Busy markers are detected across all panes using the required marker family: `esc to interrupt`, `Working (`, `Waiting for`, `Compacting`, and `Thinking`.
- Coordinator pane hash changes classify as `working`.
- Run directory mtime advancement classifies as `working`.
- Coordinator decision menus classify as `awaiting_decision` and capture bounded prompt text into `pendingDecision`.
- Plain pending-human wording classifies as `waiting_human`.
- Frozen panes accrue `stuck_since` and become `stuck` only after the 90 second threshold.
- `OvermindWatcher.tick()` reads non-terminal workflows, captures coordinator and child panes, stats `callbacks.md`, `progress.md`, and `queue.md`, classifies, and updates the workflow row.
- `start()` and `stop()` are present, but no application startup wiring was added.

## Out-Of-Scope Check

No `sendCommand`, `sendEnter`, nudge, LLM, Telegram, UI, endpoint, or `index.ts` startup changes were added.

## Validation

`npx tsc` passed. `npx vitest run tests/overmind-classifier.test.ts` passed with 7 tests.
