Batch-O3: OVM tab UI (live chat view of the OVM session + open/restart/close)

Batch ID: O3
Requirements: og-requirements-ovm.md (OU3)
Branch: feat/overmind (CONTINUE)
Estimated: SHORT.

Context: O2 built the session manager endpoints (POST /api/overmind/ovm/open|restart|close, GET /api/overmind/ovm/status — JWT). The OVM session is a tmux 'OVM' running claude --dangerously-skip-permissions --model sonnet. AGJAssist already streams a tmux pane to the web via the WS at /ws/tmux/:target (TmuxStreamManager) with input forwarding ({type:input}→send-keys). Reuse that.

Requirement (OU3): "A 4th tab 'OVM' beside Active/Completed/History. Renders a live chat/terminal view of the OVM session (reuse the tmux WS stream /ws/tmux/OVM... + input box → send-keys), with Open / Restart / Close buttons + a status dot. Input sends to OVM; output streams live. Chat-styled."

Expected (acceptance):
1. Add an 'OVM' tab to the dashboard tab bar (Active / Completed / History / OVM). Selecting it shows the OVM console (not a workflow list).
2. OVM console:
   - Header: Open / Restart / Close buttons + a status dot (open/closed) — call POST /api/overmind/ovm/open|restart|close + GET /status (JWT, via the existing api() helper).
   - Live view of the OVM pane: connect to the existing WS /ws/tmux/OVM:0.0 (or the correct target for session 'OVM'; reuse how the Terminal view connects). Render the streamed pane (reuse terminal-chat-state.js friendly formatting for a chat-ish look).
   - Input box + send: forward typed text to the OVM pane via the WS {type:'input'} (same as the terminal input) — so chatting with the OVM brain works.
   - When OVM is closed/not open: show an 'Open OVM' prompt instead of the stream.
3. Reuse the existing tmux WS streaming + input mechanism (don't build a new transport). Reuse the Terminal view's WS connection pattern.
4. npx tsc clean.

Likely files: src/web/public/app.js (OVM tab + console component + WS wiring, reusing the terminal WS pattern), src/web/public/style.css (console styling), maybe a small helper. (Backend ovm endpoints already exist from O2.)
Scope: the OVM tab UI ONLY (open/restart/close controls + live stream + input). Backend exists. Don't touch detection/O6/O7. Frontend.
Tests: any pure helper (e.g. ws target builder, status formatting). Run tsc + npm run build. (DOM/WS live behavior verified by projcore manually.)

Plan handshake (MANDATORY): read brief + app.js (the Terminal view's WS connection + input + the tab bar from W4) + tmux-stream-manager.ts + the ovm endpoints in overmind-routes.ts. Reply STATUS: PROPOSED with the tab addition, the console component, how it reuses the terminal WS + input, the open/restart/close wiring, and tests. WAIT for APPROVED-PLAN.
After APPROVED-PLAN: implement, commit, gate (tsc + npm run build). Artifacts batch-O3/changes.md + test-report.md + independent-validation.md.
Completion: callback FIRST to plan/overmind/projcore-run-2026-05-21-ovm/callbacks.md [projcore callback] O3 <STATE> <note>, THEN STATUS: <verb> -- reason.
