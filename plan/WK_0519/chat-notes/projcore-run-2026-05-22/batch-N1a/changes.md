# Batch N1a — changes.md

## Summary

Notes backend groundwork: `note_folders` table, `folder_id`/`pinned`/`position` columns on `notes`, full iPhone-model service methods. Additive, data-safe. No column/table drops.

## Files changed

| File | Change |
|------|--------|
| `src/db/database.ts` | Bump SCHEMA_VERSION 22 → 23. Add `note_folders` + new note columns to SCHEMA_SQL (fresh DB). Add v23 migration block (guarded PRAGMA table_info). Add `seedDefaultNotesFolder()` private helper called from fresh-DB path and v23 migration. |
| `src/services/note-service.ts` | Extend `Note` interface (`folder_id`, `pinned`, `position`). Add `NoteFolder` interface. Add methods: `defaultFolderId`, `listFolders`, `createFolder`, `renameFolder`, `deleteFolder`, `listByFolder`, `createNote`, `updateNote`, `deleteNote`, `setPinned`, `moveToFolder`, `searchAll`. Existing methods (`list`, `listAll`, `getById`, `create`, `update`, `delete`, `addToPlan`, `promote`) unchanged and compiling. |
| `tests/notes-folders.test.ts` | New test file. 18 tests covering migration (v23, table, columns, indexes, default folder seed, existing-notes assignment), folder CRUD (create/rename/delete-moves-notes/refuses-default), createNote, listByFolder ordering, setPinned, moveToFolder, searchAll. |
| `tests/unit/database.spec.ts` | Updated hardcoded `toBe(22)` → `toBe(23)` (schema version bump). |
| `tests/overmind-service.test.ts` | Updated hardcoded `toBe(22)` → `toBe(23)` (2 occurrences). |

## Schema changes (v23)

New table:
```sql
CREATE TABLE IF NOT EXISTS note_folders (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Columns added to `notes` (guarded):
- `folder_id INTEGER REFERENCES note_folders(id)`
- `pinned INTEGER NOT NULL DEFAULT 0`
- `position INTEGER NOT NULL DEFAULT 0`

Indexes added: `idx_notes_folder ON notes(folder_id)`, `idx_notes_pinned ON notes(pinned)`.

Data migration: seeded default "Notes" folder (created_by = owner user or null if not yet present); all existing notes with `folder_id IS NULL` assigned to that folder.

## Verification

- `npx tsc`: PASS (no output)
- `npx vitest run tests/notes-folders.test.ts`: 18/18 PASS
- `npx vitest run` (full suite): 315/316 pass. 1 pre-existing failure: `conversation-memory.spec.ts` — Ollama model `qwek32k:latest` not found on this machine (unrelated to this batch, pre-existed before N1a).

## Data-safety notes

- Migration is additive only: no `DROP TABLE`, no `DROP COLUMN`, no `ALTER TABLE ... RENAME`.
- `project_id`, `status`, `tags` columns on `notes` left dormant — not touched.
- Existing notes assigned to default folder via `UPDATE notes SET folder_id = ? WHERE folder_id IS NULL` — no data lost.
- `deleteFolder` refuses to delete the default folder and moves notes (never deletes them) when a non-default folder is deleted.
- Fresh-DB path also seeds the default folder via `seedDefaultNotesFolder()` (idempotent, tolerates no owner user at init time).
