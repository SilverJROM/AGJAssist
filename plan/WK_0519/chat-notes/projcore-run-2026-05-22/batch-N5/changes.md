# Batch N5 — Remove old notes plumbing (R9 pure parity)

## Summary
Remove superseded old-model notes plumbing: add-to-plan/promote routes and service methods, project-scoped note endpoints, old NotesPage + ProjectDetail NotesTab. Retarget TG /note and /notes to the default "Notes" folder. Build and full suite stay green.

---

## Changes

### src/api/routes/note-routes.ts
- **Removed** `POST /api/notes/add-to-plan` route (called `noteService.addToPlan`)
- **Removed** `POST /api/notes/:id/promote` route (called `noteService.promote`)
- **Removed** `GET /api/projects/:projectId/notes` route (project-scoped note list)
- **Removed** `POST /api/projects/:projectId/notes` route (project-scoped note create)
- **Simplified** `GET /api/notes` — querystring now `{ search?, folder_id? }` only; drops `project_id`, `status`, `unattached`, `sort`, `page`, `limit` from API surface (columns stay dormant in DB)
- **Simplified** `POST /api/notes` — body now `{ body, folder_id?, pinned? }`; drops `title`, `tags`, `project_id`, legacy dual-path logic; always calls `noteService.createNote`
- **Simplified** `PATCH /api/notes/:id` — body now `{ body?, pinned?, folder_id? }`; drops `title`, `status`, `tags`, `project_id`, legacy `update()` fallthrough; delegates to `noteService.updateNote` only

### src/services/note-service.ts
- **Removed** `addToPlan()` method (linked notes to a plan via plan_notes, marked notes promoted)
- **Removed** `promote()` method (created a plan from a single note)
- Kept: all folder-model methods (`createNote`, `updateNote`, `listByFolder`, `searchAll`, `setPinned`, `moveToFolder`, `listFolders`, `createFolder`, `renameFolder`, `deleteFolder`, `defaultFolderId`), legacy `list()`, `listAll()`, `create()`, `update()`, `delete()` (columns dormant, not dropped)

### src/web/public/app.js
- **Removed** `NotesTab` component (~150 lines) — used `GET/POST /api/projects/:projectId/notes` + `POST /api/notes/add-to-plan`; entirely removed
- **Removed** `NotesPage` component (~540 lines) — standalone old-model notes page with project/status/tags filters, promote-to-project buttons; was already unrouted since N2; entirely removed
- **Removed** `'notes'` from `ProjectDetail` tabs array and its render branch (`NotesTab` render)

### src/bot/assistant-core.ts
- **Retargeted** `/note <text>` — drops `<project>` arg; creates note in the default "Notes" folder via `noteService.defaultFolderId()` + `noteService.createNote()`; returns `Note #<id> saved to Notes folder`
- **Retargeted** `/notes` — drops `<project>` arg; lists recent notes from default folder via `noteService.listByFolder()`; shows pinned marker
- **Updated** `/help` text for both commands

### src/bot/telegram-bot.ts
- **Updated** `setMyCommands` descriptions for `note` and `notes` to reflect folder-model semantics

### tests/unit/notes-plans.spec.ts
- **Removed** `describe("NoteService.addToPlan", ...)` block (4 tests) — referenced `noteService.addToPlan()`
- **Updated** 3 PlanService tests that used `noteService.addToPlan()` as setup: replaced with direct `planService.create()` + `db.prepare("INSERT INTO plan_notes …").run()` SQL
- **Updated** full workflow test: same SQL-direct approach
- 26 tests pass (NoteService basic CRUD, PlanService, PlanService.insertToProject)

### tests/unit/workflow.spec.ts
- **Removed** `"promotes note to plan"` test — called `noteService.promote()`
- **Removed** `"cannot promote already promoted note"` test — same
- **Added** `"links note to plan via plan_notes"` test — covers plan_notes relationship without the promotion path
- 5 tests pass

---

## Verification

### tsc
```
npx tsc
```
Exit 0. No errors.

### npm run build
```
npm run build
```
Exit 0. No errors.

### npx vitest run
- 28 test files passed (29 total)
- 314 tests pass
- 1 known failure: `tests/unit/conversation-memory.spec.ts > Ollama conversation memory (live)` — pre-existing, model `qwek32k:latest` not found (Ollama env, unrelated to this batch)

### Dangling references check
```
grep -r "addToPlan\|\.promote\|/api/projects.*notes\|NotesTab\|NotesPage" src/ tests/
```
No references remain in `src/` or `tests/`. The `/api/notes/add-to-plan` and `/api/notes/:id/promote` patterns are fully gone from routes, service, frontend, and tests.

### DB columns preserved
`project_id`, `status`, `tags` columns on `notes` table remain dormant — not dropped.  
`plan_notes` table preserved — only the promotion *path* was removed, not the table.

---

## Decisions
None non-trivial. Straightforward removal per brief. Test updates used direct SQL inserts into `plan_notes` as the minimal faithful replacement for the removed `addToPlan` setup.
