# Batch B12a Test Report

## Commands

### Build

`npm run build`

Result: PASS

### Targeted Real Migration Check

`node --import tsx --input-type=module`

The script exercised `DatabaseService` against temporary SQLite DBs under `data/` and cleaned them up after completion.

Result: PASS

Covered:

- Fresh DB initialization and reopen idempotency.
- `schema_version.version = 27`.
- `overmind_projects` table exists.
- `overmind_workflows.project_id` exists exactly once.
- `idx_overmind_projects_app_path`, `idx_overmind_workflows_project_id`, and `idx_overmind_workflows_project_status` exist exactly once.
- v26 upgrade with a pre-existing `overmind_workflows` row succeeds.
- Existing workflow row survives with `project_id = NULL`.
- Existing code-browser `projects` table/data survives unchanged.
- `PRAGMA foreign_keys` remains enabled.
- Insert with non-existent non-null `project_id` fails under FK enforcement.

## Not Run

Full `npm test` was not run because unrelated/stale test expectations in the current repository still assert older schema versions. This batch did not broadly refactor those tests per the B12a instruction.
