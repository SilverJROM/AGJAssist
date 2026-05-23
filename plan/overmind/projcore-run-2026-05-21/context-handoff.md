## Accepted: A1-A6b all PASS (A4, A5 needed iter1). Stage A nearly done — only A7 (UI) left.
Branch: feat/overmind (no master merge until JROM review).
Implemented: schema+CRUD (A1), endpoints (A2), classifier (A3), Telegram cmds + live watcher (A4), nudge ladder coordinator-only (A5), Sonnet brain Tier-3 + BLOCKED/waiting_human (A6a), decision interception + ALWAYS-ESCALATE guardrail + R16 correction (A6b). Brain + decisions live-verified.
Req#s VERIFIED: R1,R2,R3,R4,R5,R6,R7,R8*,R9,R15,R16. IN-PROGRESS: R14 (UI display). Open: R10,R11 (A7), R12 (B), R13 (C).

## Next: Batch-A7 — UI panel /overmind + OvermindStreamManager WS (R10, R11, completes R14)
Key facts:
- Frontend: src/web/public/app.js — Preact + HTM (no build step), hash routing `useRoute()`/`navigate()`, `api(path)` helper (sends JWT). index.html loads app.js. app.css for styles.
- GET /api/overmind/workflows (A2, JWT-auth) returns {workflows:[...]} with all fields incl status, current_task, tasks (JSON array {id,label,state}), pending_decision, coordinator_session, child_sessions, tier, stuck_since, nudge_count.
- R10: add a 'Workflows' nav link + a `/overmind` route + component rendering each workflow: label, status (icon), current_task, tier, stuck-time, coordinator + child sessions, and an expandable tasklist (done/processing/pending glyphs from tasks JSON), plus pending_decision text when awaiting_decision.
- R11: OvermindStreamManager — clone the pattern of src/tmux/tmux-stream-manager.ts (Map<key,Set<WebSocket>>, broadcast JSON). Register a WS route /ws/overmind in a route module (see tmux-routes.ts ws pattern: app.get('/ws/...', {websocket:true}, handler)). The watcher (OvermindWatcher) should broadcast a status snapshot after each tick (inject an optional onUpdate/broadcast callback into the watcher from index.ts, wired to the stream manager). The UI panel subscribes for live updates (fallback to polling GET if WS not connected).
- Keep it consistent with existing panels (Preact/HTM, app.css classes). Density-light per JROM style.
- Auth: WS uses the token query pattern like /ws/tmux (token in query). GET uses Bearer.
- LIVE SMOKE: projcore will register a throwaway workflow and load the dashboard (#/overmind) to confirm it renders + updates. (May be limited by not having a browser; projcore will at minimum verify GET returns the data the panel needs + the WS route exists + broadcasts. A static render check via the component code.)
- Test: a focused test for any pure formatting helper (status icon, task glyph, stuck-duration) + that the WS route + stream manager broadcast wiring exists. Avoid brittle DOM tests if no jsdom configured (check vitest env — it's 'node'); test pure helpers + the stream manager logic.

After A7: Stage A complete. Then Stage B (edit ~/.claude/agents/projcore.md — register/tasks/complete curls + frontload reinforcement, R12), then Stage C (onboard 3 live workflows — STOP & CONFIRM with JROM per NS-7 before any keystroke into hris-d-22/lkcamp-12/lkvc-38).
