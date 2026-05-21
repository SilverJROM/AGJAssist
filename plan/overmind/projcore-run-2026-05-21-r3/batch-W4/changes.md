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
