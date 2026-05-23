# Batch A7 Changes

User Report verbatim:
Next batch A7 (IMPLEMENTER; Claude /projcore supervises) — the UI dashboard, completes Stage A. Read plan/overmind/projcore-run-2026-05-21/context-handoff.md then plan/overmind/projcore-run-2026-05-21/prompts/batch-A7.md and follow EXACTLY. A7 = /overmind Preact/HTM panel (nav link + component showing status/current_task/tasklist done-processing-pending/pending_decision) + OvermindStreamManager WS /ws/overmind for live updates. Backend logic unchanged (only inject a broadcast callback into the watcher). vitest env is node (no jsdom) — test pure helpers + stream manager, not DOM. MANDATORY handshake: STATUS: PROPOSED first, WAIT for APPROVED-PLAN. Stay on feat/overmind. Callback FIRST on state change. Give me your PROPOSED plan now.

Approved adjustment:
Shared UI pure helpers live in `src/web/public/overmind-helpers.js` as plain ESM so both the static browser app and Vitest import the same source without a frontend build step.

Root Cause mechanism:
Stage A had authoritative Overmind state in the DB and GET `/api/overmind/workflows`, but no web route rendered that state and no workflow-specific WebSocket channel pushed watcher updates to the dashboard.

Per-file WHY:
- `src/web/public/overmind-helpers.js`: added one browser-safe source of truth for status icons, task glyphs, done counts, stuck duration, and WS URL formatting.
- `src/web/public/app.js`: added the Workflows nav/card/route and `OvermindWorkflows` Preact/HTM panel with GET load, `/ws/overmind` subscription, and polling fallback.
- `src/web/public/style.css`: added compact Overmind panel styling consistent with existing card/list surfaces.
- `src/api/websocket/overmind-stream-manager.ts`: added authenticated subscriber management and snapshot/update broadcasts for Overmind workflows.
- `src/api/routes/overmind-routes.ts`: registered `/ws/overmind` with token query auth when a stream manager is provided.
- `src/api/server.ts`: passed the optional Overmind stream manager into route registration.
- `src/index.ts`: constructed `OvermindStreamManager` and injected watcher broadcast wiring.
- `src/services/overmind-watcher.ts`: added optional `onUpdate` callback invoked after each tick's state updates.
- `tests/overmind-stream.test.ts`: covered stream manager auth/broadcast/cleanup, watcher callback timing, and shared public helpers.

Autonomous decisions: none.
