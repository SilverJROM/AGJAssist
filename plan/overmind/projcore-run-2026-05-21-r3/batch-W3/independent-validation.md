# Batch W3 Independent Validation

## Requirement Check

WU3 required persistent workflow rename support with `display_name`, authenticated browser rename, UI control, Telegram/notification fallback display, and lifecycle preservation.

## Validation Result

PASS.

## Evidence

- Schema is v16 and creates/migrates nullable `overmind_workflows.display_name`.
- `OvermindService.register()` continues to update projcore-owned `label` but does not insert or update `display_name`.
- `OvermindService.setTasks()` updates task state only and does not update `display_name`.
- `OvermindService.setDisplayName()` is the only service method added for writing `display_name`.
- `POST /api/overmind/workflows/:id/name` uses JWT middleware and sets or clears the custom name.
- Workflow cards render `display_name || label` and include a compact rename control.
- Telegram `/overmind` and `/om_tasks` use `display_name || label`.
- DONE, BLOCKED, and needs-input notifications use `display_name || label`.

## Critical Preservation Check

The targeted service test proves the critical rule:

1. Set `display_name`.
2. Re-register the same workflow with a different `label`.
3. Confirm `display_name` survives.
4. Run `setTasks`.
5. Confirm `display_name` still survives.

## Gate

- Targeted vitest: PASS.
- `npx tsc`: PASS.
- `npm run build`: PASS.

No unresolved blockers.
