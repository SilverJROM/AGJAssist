# Batch W3 Changes

## User Report Verbatim

W3 = rename workflow: display_name column (schema v16), JWT POST /api/overmind/workflows/:id/name, UI rename control, display_name ?? label everywhere (cards/Telegram/notifications); register/tasks-update MUST NOT overwrite display_name (the critical rule - test it).

## Root Cause Mechanism

Overmind workflows previously had only the projcore-controlled `label`. Lifecycle updates from `/api/overmind/register` are expected to rewrite that label on each run, so using `label` as the user-facing custom name would be overwritten by projcore. The fix adds a separate nullable `display_name` field that is updated only through the authenticated browser rename endpoint, while lifecycle register and tasks-update paths continue to update only operational workflow fields.

## Per-File WHY

- `src/db/database.ts`: Bumped schema to v16, added `display_name TEXT` to new databases, and added a guarded v15-to-v16 migration.
- `src/services/overmind-service.ts`: Added `display_name` to workflow mapping and `setDisplayName()`. Existing `register()` and `setTasks()` do not write this column, preserving user custom names.
- `src/api/routes/overmind-routes.ts`: Added JWT-protected `POST /api/overmind/workflows/:id/name`, with empty/null clearing to fallback to `label`.
- `src/web/public/app.js`: Added the workflow card rename control and changed card titles to `display_name || label`.
- `src/web/public/style.css`: Added compact styling for the rename button and adjusted the card toggle layout to avoid nested buttons.
- `src/bot/assistant-core.ts`: Updated `/overmind`, `/om_tasks`, pause/resume, and drop output to use the display-name fallback.
- `src/services/overmind-notifications.ts`: Updated DONE, BLOCKED, and needs-input notification text to use the display-name fallback.
- `tests/overmind-service.test.ts`: Added schema v16 coverage, set/clear coverage, and the critical preservation test across re-register plus `setTasks`.
- `tests/overmind-routes.test.ts`: Added JWT rename endpoint coverage for auth, set, clear, and missing workflow.
- `tests/overmind-notifications.test.ts`: Added notification display-name fallback coverage.

## Autonomous Decisions

- Treated missing `name` the same as `null` in the rename endpoint, so clients can clear by sending null, empty string, or omitting the value.
- Used `String.trim()` before persistence so whitespace-only names clear and accidental leading/trailing spaces do not become part of the display name.
