# Batch N1b — changes.md

## Summary
Notes API: folder endpoints + folder-aware create/update + default-folder fallback (additive) + v22→v23 upgrade regression test.

## Files Changed

### `src/api/routes/note-routes.ts`
**Added** — Note folder endpoints (JWT/owner-guarded, mirror existing note auth):
- `GET /api/note-folders` → `noteService.listFolders()` (auth only, no owner guard needed for read)
- `POST /api/note-folders { name }` → `noteService.createFolder()` (owner required)
- `PATCH /api/note-folders/:id { name }` → `noteService.renameFolder()` (owner required; 404 if not found)
- `DELETE /api/note-folders/:id` → `noteService.deleteFolder()` (owner required; 400 if default folder; 404 if not found; 204 on success)

**Extended** — `GET /api/notes`:
- Added `folder_id` query param: when present, delegates to `noteService.listByFolder(folderId, search?)` (pinned DESC, updated_at DESC)
- Added all-folder `search` fast path: when only `search` is supplied (no `folder_id`, `project_id`, `status`, or `unattached`), delegates to `noteService.searchAll(query)`
- Existing project/status/pagination path unchanged

**Extended** — `POST /api/notes`:
- Accepts optional `folder_id` in request body
- Resolves `folder_id`: uses supplied value or falls back to `noteService.defaultFolderId()` — notes always land in a folder
- Simple body-only notes use `noteService.createNote()` (folder-native)
- Notes with project/title/tags use existing `noteService.create()` then patches `folder_id` if unset
- All existing fields (`body`, `title`, `project_id`, `tags`) continue to work

**Extended** — `PATCH /api/notes/:id`:
- Now accepts `pinned` (→ `setPinned`) and `folder_id` (→ `moveToFolder`) in addition to existing fields
- Legacy fields (`title`, `body`, `status`, `tags`, `project_id`) still applied via `noteService.update()`
- Each operation is independent; only supplied fields are applied
- Returns the final note state after all patches

**Unchanged** — `DELETE /api/notes/:id`, project-scoped notes, `/api/notes/add-to-plan`, `/api/notes/:id/promote`.

### `tests/notes-migration.test.ts` (new)
Upgrade regression test — exercises an OLD-schema DB to prevent the prod-crash class:
- Bootstraps a raw `better-sqlite3` DB with `schema_version = 22` and a notes table that has **no** `folder_id`, `pinned`, or `position` columns
- Seeds an owner user and two notes
- Closes the raw DB, then opens it with `new DatabaseService(path)` (the code under test)
- Asserts:
  - No throw on boot
  - `schema_version` is now 23
  - `folder_id`, `pinned`, `position` columns exist on notes
  - Default "Notes" folder seeded in `note_folders`
  - Both pre-existing notes have `folder_id IS NOT NULL` (assigned to default folder)
  - `NoteService.listByFolder()` returns both legacy notes correctly

## Verification

```
npx tsc        → PASS (0 errors)
npx vitest run → 28 test files passed, 316 tests passed, 1 known failure (Ollama model not found)
```

Migration regression test (`tests/notes-migration.test.ts`) exercises an OLD-schema DB bootstrapped with `better-sqlite3` directly at `schema_version = 22`, confirming the migration path is tested end-to-end — not just fresh-DB initialization.

## Decisions
None (no non-trivial autonomous calls; all behavior directly specified in brief).
