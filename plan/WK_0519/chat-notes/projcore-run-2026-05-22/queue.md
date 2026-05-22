# queue.md — atomic batch queue (dynamic)

Order: decommission first (clears the deck), then Notes. One batch at a time. SHORT/atomic default (§1.4c).

| # | Batch | Req# | Bucket | State |
|---|-------|------|--------|-------|
| D1 | Telegram: remove non-OVM conversational chat (plain-msg + /op /om /llm /ommodel + /claude /sonnet /opus /haiku /codex); keep /ovm_start /ovm_end + all slash cmds; update setMyCommands | R1 | SHORT | pending |
| D2 | OVM chat groundwork (DONE, not deployed): cleanTerminalOutput helper + stop bubble-flood | R10 | SHORT | groundwork-done |
| D2.1 | OVM TRUE CHAT (re-scoped per NS-9): backend send-and-wait endpoint (reuse relayOvmMessage + hasActiveTurn turn-detection + cleanTerminalOutput) + frontend chat bubbles (send → thinking → reply); remove terminal stream/picker; handle long background work | R10 | SHORT | processing |
| D2b | Web UI: promote OvmConsole to the `💬 Chat` tab (/conversations); remove ConversationsTab + provider/model pickers | R2 | SHORT | pending |
| D3 | Backend: remove /api/chat/*, /api/conversations/*, /api/local-llm/*, /api/chat-settings/* routes + server.ts registration | R3 | SHORT | pending |
| D4 | Remove ollama/openrouter/local-relay providers + ToolAgent (if orphaned) + conversation/chat-settings services (if orphaned) + config.llm keys + index.ts wiring + failing conversation-memory test | R4 | SHORT | pending |
| N1 | Notes backend: note_folders table + notes migration (folder_id, pinned, position, rich body); folder+note CRUD API; remove status/tags/project_id surface + promote/add-to-plan + /api/projects/:id/notes | R5,R9 | SHORT (migration) | pending |
| N2 | Notes list UI: iOS folder list → notes list (first-line title + snippet + date previews), search, swipe-delete, new-note, auto-save wiring | R6 | SHORT | pending |
| N3 | Note editor UI: rich contenteditable (bold/italic/headings, bullets, tappable checklists), first-line=title, debounced auto-save | R7 | SHORT | pending |
| N4 | Folders UI + pinning UI: create/rename/delete folder, move note to folder, pin/unpin, iOS polish | R5,R8 | SHORT | pending |

Split at handshake if any PROPOSED reveals >30min / many-test / sprawling diff.
