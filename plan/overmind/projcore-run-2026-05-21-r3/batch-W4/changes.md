# Batch W4 Changes

## W4a

User Report verbatim:
Final round-3 batch W4 (IMPLEMENTER; /projcore from AGJ-51). W4 = Active/Completed/History tabs + PERSISTENT history archive (new overmind_task_history table, schema v17, survives /om_drop), grouped by workflow. The key property: history SURVIVES workflow deletion (test it).

Root Cause mechanism:
Overmind task history only existed inside `overmind_workflows.task_log`, which is capped and deleted with the workflow row. `/om_drop` calls `OvermindService.delete`, so deleting a workflow removed all available task history.

Per-file WHY:
- `src/db/database.ts`: bumped schema to v17 and added independent `overmind_task_history` plus coordinator-session index.
- `src/services/overmind-service.ts`: writes archive rows from the existing `setTasks` log-append path and exposes history ordered newest-first with live workflow names when available.
- `src/api/routes/overmind-routes.ts`: added authenticated `GET /api/overmind/history`.
- `tests/overmind-service.test.ts`: verifies schema v17, no-op skip behavior, archive insertion, live-name fallback, and history survival after `delete`.
- `tests/overmind-routes.test.ts`: verifies JWT protection and history survival after workflow deletion.

Autonomous decisions: none.

## W4b

User Report verbatim:
Tabs become Active / Completed / History (rename Done→Completed; add History). History = persistent archive of task-log entries that SURVIVES workflow completion/removal (separate table). Layout: grouped by workflow (display_name ?? label), newest-first, collapsible.

Root Cause mechanism:
The Overmind dashboard only had Active/Done workflow filters and rendered per-workflow `task_log` inside live workflow cards. That made deleted workflow history unreachable in the UI even after W4a persisted it independently.

Per-file WHY:
- `src/web/public/overmind-helpers.js`: added `groupOvermindHistoryByWorkflow` so archive grouping and newest-first sorting are testable outside the browser.
- `src/web/public/app.js`: renamed Done to Completed, added a History tab, fetches `/api/overmind/history`, and renders collapsible workflow groups independent of the live workflow list.
- `src/web/public/style.css`: added small archive-list layout rules and mobile wrapping for history rows.
- `tests/overmind-stream.test.ts`: verifies grouped archive output and newest-first ordering.

Autonomous decisions: none.
