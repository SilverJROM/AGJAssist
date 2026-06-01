# Independent Validation — B12c

No separate validator has run yet.

Implementer validation evidence:
- Real v27 migration fixture preserved row count and spot-checked values.
- `label` and `coordinator_session` are nullable after rebuild.
- `coordinator_session` unique constraint is gone.
- `(project_id, run_dir)` unique index exists and rejects duplicate project/run rows.
- `PRAGMA foreign_keys` is ON after rebuild and `foreign_key_check` is clean.
- Lifecycle routes update by `workflow_id`, `run_dir`, and legacy `session`.
- Project parent resolver returns seeded `overmind_projects.parent_session`.
