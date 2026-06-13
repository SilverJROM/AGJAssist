# B4 Scenarios (acceptance per brief)

## R18 — Structured-event chat transport
- Subscribe to /ws/agent-events/:runId (A3c path-param + token) for selected project's run_id (from B3 launch sessionTarget or `agj-os-${projectId}`).
- On connect: receive snapshot (last N backlog) and render all.
- Live: receive "event" updates, append to transcript.
- Each event rendered as role-labeled bubble (projcore/accent, grok/purple, codex/teal, me/secondary + right-aligned) + timestamp.
- `status` (or state-bearing) events render as first-class .chip (success/warning/accent) e.g. PROPOSED, APPROVED-PLAN, WORKING, DONE, gate PASS.
- tool/diff/gate internals collapsed behind clickable .exp expanders (local state).
- NO pane scraping anywhere in the Agent OS chat path (transcript only consumes events state populated from WS/seed).
- On re-connect / re-select: replay backlog.

## R19 — Interface = Grok desktop + Opus mobile
- Desktop (wide): split layout, chat left (~flex:1), persistent ~230px live rail right (who's-working placeholder/derived from recent events + batch stub).
- Mobile (≤480px viewport): real @media query collapses rail (display:none), shows .mobilestrip (collapsible details with avatars + agents + progress), chat full-width, composer position:sticky pinned at bottom + safe-area.
- AGJAssist GitHub-dark palette (exact :root from mocks + style.css base).
- Status first-class chips, internals collapsed, not walls of text.
- Matches grok-build/index.html (desktop) + opus/index.html (mobile) structure/classes.

## R8 (chat-half) — talk to the project's session
- Composer (input + accent send) at bottom of chat column.
- On send: optimistic local echo (.me bubble + text) immediately.
- POST /api/projects/:projectId/agent-message {text, target?} behind [authMiddleware, requireOwner].
- Server resolves target (agj-os-${id}:0.0 or passed), calls tmuxService.send(target, text, true) — reuses B3 session + tmux-service path, no reimpl.
- (Real event from runtime callback will appear via WS later.)

## R14 — No regression
- Existing Agent OS (agents CRUD, role mappings, global defaults, B3 Launch button + result) fully functional and unchanged.
- All other sections (Dashboard, Projects, Terminals, Tasks, Overmind, Settings, Conversations) load and work.
- Build (npx tsc) clean.
- FULL npx vitest run green (delta: new send test + existing).
- Playwright smoke (navigate + seed + assert DOM outcomes + responsive viewports + screenshots) passes for the chat subtree.
- Terminals tab and overmind completely untouched.

## Test proof
- Backend: Fastify inject POST → asserts tmux.send called for correct agj-os- target (spy, owner token).
- Frontend: Playwright navigate to #/agent-os?b4smoke (forces seed of message+status events), assert .transcript bubbles/chips/.exp/.me, .rail vs .mobilestrip on viewports, screenshots to batch-B4/screenshots/ (desktop + mobile).
- All assert OUTCOMES (visible rendered content from events data, responsive switch), not "code exists".
