# req-matrix.md — requirement coverage (updated after every batch)

| Req# | Requirement (verbatim, first 80 chars) | Batch | Evidence | Status |
|------|------------------------------------------|-------|----------|--------|
| R1 | "Telegram has NO non-OVM conversational chat ... only /ovm_start / /ovm_end" | D1 | validation/batch-D1.md (grep: chat prefixes/cmds gone, OVM+slash intact; tsc clean; 287/1 suite) | VERIFIED |
| R2 | "The web Chat tab opens the OVM console ... old Conversations chat UI is gone" | D2b | /conversations route (web + mini-app) renders OvmConsole; old Conversations not rendered anywhere; tsc/build clean, deployed | VERIFIED |
| R3 | "No chat/conversation HTTP endpoints remain ... app boots cleanly" | D3 | 4 route files deleted; /api/chat,/conversations,/local-llm = 404; /api/overmind/ovm/* + notes alive (401); app boots; tsc/build clean | VERIFIED |
| R4 | "Ollama, OpenRouter, Local-relay providers ... removed; full vitest suite passes" | D4 | deleted 3 providers + ToolAgent + conversation/chat-settings services + config.llm + Ollama test; ClaudeCliProvider kept (brain); FULL suite 290/0 fail; app boots; tsc/build clean; deployed | VERIFIED |
| R5 | "Notes are organized in folders ... create/rename/delete; move a note between folders" | N1,N2,N4 | backend folders CRUD (N1a/N1b) + UI: folders screen, create/rename/delete (default protected via is_default), move-to-folder; tsc clean, deployed | VERIFIED |
| R6 | "The notes list mimics iPhone Notes: preview, search, swipe-to-delete, new-note, auto-save" | N2 | IosNotesPage/IosNotesList/IosNoteRow: folders→list, previews (first-line title+snippet+rel date), pinned section, search, swipe-delete, compose, auto-save; tsc clean, deployed | VERIFIED (code/deploy; JROM eyeball welcome) |
| R7 | "The note editor is rich text: bold/italic/headings, bulleted lists, checklists; first line = title" | N3 | IosNoteEditor: contenteditable, B/I/U + heading + bullets + tappable checklists, first-line=title (CSS), HTML auto-save round-trip, empty-note discard; tsc clean, deployed | VERIFIED (code/deploy) |
| R8 | "Pinning: a note can be pinned to the top of its list" | N4 | pin/unpin via row swipe + editor; Pinned section renders above Notes (N2) and updates live; PATCH {pinned}; deployed | VERIFIED |
| R9 | "Pure iPhone parity: status, tags, project linkage, promote-to-plan removed" | N5 | removed add-to-plan/promote routes+methods, project-scoped note routes, old NotesPage + ProjectDetail NotesTab, title/tags/status/project from API; TG /note → default folder; DB columns dormant (no drop); tsc/build clean, suite 314/1, deployed | VERIFIED |
| R10 | "OVM web chat = true request/response chat (send→reply bubbles), not a terminal; long work via hasActiveTurn; reply cleaned" | D2,D2.1 | validation/batch-D2.1.md (tsc clean; 297/1; /ovm/send+/ovm/reply via sendAndAwaitReply+hasActiveTurn; OvmConsole=bubbles, no WS stream/picker; ovm-session unit tests) | VERIFIED (pending JROM eyeball of live UX) |

Final acceptance: every row VERIFIED. Statuses: UNASSIGNED→ASSIGNED→IN-PROGRESS→CLAIMED→VERIFIED (or FAIL).
