# Batch V2 Changes

## User Report Verbatim

APPROVED-PLAN for V2. Proceed exactly as proposed (esp. the guarded PRAGMA table_info + ALTER ADD COLUMN migration so it's idempotent on the live DB, and keep status/stuck logic unchanged). Implement on feat/overmind, commit, gate: targeted tests (watcher parent/child/neither + v12 columns round-trip) + npx tsc clean + npm run build. Artifacts batch-V2/changes.md + test-report.md + independent-validation.md. Append callback FIRST ([projcore callback] V2 DONE <note>), THEN reply STATUS: DONE -- reason. Active-session attribution only.

## Root Cause Mechanism

The watcher already classified a workflow as working when any coordinator or child pane contained busy markers, but it did not preserve which pane caused the busy state. The overmind workflow row also had no storage for the active session name or whether it was the parent coordinator or a child Codex session, so the UI could not explain who was currently working.

## Changes

- `src/db/database.ts`: bumped schema to v12, added fresh-schema `active_session` and `active_role` columns, and added a guarded `PRAGMA table_info(overmind_workflows)` migration that only runs `ALTER TABLE ADD COLUMN` when each column is missing.
- `src/services/overmind-service.ts`: added active attribution fields to workflow types, row mapping, registration reset, and update persistence.
- `src/services/overmind-watcher.ts`: added per-pane busy attribution that prefers a busy coordinator as `parent`, otherwise selects the first busy child as `child`, otherwise stores nulls. Existing status/stuck classification remains unchanged.
- `src/web/public/overmind-helpers.js`: added a small formatter for the expanded-card active-session line.
- `src/web/public/app.js` and `src/web/public/style.css`: render the active-session line in the expanded workflow card.
- Tests cover parent/child/neither attribution, watcher persistence, v12 migration/round-trip, and the UI helper output.

## Autonomous Decisions

None.
