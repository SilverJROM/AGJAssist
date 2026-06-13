# Batch A3c Independent Validation

## Evidence

- `AgentEventsStreamManager` test uses temp SQLite plus fake WebSocket clients and wires `AgentEventsService.onEvent(...)` to the manager, matching production write-to-broadcast flow.
- Replay assertion records run-X and run-Y rows, subscribes to run X, and verifies the snapshot includes only the run-X row with `role`, `type`, `state`, and `ts`.
- Delivery/isolation assertion subscribes one socket to run X and one to run Y, records a run-X event, and verifies only the run-X socket receives an `event` message.
- Auth assertion verifies invalid tokens receive an error and close before subscriber registration.
- `npm run build` proves API wiring and route registration type-check.
- Full `npx vitest run` stayed green, including existing overmind websocket tests, confirming overmind transport behavior was not regressed.

## Verdict

PASS — implementation satisfies A3c acceptance criteria for authenticated run-id-keyed `agent_events` websocket transport, isolation, structured payload shape, replay, and R14-safe separation from overmind WS.
