# Review — B12c

Self-review completed against R12.12.

- Rebuild uses explicit column list, not `SELECT *`.
- New table reproduces current workflow DDL except only `label` and `coordinator_session` are relaxed.
- Foreign keys are disabled before the rebuild transaction and restored after it.
- `foreign_key_check` is executed before transaction commit and aborts on violations.
- Row-count assertion aborts on copy drift.
- Existing register API remains session/label based for back-compat; only its implementation no longer relies on a unique session constraint.
- Lifecycle lookup order is `workflow_id`, then `run_dir`, then legacy `session`.
- Parent read helper uses project linkage and does not route through `coordinator_session`.

Residual risk: other watcher/nudge runtime code still assumes `coordinator_session` exists when sending tmux messages. This is outside B12c consumer wiring and is scheduled for later parent-routing batches; B12c provides the project-parent resolver for that work.
