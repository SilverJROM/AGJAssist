Batch-N1b: Notes API — folder endpoints (ADDITIVE, non-breaking) + upgrade regression test

Branch: feat/chat-decommission-notes-ios · Req: R5 · NS-3/NS-4
ADDITIVE only. Do NOT remove the existing note endpoints/behavior (the current NotesPage UI still uses them on the LIVE app — removal is a later cleanup batch N5). No new schema migration (DB is already v23 from N1a).

Context: N1a added (schema v23) note_folders + notes.folder_id/pinned/position, and NoteService methods: listFolders, createFolder, renameFolder, deleteFolder (moves notes to default, refuses default), listByFolder(folderId, search?), createNote(folderId, body, userId), updateNote(id,{body?,pinned?,folder_id?},userId), deleteNote, setPinned, moveToFolder, searchAll, defaultFolderId. Read src/services/note-service.ts + src/api/routes/note-routes.ts first.

Acceptance criteria:
1. ADD folder endpoints in note-routes.ts (JWT/owner-guarded, mirror the existing note-routes auth):
   - GET /api/note-folders  → listFolders()
   - POST /api/note-folders { name }  → createFolder
   - PATCH /api/note-folders/:id { name }  → renameFolder
   - DELETE /api/note-folders/:id  → deleteFolder (moves its notes to default; 4xx if trying to delete the default folder)
2. ADD folder-aware note endpoints (additive — alongside the existing /api/notes):
   - GET /api/notes already supports filters; ADD a `folder_id` filter (list notes in a folder, pinned DESC then updated_at DESC) and a `search` across all folders (searchAll) — extend the existing handler or add GET /api/notes?folder_id=&search=.
   - POST /api/notes: accept optional `folder_id` and `body`; when folder_id is omitted, DEFAULT it to defaultFolderId() (so notes — incl. TG /note — always land in a folder and are visible in the new UI). Keep the existing fields working.
   - PATCH /api/notes/:id: accept `pinned` and `folder_id` (in addition to the existing fields) → setPinned / moveToFolder / updateNote.
   - Keep DELETE /api/notes/:id as-is.
3. Keep ALL existing endpoints + behavior intact (add-to-plan, promote, project-scoped /api/projects/:id/notes, status/tags) — do NOT remove them this batch.
4. REGRESSION TEST (the gap that crashed prod): add a test that builds a DB at an OLD schema (an existing notes table WITHOUT folder_id/pinned/position + schema_version set to 22 or lower + a couple seeded notes), then opens it with `new DatabaseService(path)` and asserts: it does NOT throw on boot, schema becomes 23, folder_id/pinned/position columns exist, the default "Notes" folder is seeded, and the pre-existing notes were assigned to it (folder_id NOT NULL). Mirror the existing v11→migration test pattern in tests/overmind-service.test.ts. Put it in tests/notes-folders.test.ts or a new tests/notes-migration.test.ts.
5. Build green (`npx tsc`); `npx vitest run` all green except the known Ollama conversation-memory failure. Add focused route tests for the new folder endpoints if a notes-routes test file exists; otherwise the regression test + service tests suffice.

Scope/DON'T:
- ADDITIVE only — no endpoint/method/column removals (N5 does cleanup).
- Do NOT touch the Notes UI (NotesPage/NotesTab), the chat work, overmind, providers, or the OVM chat.
- Do NOT add a new schema migration — v23 already applied live.

Required artifacts:
- plan/WK_0519/chat-notes/projcore-run-2026-05-22/batch-N1b/changes.md (Codex template + Verification: tsc PASS, vitest counts, confirm the upgrade regression test exercises an OLD-schema DB and passes).
- decisions/ entry if any non-trivial autonomous call, else "none."

Commit `[N1b] notes API: folder endpoints + folder-aware create/update + default-folder fallback (additive) + v22->v23 upgrade regression test`. End with STATUS marker.
