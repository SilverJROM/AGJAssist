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

## W4b

Validation result: PASS.

Evidence:
- Dashboard tabs now read Active / Completed / History.
- History tab fetches the persistent `/api/overmind/history` archive, not the live `/api/overmind/workflows` list.
- Archive rows are grouped by workflow/session with display name from the endpoint and entries sorted newest-first.
- History rendering is independent of `workflows.length`, so deleted workflows can still appear from archive rows.
- Helper, service, route, TypeScript, and production build gates passed.

Residual risk:
- No browser screenshot was captured in this split; validation is code/test/build based.
