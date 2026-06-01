# B12f Scenarios

## User Report
REGISTER CORE: `{run_dir}`-only attach by walk-up `app_path` match, 422 forbidden fields, 404 no-project, while preserving legacy register back-compat for child-add/rm and un-migrated clients.

## Covered Scenarios
- New attach registers `{run_dir}` under a nested path whose ancestor exactly matches an `overmind_projects.app_path`.
- New attach returns derived `workflow_id`, `project_id`, `project_slug`, and `parent_session`.
- New attach stores `coordinator_session = NULL` and does not copy `parent_session` into workflow identity.
- New attach is idempotent: the same `(project_id, run_dir)` upserts and returns the existing workflow id.
- New attach with no matching project returns `404 no-project-for-run-dir` with `run_dir`, `searched_up_to`, and the required hint.
- New attach with a derived field such as `label` returns `422 forbidden-derived-field`.
- Legacy `{label, session, run_dir, tasks}` register remains accepted and keeps the existing upsert/task-preservation behavior.

