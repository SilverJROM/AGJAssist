# B12f Review

## Scope Review
- In scope: server-side register attach path, service walk-up lookup, attached workflow upsert, tests.
- Out of scope avoided: shell client migration, parent pane warning, dashboard changes, migration script.

## Back-Compat Review
- Legacy shape remains `label + session + run_dir`.
- Legacy branch still enforces existing payload validation, tmux-safe session validation, project-tree conflict checks, new-parent task requirement, and omitted-task preservation.
- Child update paths remain untouched; `/api/overmind/children` still supports workflow id/run-dir/session lookup, and the shell fallback to legacy `/register` still has a valid server path.

## Risk Review
- New attach does not copy project `parent_session` into `coordinator_session`.
- New attach idempotency is enforced by looking up the existing row by `(project_id, canonical run_dir)` before insert.
- 404 reports the canonical `run_dir` and root `searched_up_to` when the walk reaches filesystem root without a project.

