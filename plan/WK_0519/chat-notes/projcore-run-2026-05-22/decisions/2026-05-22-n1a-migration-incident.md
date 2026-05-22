---
date: 2026-05-22
project: AGJAssist
type: autonomous-call
trigger: N1a deploy crashed the live app on boot (v22→v23 migration)
source: projcore
priority: high
search_hooks: [migration boot crash, SCHEMA_SQL index ALTER column, no such column folder_id, upgrade-path test gap, dry-run migration on copy]
---

**Incident:** Deploying N1a (notes folders, schema v23) crashed the live app on boot — `SqliteError: no such column: folder_id` in initSchema. App was `errored` (GET / = 000) for ~2 min.

**Root cause (mechanism):** the implementer added `CREATE INDEX idx_notes_folder/idx_notes_pinned ON notes(folder_id/pinned)` into the always-run `SCHEMA_SQL`. For an EXISTING (pre-v23) DB, the migration path runs `exec(SCHEMA_SQL)` BEFORE the v23 `ALTER` that adds those columns → the index creation references a non-existent column → fatal. Fresh DBs were fine (columns present in the CREATE), which is exactly why the implementer's tests (all fresh-DB) passed and missed it.

**Fix (emergency, projcore-direct — justified by prod-down per trust-defaults):** removed the two new-column indexes from SCHEMA_SQL; create them in the fresh-DB path + the v23 migration block only (after columns exist). Commit 67402a4. App recovered: v23, 20/20 notes preserved, default "Notes" folder seeded, all assigned, dormant project/tags intact. DB backed up first (data/agjassist.db.bak-pre-v23-*).

**Default projcore would have made:** n/a — this was a defect, caught by the pre/post data-safety check during validation.

**Lessons (promotion candidates):**
1. **Migration testing gap:** unit tests that only build FRESH DBs cannot catch upgrade-path migration bugs. Migration batches MUST include an existing-old-schema → upgrade test. → folding into N1b.
2. **Deploy safety for migrations:** dry-run the migration against a COPY of the live DB before `pm2 restart` on the live app. (I backed up but deployed before dry-running the upgrade on the copy.)
3. Verifier≠fixer was bent for the incident (projcore wrote the fix). Acceptable for prod-down restore; the regression test goes back to the implementer (N1b).
