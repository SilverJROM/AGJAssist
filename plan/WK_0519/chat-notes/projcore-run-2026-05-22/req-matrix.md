# req-matrix.md — requirement coverage (updated after every batch)

| Req# | Requirement (verbatim, first 80 chars) | Batch | Evidence | Status |
|------|------------------------------------------|-------|----------|--------|
| R1 | "Telegram has NO non-OVM conversational chat ... only /ovm_start / /ovm_end" | D1 | validation/batch-D1.md (grep: chat prefixes/cmds gone, OVM+slash intact; tsc clean; 287/1 suite) | VERIFIED |
| R2 | "The web Chat tab opens the OVM console ... old Conversations chat UI is gone" | D2 | — | ASSIGNED |
| R3 | "No chat/conversation HTTP endpoints remain ... app boots cleanly" | D3 | — | ASSIGNED |
| R4 | "Ollama, OpenRouter, Local-relay providers ... removed; full vitest suite passes" | D4 | — | ASSIGNED |
| R5 | "Notes are organized in folders ... create/rename/delete; move a note between folders" | N1,N4 | — | ASSIGNED |
| R6 | "The notes list mimics iPhone Notes: preview, search, swipe-to-delete, new-note, auto-save" | N2 | — | ASSIGNED |
| R7 | "The note editor is rich text: bold/italic/headings, bulleted lists, checklists; first line = title" | N3 | — | ASSIGNED |
| R8 | "Pinning: a note can be pinned to the top of its list" | N4 | — | ASSIGNED |
| R9 | "Pure iPhone parity: status, tags, project linkage, promote-to-plan removed" | N1 | — | ASSIGNED |
| R10 | "OVM web chat = true request/response chat (send→reply bubbles), not a terminal; long work via hasActiveTurn; reply cleaned" | D2,D2.1 | validation/batch-D2.1.md (tsc clean; 297/1; /ovm/send+/ovm/reply via sendAndAwaitReply+hasActiveTurn; OvmConsole=bubbles, no WS stream/picker; ovm-session unit tests) | VERIFIED (pending JROM eyeball of live UX) |

Final acceptance: every row VERIFIED. Statuses: UNASSIGNED→ASSIGNED→IN-PROGRESS→CLAIMED→VERIFIED (or FAIL).
