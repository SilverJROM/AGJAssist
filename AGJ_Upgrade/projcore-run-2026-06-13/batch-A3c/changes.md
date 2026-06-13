# Batch A3c Changes

## Branch: `feat/agj-upgrade-A3c-events-ws`

Cut from `feat/agj-upgrade-A3b-wake-scheduler`.

## User Report (verbatim from brief)

"R18 — Structured-event chat transport: chat renders from a structured event channel (DB row + WebSocket push), NOT pane scraping; each message has real role + status + timestamp."

## Root Cause (mechanism-level)

Feature: adds the backend transport half of R18 by pushing app-owned `agent_events` rows to authenticated WebSocket subscribers keyed by `run_id`.

## Code Changes

- `src/api/websocket/agent-events-stream-manager.ts` — Added a dedicated authenticated WebSocket stream manager for `agent_events`, with run-id subscriber sets, ping/pong, cleanup, run-scoped broadcast, and last-50 replay snapshot.
- `src/api/routes/agent-events-routes.ts` — Added `/ws/agent-events/:runId` route registration using the existing Fastify websocket plugin pattern.
- `src/services/agent-events-service.ts` — Added additive event listeners and emits the persisted row after inserts or terminal-status merge updates.
- `src/index.ts` — Wired `AgentEventsStreamManager` to `AgentEventsService.recordEvent()` results.
- `src/api/server.ts` — Accepted the optional agent-events stream manager and registered the websocket route.
- `tests/unit/agent-events-stream-manager.spec.ts` — Added delivery, isolation, replay, auth, and payload-shape tests.

## Standing Rules (if discovered)

- `agent_events` websocket subscriptions are keyed by `run_id`; session remains an event attribute, not a subscription topic.
- Keep overmind websocket transport untouched for R14 compatibility.

## Verification

- Targeted websocket tests: PASS (`npx vitest run tests/unit/agent-events-stream-manager.spec.ts`)
- Build: PASS (`npm run build`)
- Full suite: PASS (`npx vitest run`)

## Bug Reproductions (if bug fixes)

- Not a bug-fix batch.

## Caveats

- Working tree contained pre-existing unrelated modified/untracked planning and audit artifacts before A3c. A3c changes are scoped to source, tests, and A3c artifacts.

Autonomous decisions: none.
