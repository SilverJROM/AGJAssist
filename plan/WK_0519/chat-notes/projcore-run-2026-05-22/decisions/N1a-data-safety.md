# N1a Data-Safety Decisions

**Date:** 2026-05-22  
**Batch:** N1a — notes backend (note_folders + folder/pin schema v23)  
**Context:** Autonomous decisions made during implementation per brief's "data-safe, additive" mandate.

---

## D1 — Existing notes assigned to default "Notes" folder (not left NULL)

**Decision:** On v23 migration, all notes where `folder_id IS NULL` are updated to point at the seeded default folder.

**Rationale:** Leaving existing notes with `folder_id = NULL` would break `listByFolder(defaultId)` — those notes would be invisible in the iPhone UI. Assigning them to "Notes" (the semantic equivalent of the inbox) is the correct zero-loss migration. No note content, status, or project linkage is changed.

**Data preserved:** `project_id`, `status`, `tags`, `title`, `body`, `created_by`, `created_at`, `updated_at` — all unchanged.

---

## D2 — project_id / status / tags columns left dormant

**Decision:** The three legacy columns (`project_id`, `status`, `tags`) are not dropped or nulled in this batch.

**Rationale:** Brief is explicit: "Do NOT drop any column or table. Additive only." These columns are used by the existing `list()`, `listAll()`, `update()`, `addToPlan()`, `promote()` methods which remain compiling. Dropping them would break those methods (and any in-flight data). N1b/later batches will remove the routes + methods that reference them once the new UI is live.

---

## D3 — deleteFolder moves notes to default, refuses to delete default

**Decision:** `deleteFolder(id)` moves all notes from the target folder to the default "Notes" folder, then deletes the folder row. It returns `{ ok: false, reason: 'cannot_delete_default' }` if called on the default folder.

**Rationale:** iPhone Notes parity — you can't delete the default Notes folder. Moving notes instead of deleting them is data-safe by definition (zero note loss). The alternative — blocking delete if folder is non-empty — would be more restrictive than iPhone and would leave orphan notes if the check were bypassed.

---

## D4 — seedDefaultNotesFolder tolerates no owner user at DB init time

**Decision:** `seedDefaultNotesFolder()` sets `created_by = null` if no owner user exists yet when the fresh-DB path runs.

**Rationale:** `DatabaseService` constructor calls `initSchema()` (which seeds the folder) before any application code runs `ensureOwner()`. On first boot, there is no owner user yet. Using `null` is safe — `created_by` is `REFERENCES users(id)` (nullable). Once `ensureOwner` runs, the owner user exists; the folder is already seeded and does not need to be re-seeded. In the migration path (existing DBs), the owner user almost certainly exists, so `created_by` will be set correctly.
