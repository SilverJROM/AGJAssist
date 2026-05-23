Batch-N4: Folder management UI + pinning affordance (iPhone Notes parity)

Branch: feat/chat-decommission-notes-ios · Req: R5 (UI), R8 · NS-3/NS-4
Frontend. Completes the iPhone Notes parity: folder create/rename/delete, move-note-to-folder, and a clear pin/unpin affordance.

Read first: IosNotesPage (folders screen), IosNotesList, IosNoteRow, IosNoteEditor in src/web/public/app.js (N2/N3 work). Backend ready: POST/PATCH/DELETE /api/note-folders, PATCH /api/notes/:id {folder_id, pinned}.

Acceptance criteria:
1. FOLDER CREATE: on the folders screen, an iOS "New Folder" affordance (top-right or a row) → prompts for a name → POST /api/note-folders → appears in the list.
2. FOLDER RENAME: rename a folder (e.g. swipe action or an Edit mode) → PATCH /api/note-folders/:id {name}. The default "Notes" folder may be non-renamable (match iPhone's protected default) — your call, note it.
3. FOLDER DELETE: delete a folder (swipe/Edit mode) → DELETE /api/note-folders/:id, with confirm. Backend moves its notes to the default folder; the default folder itself cannot be deleted (the API returns 4xx — handle gracefully). iPhone-style.
4. MOVE NOTE TO FOLDER: from a note (in the editor's actions, or a row swipe/long-press "Move") → choose a target folder → PATCH /api/notes/:id {folder_id}. The note leaves the current list and lands in the chosen folder.
5. PINNING affordance: a clear pin/unpin control (row swipe action and/or in the editor) → PATCH /api/notes/:id {pinned}. Pinned notes already render in the "Pinned" section (N2) — ensure toggling updates the section live.
6. iOS feel: an "Edit" mode on the folders screen is a clean way to expose rename/delete; or swipe actions. Keep it density-light and touch + desktop friendly.
7. Build green (`npx tsc` + `npm run build`); no console errors.

Scope/DON'T:
- Frontend only (app.js + style.css). Do NOT touch backend/API, chat/OVM, overmind, providers.
- Do NOT remove the old NotesPage/old endpoints (N5).
- Keep N2 list + N3 editor behavior intact; only ADD folder management + pin/move affordances.

Required artifacts:
- plan/WK_0519/chat-notes/projcore-run-2026-05-22/batch-N4/changes.md (Codex template + Verification: tsc/build PASS; describe create/rename/delete/move/pin flows + which endpoints; note default-folder protection + delete-moves-to-default handling).
- decisions/ entry for non-trivial UI calls (default-folder protection, Edit-mode vs swipe), else "none."

Commit `[N4] iPhone Notes folder management (create/rename/delete, move-to-folder) + pin/unpin affordance`. End with STATUS marker.
