Batch-D2b: Promote OVM to the 💬 Chat tab; remove the old Conversations chat UI

Branch: feat/chat-decommission-notes-ios · Req: R2 · NS-1/NS-2
Frontend. The OVM chat (Telegram-style, request/response) is the ONLY chat now. Make the 💬 "Chat" bottom-nav tab open it, and remove the old multi-provider Conversations UI.

User report (verbatim): "decommission the chat ... perhaps just intergrate ovm chat on it and only it for now."

Read first: the bottom-nav config (overmind-helpers.js: AVAILABLE_BOTTOM_NAV_TABS / DEFAULT_BOTTOM_NAV_TAB_IDS — the `/conversations` tab labeled 💬 Chat), the routing (app.js TgApp ~5652 + App ~5719), the ConversationsTab component, and the OvmConsole component (the Telegram-style chat built in D2/D2.1).

Acceptance criteria (R2):
1. The 💬 "Chat" tab (route `/conversations`) now renders the OVM chat (OvmConsole) — the Telegram-style request/response chat. So OVM is reachable as the top-level Chat surface (not only under Workflows→OVM).
2. The old ConversationsTab UI (conversation list, provider/model pickers, the old multi-provider chat) is removed from the routing (no longer rendered anywhere). You may leave the OVM tab under Workflows too, or rely solely on the 💬 tab — keep the Workflows→OVM sub-tab working as well (it already renders OvmConsole).
3. Keep the bottom-nav label/icon as 💬 Chat (it now means OVM). Update the nav label to "Chat" (OVM) if helpful; keep the same route id `/conversations` so saved nav configs don't break, OR cleanly switch to a clear id — your call, but don't break the bottom-nav editor or other tabs.
4. The OvmConsole must render correctly as a full tab (it currently renders inside the Workflows OVM sub-tab) — ensure it works standalone at the Chat route (open/close/status controls + the chat). If OvmConsole needs the OVM session opened, the existing Open control handles it.
5. Do NOT remove the backend chat routes/providers yet (that's D3/D4) — this batch is the UI swap only. (The old ConversationsTab calling code is removed, so nothing in the UI hits /api/chat anymore.)
6. Build green (`npx tsc` + `npm run build`); no console errors; other tabs/routes unaffected.

Scope/DON'T:
- Frontend only (app.js + overmind-helpers.js + style.css as needed). Do NOT touch backend, the chat routes/providers (D3/D4), Notes, overmind internals.
- Keep the OvmConsole's Telegram-style chat behavior intact (don't restyle it).

Required artifacts:
- plan/WK_0519/chat-notes/projcore-run-2026-05-22/batch-D2b/changes.md (Codex template + Verification: tsc/build PASS; confirm the 💬 tab opens the OVM chat, the old Conversations UI is gone from routing, other tabs work).
- decisions/ entry if non-trivial (route id reuse vs new), else "none."

Commit `[D2b] promote OVM chat to the 💬 Chat tab; remove old Conversations chat UI from routing`. End with STATUS marker.
