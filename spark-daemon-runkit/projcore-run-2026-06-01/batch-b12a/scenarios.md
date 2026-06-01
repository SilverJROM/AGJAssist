# Batch B12a Scenarios

## Scope

R12.1 and the additive half of R12.12 only: add `overmind_projects`, add nullable `overmind_workflows.project_id`, and keep all existing rows/data intact.

## Scenarios

### TS-B12A-001 Fresh schema creates v27 project primitives

Given an empty SQLite database
When `DatabaseService` initializes it and the DB is reopened
Then `schema_version.version` is `27`
And `overmind_projects` exists
And `overmind_workflows.project_id` exists exactly once
And `idx_overmind_projects_app_path`, `idx_overmind_workflows_project_id`, and `idx_overmind_workflows_project_status` each exist exactly once.

### TS-B12A-002 v26 upgrade is idempotent and preserves legacy workflow rows

Given a v26 database with an existing `overmind_workflows` row and no `project_id` column
When `DatabaseService` initializes it twice
Then initialization succeeds both times
And `schema_version.version` is `27`
And the legacy workflow row still exists
And its `project_id` is `NULL`.

### TS-B12A-003 Existing code-browser `projects` table remains untouched

Given a v26 database with an existing `projects` row
When the v27 migration runs
Then the `projects` table still exists
And the existing row values are unchanged.

### TS-B12A-004 Foreign-key enforcement remains enabled

Given a v27 database initialized by `DatabaseService`
When inserting an `overmind_workflows.project_id` value that does not exist in `overmind_projects`
Then SQLite rejects the insert while allowing nullable legacy rows.
