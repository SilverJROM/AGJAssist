# Batch W4 Independent Validation

## W4a

Validation result: PASS.

Evidence:
- Schema version is now 17 and creates `overmind_task_history` independently from `overmind_workflows`.
- `OvermindService.setTasks` inserts archive rows only when the existing task-log append condition is true.
- `OvermindService.delete` still deletes only from `overmind_workflows`; service and route tests confirm history rows remain after deletion, matching `/om_drop` behavior.
- `GET /api/overmind/history` is JWT-protected and returns newest-first archive rows with live display name when the workflow exists, otherwise the snapshot name.

Residual risk:
- W4b UI rendering and grouping are not implemented in W4a; they are the next approved split.
