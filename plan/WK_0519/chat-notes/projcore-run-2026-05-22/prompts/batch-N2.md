Batch-N2: iOS-style Notes LIST UI (folders → notes list)

Branch: feat/chat-decommission-notes-ios · Req: R6 (+R5 UI) · NS-3/NS-4
Frontend. Build the iPhone Notes LIST experience. The rich editor is N3 (this batch opens a note into a minimal editable view; N3 makes it rich). Folder management (create/rename/delete) is N4. This batch = folders screen + notes list + previews + search + swipe-delete + new-note + pinned section.

User report (verbatim): "redesign the notes function on the app and copy how the notes is working on iphone copy it 80-90% look and feel and functionality" — PURE iPhone parity.

Backend already in place (use it):
- GET /api/note-folders → [{id,name,position,...}]
- GET /api/notes?folder_id=<id> → notes in folder, pinned DESC then updated_at DESC (each: {id, body, pinned, folder_id, updated_at, ...})
- GET /api/notes?search=<q> → search across all folders
- POST /api/notes { folder_id?, body } → create (folder_id defaults to default "Notes" folder)
- PATCH /api/notes/:id { body?, pinned?, folder_id? }
- DELETE /api/notes/:id
- (auth: same JWT as other app API calls — use the existing `api()` helper in app.js)

Read first: the current NotesPage (src/web/public/app.js ~2614) + the routing for /notes (TgApp ~5652 and App ~5719) + the bottom nav (overmind-helpers.js). Mirror the iOS look of the OTHER recently-built screens for consistency.

Acceptance criteria (iPhone Notes parity, list side):
1. FOLDERS screen (the /notes landing): a list of folders (name + note count), iOS grouped-list style. Tapping a folder opens its notes list. (Folder create/rename/delete is N4 — for now just list + navigate; the default "Notes" folder always exists.)
2. NOTES LIST (within a folder): each row shows a PREVIEW — bold first line as the title (derived from the note body's first line, HTML-stripped), a one-line grey snippet of the next text, and a relative date (Today/▸ time, Yesterday, date). iOS row styling with dividers.
3. PINNED section: pinned notes appear in a "Pinned" group at the top, then "Notes" below (like iPhone). (Pin toggle UI can be a swipe action or in the row context — wire it via PATCH {pinned}; full pin affordance polish is OK to land here or N4.)
4. SEARCH: a search field that filters via GET /api/notes?search= across folders (iOS search-bar style at top of the list).
5. SWIPE-TO-DELETE (or a clear delete affordance that works on touch + desktop): deletes via DELETE /api/notes/:id with a confirm.
6. NEW NOTE: a clear new-note affordance (iOS bottom-right compose icon). Creates via POST /api/notes (folder_id = current folder) and opens the note for editing.
7. OPEN A NOTE: tapping a row opens an editable view of the note body. For THIS batch a simple editable textarea bound to the body with AUTO-SAVE (debounced PATCH /api/notes/:id {body}) is sufficient — N3 replaces it with the rich contenteditable + checklists. First line = title (no separate title field).
8. Wire this as the /notes route (replace the old NotesPage rendering for that route). Leave the old NotesPage component code in place but unrouted (N5 removes it). Do not break other routes/tabs.
9. Build green (`npx tsc` + `npm run build`). No console errors.

iOS feel: clean, light, generous spacing, the yellow/standard iOS Notes accent is fine; density-light. Mobile-first (TG mini-app) but works on desktop.

Scope/DON'T:
- Frontend only (app.js + style.css). Do NOT touch backend, chat/OVM, overmind, providers.
- Do NOT remove the old NotesPage/old endpoints (N5 cleanup).
- Do NOT build the rich editor / folder-CRUD UI here (N3/N4) — keep the editor a minimal auto-saving textarea for now.

Required artifacts:
- plan/WK_0519/chat-notes/projcore-run-2026-05-22/batch-N2/changes.md (Codex template + Verification: tsc/build PASS, describe the screens/rows you built + which endpoints each uses; note it's mobile + desktop).
- decisions/ entry if any non-trivial autonomous UI call, else "none."

Commit `[N2] iOS Notes list UI: folders → notes list (previews, pinned, search, swipe-delete, new-note, auto-save editor stub)`. End with STATUS marker.
