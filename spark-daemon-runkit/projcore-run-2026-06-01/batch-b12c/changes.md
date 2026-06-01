# Changes — B12c Workflow Identity Retrofit

- Bumped schema version to 28.
- Rebuilt `overmind_workflows` in v27→v28 using explicit matching column lists.
- Made only `label` and `coordinator_session` nullable; all other column types/defaults/checks are preserved.
- Dropped unique identity on `coordinator_session` and added unique `idx_overmind_workflows_project_run_dir` on `(project_id, run_dir)`.
- Added row-count assertion and `PRAGMA foreign_key_check` inside the rebuild transaction, with `foreign_keys=OFF` before the transaction and restored to ON afterward.
- Replaced register's `ON CONFLICT(coordinator_session)` dependency with explicit legacy-session upsert logic so register remains compatible after the unique constraint is removed.
- Added shared workflow lookup by `workflow_id` → `run_dir` → legacy `session`.
- Updated `/api/overmind/tasks` and `/api/overmind/complete` to use the shared resolver.
- Added `/api/overmind/children` for child lifecycle updates by `workflow_id`/`run_dir` without requiring `session`.
- Added project-parent resolver that reads `overmind_projects.parent_session` through `overmind_workflows.project_id`.
- Updated deployed `~/.claude/agents/lib/overmind.sh` lifecycle payloads to include `workflow_id` and `run_dir`, keeping `session` as fallback.
- Snapshot saved at `spark-daemon-runkit/batch-b12c/artifacts/overmind.sh`.
