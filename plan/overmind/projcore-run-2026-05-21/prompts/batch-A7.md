Batch-A7: UI /overmind panel + OvermindStreamManager WS (live dashboard) — completes Stage A

Batch ID: A7
Requirements: plan/overmind/og-requirements.md (R10, R11, completes R14-display)
Branch: feat/overmind (CONTINUE)
North-star anchors: NS-10 (tasklist done/processing/pending), NS-8 (status reads pure DB)

Estimated duration: SHORT (atomic <30min). If PROPOSED reveals >30min, split (A7a panel / A7b WS) — don't widen.

Context (read context-handoff.md first):
Backend done (A1-A6b). A7 is the dashboard JROM looks at: a Workflows panel + live updates. After A7, Stage A is complete.

Requirements (verbatim):
R10: "A /overmind Preact/HTM view in src/web/public/app.js (nav link + component), fed by GET /api/overmind/workflows, showing each workflow's label, coordinator + child sessions, status, current_task, tier, stuck-time, and an expandable tasklist rendering each task as done/processing/pending (from the tasks JSON), plus the pending_decision text when awaiting_decision."
R11: "An OvermindStreamManager (cloned from src/tmux/tmux-stream-manager.ts) over /ws/overmind broadcasting status updates so the panel updates live."

Observed:
- src/web/public/app.js: Preact + HTM, no build. `useRoute()`/`navigate()`, `api(path,opts)` helper (adds Bearer). Existing nav links + route switch + panel components. app.css for styles. index.html loads app.js.
- GET /api/overmind/workflows (JWT) returns {workflows:[...]} with: id,label,coordinator_session,child_sessions(array),run_dir,status,current_task,tasks(array of {id,label,state}),pending_decision,tier,stuck_since,nudge_count,last_activity_at.
- src/tmux/tmux-stream-manager.ts: Map<target,Set<WS>> + broadcast pattern. src/api/routes/tmux-routes.ts: ws route `app.get('/ws/tmux/:target',{websocket:true},handler)` with token query.
- src/services/overmind-watcher.ts: tick() updates rows. Inject an optional broadcast/onUpdate callback to push snapshots after each tick.

Expected (acceptance criteria):
1. UI (R10): nav link "Workflows" → `#/overmind`; a component fetching GET /api/overmind/workflows. Render per workflow: label, status with an icon (working ▶, stuck ⚠, waiting_human ⏸, awaiting_decision ❓, paused ⏯, completed ✅), current_task, tier, stuck-duration (now - stuck_since when stuck), coordinator_session + child_sessions, an expandable/visible tasklist (each task: ✓ done / ◐ processing / ○ pending + label) with a done/total summary, and the pending_decision text shown prominently when status==='awaiting_decision'. Density-light, consistent with existing panels + app.css.
2. WS (R11): new src/api/websocket/overmind-stream-manager.ts (or co-located following tmux-stream-manager pattern): Set<WebSocket> of subscribers; `broadcast(workflows)` sends JSON. Register `/ws/overmind` route (token query auth like /ws/tmux). Wire OvermindWatcher → after each tick, call an injected broadcaster with the current list (overmindService.list()). UI subscribes to /ws/overmind for live refresh; fall back to the GET poll if WS drops.
3. `npx tsc` clean. Frontend has no build step — just edit app.js/app.css; ensure no syntax errors (the server serves the static file).

Likely files:
- src/web/public/app.js (nav link + OvermindWorkflows component + WS subscription)
- src/web/public/app.css (panel styles, if needed)
- src/api/websocket/overmind-stream-manager.ts (NEW) OR src/services/
- src/api/routes/overmind-routes.ts (add /ws/overmind route) + server.ts if needed
- src/index.ts + src/services/overmind-watcher.ts (inject broadcaster)
- tests/overmind-stream.test.ts (NEW) — stream manager subscribe/broadcast/unsubscribe + any pure UI formatting helper

Scope:
- UI panel + WS live updates ONLY. Do NOT change backend classification/nudge/brain logic (only inject a broadcast callback into the watcher).
- Surgical. Match Preact/HTM + app.css conventions.

Tests (targeted):
- tests/overmind-stream.test.ts: OvermindStreamManager add/remove client, broadcast sends JSON to open clients only, no throw on closed client. + any extracted pure helper (status icon, task glyph, stuck-duration formatting).
- vitest env is 'node' (no jsdom) → test pure logic + stream manager, NOT DOM rendering.
- Run `npx vitest run tests/overmind-stream.test.ts` + `npx tsc`.

Plan handshake (MANDATORY): read brief + handoff + app.js (routing/api/panel patterns) + tmux-stream-manager.ts + tmux-routes.ts ws + overmind-watcher.ts. Reply STATUS: PROPOSED with: the component structure, the WS manager + route, how the watcher broadcasts, and the test plan (pure helpers + stream manager). WAIT for APPROVED-PLAN.

After APPROVED-PLAN: implement on feat/overmind, commit, gate. Artifacts batch-A7/changes.md + test-report.md + independent-validation.md + decisions/ if any.

Completion: callback FIRST `[projcore callback] A7 <STATE> <note>`, THEN reply ending STATUS: <verb> -- reason.
