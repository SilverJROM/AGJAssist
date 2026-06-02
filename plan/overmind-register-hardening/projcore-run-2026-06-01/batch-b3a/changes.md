# Batch B3a Changes

## Inventory

| File | Legacy register call sites before | Legacy register call sites after |
| --- | ---: | ---: |
| `tests/overmind-routes.test.ts` | 55 | 0 |
| `tests/overmind-service.test.ts` | 53 | 0 |
| `tests/acceptance/overmind-projects-api.acceptance.test.ts` | 0 legacy, stale attach expectations | 0 |

## Categories

| Category | Decision | Result |
| --- | --- | --- |
| General route register/setup behavior | Migrated | Replaced legacy `{label, session, run_dir}` POST setup with project-backed attach `{run_dir}` and `/children` where child sessions are part of the scenario. |
| Service workflow behavior | Migrated | Added `attachedRun()` helper using `createProject()` + `registerAttached()` and migrated remaining service scenarios to project/run-dir identity. |
| Attach/register acceptance expectations | Migrated | Updated acceptance assertions to the current attach contract: derived `coordinator_session`, structured 404/422 bodies. |
| Legacy-only route behavior | Deleted | Removed tests for legacy session/tree-conflict 409s, arbitrary no-project registration, and corrective tmux advice tied to legacy conflict handling. |
| Legacy-only service behavior | Deleted | Removed tests for session-keyed re-register elapsed rollover and `findProjectTreeMatch()` legacy conflict selection. |
| Existing non-register session flows | Kept | `/tasks`, `/complete`, `/history`, and close-reminder tests still use `session` where those routes support session lookup; they no longer seed through legacy `/register`. |

## Deletions

- Deleted route tree-conflict tests for same-session cross-project 409, different-session same-tree 409, completed-tree 409, and arbitrary no-project legacy registration. These behaviors are specific to the legacy register branch removed in B3b.
- Deleted route corrective-advice tmux tests for legacy register conflicts. The attach model derives identity from projects and no longer asks callers to switch `session` names.
- Deleted service `findProjectTreeMatch()` tests. That helper supports the legacy route conflict model and is no longer a surviving attach behavior.
- Deleted service elapsed rollover tests for legacy session re-register with a different run_dir. B3b must confirm whether attach re-register needs elapsed/accumulated_ms rollover for the OVM Elapsed/Total display (B11), so this is not silently lost.

## Net Test Count

- `tests/overmind-routes.test.ts`: 50 tests after migration.
- `tests/overmind-service.test.ts`: 35 tests after migration.
- Planned net change for the original two files: `-13` tests.

## Additional Test-Only Cleanup

The first full-suite run exposed stale non-register assertions already inconsistent with the current branch state. To satisfy the batch's full-suite green requirement without production edits, these test-only expectations were updated:

- `tests/acceptance/overmind-projects-api.acceptance.test.ts`: current attach response contract.
- `tests/notes-folders.test.ts` and `tests/notes-migration.test.ts`: current schema version `28`.
- `tests/overmind-stream.test.ts`: `spark_health` stream payload and current watcher mock shape.
- `tests/ovm-session.test.ts`: current `overmind:`-prefixed primer command.
