Batch-D2.1: OVM web chat → TRUE request/response chat (not a terminal)

Batch ID: D2.1 (re-scope of R10 per NS-9)
Branch: feat/chat-decommission-notes-ios (work directly; no sub-branch)
Requirements: R10 · North-star: NS-9

User report (verbatim, JROM):
"when i open the OVM chat it should be like a normal chat room where i send a message and OVM replies back like a person chatting with me and he does what he does on the background and he only sends me the replies to my queries. not a terminal view that we have right now"

Goal: replace the OVM terminal view with a real chat. User sends a message → "OVM is thinking…" → OVM's REPLY ONLY appears as a chat bubble. Hide all terminal/chrome/spinner/ANSI. Must handle long background work (don't cut off at 12s).

The model already exists for Telegram — REUSE it:
- src/bot/assistant-core.ts `relayOvmMessage` (~line 403-440): captures the pane before, sends the message to the OVM tmux session, polls (700ms) until output stabilizes, extracts the reply. It uses OVM_RELAY_* constants and OVM_SESSION_TARGET ("OVM").
- `hasActiveTurn(pane)` is EXPORTED from src/services/overmind-watcher.ts — it returns true while the Claude-Code TUI is mid-turn ("esc to interrupt" spinner, excluding status-bar chrome). Use it to know OVM is still working.
- `cleanTerminalOutput(text)` in src/web/public/terminal-chat-state.js (added in D2) strips ANSI + chrome — use the SAME logic server-side to clean the extracted reply (port/share a server equivalent, or strip in the existing relay-extract step).

Expected (acceptance criteria):
1. BACKEND: a send-and-await-reply path the web can call. Add owner/JWT-guarded endpoint(s) under /api/overmind/ovm/ (mirror the existing ovm/open|restart|close|status auth in src/api/routes/overmind-routes.ts):
   - POST /api/overmind/ovm/send { message } → sends to the OVM session, waits for OVM's turn to finish: loop while `hasActiveTurn(pane)` is true OR the pane is still changing; once the turn is done AND the pane is stable, extract the NEW assistant reply (diff vs the pre-send capture), clean it (ANSI+chrome stripped), and return { reply }.
   - LONG-WORK HANDLING (do NOT hard-cut at 12s): block up to a generous cap (~25-30s) for the common case; if OVM is still mid-turn at the cap, return { pending: true } and provide a way to fetch the eventual reply — e.g. GET /api/overmind/ovm/reply that returns { pending: true } while `hasActiveTurn`, else { reply } extracted since the in-flight send. Store the pre-send snapshot + in-flight marker in OvmSessionManager (src/services/ovm-session.ts) so /reply can diff correctly.
   - PREFER sharing: extract the core relay (capture-before → send → wait-for-turn-done → extract+clean) into an OvmSessionManager method (e.g. `sendAndAwaitReply(message)`) and have BOTH assistant-core.relayOvmMessage AND the new web endpoint call it (DRY). Keep TG behavior working.
2. FRONTEND (src/web/public/app.js OvmConsole ~511-742): make it a chat —
   - A message list of bubbles: user messages (right) + OVM replies (left), + system/error lines. On send: append the user bubble + an "OVM is thinking…" indicator; POST /ovm/send; when the reply returns, replace the indicator with the OVM bubble. If { pending }, poll GET /ovm/reply (e.g. every ~2s) until the reply arrives, keeping the "thinking…" indicator meanwhile.
   - REMOVE the live WS terminal stream, the rolling snapshot card, and the 25/50/100 line picker. (The /ws/tmux/OVM stream + diff-append are gone from this view.)
   - KEEP the open / restart / close session controls + the status indicator.
   - Persist the chat history in component state (sessionStorage optional).
3. Build green (`npx tsc`). Existing tests still pass. Add a small unit/integration test for the reply-extraction (given a fake pre/after pane, sendAndAwaitReply returns the cleaned reply, and returns pending while hasActiveTurn).

Scope / DON'T:
- DO NOT touch the overmind watcher classification, the brain, Notes, the chat backend being decommissioned, or providers.
- DO NOT change the OVM session launch (claude --model sonnet) — only how we relay messages to/from it.
- Keep TG OVM chat working (if you refactor relayOvmMessage to share code, verify the TG path still works via the existing overmind-commands OVM tests).
- Surgical.

Required artifacts:
- plan/WK_0519/chat-notes/projcore-run-2026-05-22/batch-D2.1/changes.md (Codex template: verbatim report + Root Cause/feature + per-file WHAT+WHY + Verification: tsc PASS, test results, how you verified the chat flow (sample message→reply), Caveats).
- decisions/ entry if any non-trivial autonomous call (e.g. the blocking-cap + poll design), else "none."

Completion:
- `npx vitest run` (report counts) + `npx tsc` clean.
- Commit: `[D2.1] OVM web chat: true request/response chat (send→reply bubbles), reuse relay + hasActiveTurn; drop terminal view`.
- End with STATUS: DONE / BLOCKED / NEEDS CLARIFICATION.
