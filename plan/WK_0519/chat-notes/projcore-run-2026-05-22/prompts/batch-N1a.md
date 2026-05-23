Batch-N1a: Notes backend groundwork — folders schema + service (iPhone Notes model)

Branch: feat/chat-decommission-notes-ios · Req: R5, R9 (backend) · North-star: NS-3, NS-4
Atomic, data-SAFE, ADDITIVE migration + service methods. No destructive DROP. Build green + targeted tests.

User report (verbatim): "redesign the notes function on the app and copy how the notes is working on iphone copy it 80-90% look and feel and functionality" — PURE iPhone parity (folders, rich text+checklists, pinning, list polish; drop status/tags/project-link/promote-to-plan).

Current state (read first): notes table (src/db/database.ts:82-95): id, project_id, title, body, status('open'|'promoted'|'archived'), tags, created_by, created_at, updated_at. NoteService (src/services/note-service.ts) has list/listAll/getById/create/update/delete + addToPlan/promote (plan integration). Schema version is currently 22 (database.ts top).

Acceptance criteria:
1. SCHEMA (new migration, version 23, guarded ALTER pattern like the existing v19-v22 blocks):
   - CREATE TABLE note_folders (id INTEGER PRIMARY KEY, name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))).
   - ALTER notes ADD COLUMN folder_id INTEGER REFERENCES note_folders(id); ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0; ADD COLUMN position INTEGER NOT NULL DEFAULT 0. (Use the guarded PRAGMA table_info check pattern.)
   - Index: idx_notes_folder on notes(folder_id), idx_notes_pinned on notes(pinned).
   - DATA MIGRATION (data-safe): seed a default folder named "Notes" (created_by = the owner user id; reuse however the codebase resolves the owner — e.g. the first/owner user). Set folder_id = that default folder for ALL existing notes where folder_id IS NULL. Do NOT drop or null project_id/status/tags — leave them dormant.
   - Also add the new columns + note_folders to the CREATE-TABLE SCHEMA block so a fresh DB matches.
2. NoteService — add the iPhone-model methods (keep the existing methods that other code still calls compiling; you may leave addToPlan/promote in place for now — they get removed in N1b):
   - Folders: listFolders(), createFolder(name, userId), renameFolder(id, name), deleteFolder(id) — deleteFolder MOVES its notes to the default "Notes" folder (never deletes notes), and refuses to delete the default folder.
   - Notes (folder model): listByFolder(folderId, search?) ordered by pinned DESC, updated_at DESC; createNote(folderId, body, userId); updateNote(id, { body?, pinned?, folder_id? }, userId); deleteNote(id, userId); setPinned(id, pinned, userId); moveToFolder(id, folderId, userId); searchAll(query) across all folders.
   - body is rich HTML (stored as TEXT; no sanitization scope here beyond storing/returning it). Title is NOT a column concern — the UI derives the title from the first line later (N2/N3).
   - Add a `defaultFolderId()` helper (returns the seeded "Notes" folder id).
   - Note interface: extend with folder_id: number | null, pinned: number (0/1), position: number.
3. Build green (`npx tsc`). Add targeted unit tests (a new tests/notes-folders.test.ts): migration creates note_folders + columns + seeds default + assigns existing notes; createFolder/rename/delete(moves notes to default, refuses default); createNote in folder; setPinned; moveToFolder; searchAll. Run `npx vitest run`.

Scope/DON'T:
- DO NOT touch note-routes.ts, the NotesPage/NotesTab UI, TG /note commands, the chat work, overmind, or providers — those are N1b/N2/N3/N4.
- DO NOT drop any column or table. Additive only.
- Do NOT remove addToPlan/promote yet (N1b removes them + their routes) — just don't use them in the new methods.
- If the schema-version bump or seeding the default folder requires resolving the owner user and the pattern isn't obvious, read database.ts (ensureOwner) and reuse it.

Required artifacts:
- plan/WK_0519/chat-notes/projcore-run-2026-05-22/batch-N1a/changes.md (Codex template + Verification: tsc PASS, vitest results, confirm migration is additive/data-safe with a note on how existing notes were assigned to the default folder).
- decisions/ entry: note the autonomous data-safety calls (existing notes → default "Notes" folder; project/tag/status columns left dormant; folder-delete moves notes to default).

Commit `[N1a] notes backend: note_folders + folder/pin schema (v23) + service methods (additive, data-safe)`. End with STATUS marker.
