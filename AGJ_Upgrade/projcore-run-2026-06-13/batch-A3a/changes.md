# Batch A3a Changes

- Added additive `agent_events` schema in fresh DB SQL and migration `v32 -> v33`.
- Added `AgentEventsService` for structured event inserts, run-scoped reads, and terminal provenance merge.
- Added `AgentEventIngest` sidecar service for callback, git HEAD, and pane-idle normalization.
- Kept `OvermindWatcher` unchanged; A3a sits alongside it and reuses `TmuxService` pane capture plus existing pane hash/busy utilities.
- Added outcome tests for callback DONE, silent git DONE, multi-signal dedupe, structured message round-trip, and pane-idle prior-activity guard.
- Updated DB tests to expect current schema version `33`.

Autonomous decisions: none.
