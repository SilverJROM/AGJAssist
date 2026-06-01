# Decision: Put project_id workflow indexes in fresh DB extras

## Context

`DatabaseService` runs `SCHEMA_SQL` during upgrades before the version-specific migration blocks. If `SCHEMA_SQL` contains indexes on a column that only gets added later by `ALTER TABLE`, existing DBs fail before the migration block can add the column.

## Decision

Keep `idx_overmind_workflows_project_id` and `idx_overmind_workflows_project_status` out of the main `SCHEMA_SQL` template. Create them in:

- `applyFreshDbExtras` for fresh databases after the fresh schema creates `project_id`.
- The v26 to v27 migration block after the guarded `ALTER TABLE` adds `project_id`.

## Consequence

Fresh and upgraded databases both get the required indexes exactly once, and existing v26 databases do not fail during the pre-migration `SCHEMA_SQL` execution.
