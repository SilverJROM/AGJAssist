# Batch B12a Review

## Findings

No blocking issues found in the scoped diff.

## Review Notes

- The change is additive only: no table rebuild and no `foreign_keys = OFF`.
- `project_id` is nullable, so legacy rows do not need backfill.
- The existing code-browser `projects` table is not modified by schema or migration DDL.
- `idx_overmind_workflows_project_id` and `idx_overmind_workflows_project_status` are intentionally excluded from `SCHEMA_SQL` because old DBs run that template before the v27 `ALTER TABLE`; fresh DBs get them through `applyFreshDbExtras`.
- Commit hygiene was preserved by leaving unrelated ambient churn unstaged.

## Residual Risk

Existing repository tests contain stale schema-version assertions from older batches. They were not broadly refactored in this slice; B12a verification used focused real migration checks instead.
