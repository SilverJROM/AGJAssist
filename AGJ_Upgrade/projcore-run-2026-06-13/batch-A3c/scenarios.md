# Batch A3c Scenarios

## Requirement

R18 — Structured-event chat transport: chat renders from a structured event channel (DB row + WebSocket push), NOT pane scraping; each message has real role + status + timestamp.

## Scope

- Broadcast persisted `agent_events` rows over WebSocket.
- Key subscriptions by `run_id`.
- Keep overmind websocket behavior unchanged.
- Replay a small recent backlog to late subscribers.

## Acceptance Scenarios

- A client subscribed to run X receives a newly recorded run-X `agent_events` row over WebSocket.
- A client subscribed to run Y does not receive run-X events.
- Event payloads include structured fields including `role`, `type`, `state`, and `ts`.
- A late subscriber receives the last 50 persisted events for its run in the initial snapshot.
- An invalid token is rejected before subscription.

Autonomous decisions: none.
