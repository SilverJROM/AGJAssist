# Batch A3 Changes

## Requirements

R4: Add a deterministic Overmind watcher loop that captures the coordinator and child tmux panes, hashes the coordinator pane, checks run directory mtimes, and updates workflow rows. No LLM in the loop.

R5-scoped: Add a deterministic state machine for working, awaiting_decision, waiting_human, and stuck. Do not infer completed or failed.

R15-detection: Detect actionable workflow states without nudging, Telegram, UI, or LLM calls.

## Root Cause / Design Mechanism

A1/A2 persisted and exposed Overmind workflows, but no deterministic reader existed to observe live coordinator state. A3 adds a pure classifier and a watcher wrapper that only reads tmux panes plus run directory mtimes, then persists detection results through `OvermindService.update`.

## Code Changes

- `src/services/overmind-watcher.ts`
  - Added exported constants `POLL_MS = 45_000`, `STUCK_THRESHOLD_MS = 90_000`, and `CAPTURE_LINES = 200`.
  - Added pure exported `classifyWorkflow(input)` and `hashPane(pane)`.
  - Added busy marker detection across coordinator and child panes.
  - Added coordinator decision-menu detection for numbered options plus menu footer text.
  - Added plain human-wait detection for `NEEDS-INFO` and direct pending-input wording.
  - Added frozen-pane stuck timer behavior. Sub-threshold frozen panes stay `working`, preserve `last_activity_at`, and keep/accrue `stuck_since`.
  - Added `OvermindWatcher.tick()` to capture panes, stat `callbacks.md`, `progress.md`, and `queue.md`, classify, and update workflow rows.
  - Added `OvermindWatcher.start()` and `stop()` interval management without wiring or starting it anywhere.

- `tests/overmind-classifier.test.ts`
  - Added focused unit coverage for working via busy marker, working via hash change, awaiting decision with captured prompt text, waiting human, sub-threshold frozen behavior, and stuck after threshold.

## Scope Guard

- No `index.ts` wiring.
- No interval start.
- No `sendCommand`, `sendEnter`, nudge, LLM, Telegram, endpoint, or UI changes.

## Self-Verification

- `npx tsc`: PASS.
- `npx vitest run tests/overmind-classifier.test.ts`: PASS.

## Caveats

- A4 is expected to instantiate and start the watcher from application startup.
