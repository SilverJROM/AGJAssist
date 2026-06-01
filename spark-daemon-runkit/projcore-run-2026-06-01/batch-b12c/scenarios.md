# Scenarios — B12c Workflow Identity Retrofit

Scope: R12.12 only. Make workflow identity independent from `coordinator_session` while preserving legacy session compatibility.

## TS-B12C-001 — v28 Rebuild Row Survival
Given a v27 database with multiple `overmind_workflows` rows, including `project_id` values and legacy `project_id NULL` rows
When `DatabaseService` opens the DB
Then schema version becomes 28, row count is unchanged, spot-checked values survive, `label` and `coordinator_session` are nullable, and `PRAGMA foreign_keys` is restored to ON.

## TS-B12C-002 — Identity Constraints
Given the v28 schema
Then `coordinator_session` is indexed but not unique, multiple NULL sessions are allowed, duplicate non-null sessions no longer conflict, and `(project_id, run_dir)` is unique for non-null projects.

## TS-B12C-003 — Lifecycle Lookup
Given an existing workflow
When `/api/overmind/tasks`, `/api/overmind/complete`, or `/api/overmind/children` is called with `workflow_id` or `run_dir` and no `session`
Then the workflow is found and updated. Legacy `session` lookup still works.

## TS-B12C-004 — Project Parent Resolver
Given a workflow linked to `overmind_projects`
When the parent resolver is called
Then it returns `overmind_projects.parent_session` via `project_id`, not `overmind_workflows.coordinator_session`.

## TS-B12C-005 — Client Payloads
Given `.overmind-state.json` contains `workflow_id`
When `overmind.sh sync`, `complete`, `stall-alert`, `pause`, `resume`, `child-add`, or `child-rm` runs
Then payloads include `workflow_id` and `run_dir`, with `session` retained only as legacy fallback.
