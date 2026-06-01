# Batch B12a Changes

## User Report

You are the IMPLEMENTER (codex). Claude /projcore supervises from AGJ-51. New batch — read and execute in full: /home/agjrom/TGBOTS/AGJAssist/spark-daemon-runkit/projcore-run-2026-06-01/prompts/batch-b12a.md  — this is the FIRST INJECT-002 schema batch (additive overmind_projects table + workflows.project_id FK, v27). Follow the plan-handshake: reply STATUS: PROPOSED first and WAIT for APPROVED-PLAN before coding. Write the callback to callbacks.md FIRST on each state change. DISPATCH-MARKER: AGJ-B12A-2026-06-01

APPROVED-PLAN for B12a — plan is correct and well-scoped. Two reinforcements before you implement: (1) COMMIT HYGIENE: the worktree has unrelated ambient churn (.overmind-state.json, plan/overmind/audit/*, src/services/overmind/classifier.ts, coord-notes-*). Stage ONLY src/db/schema.ts, src/db/database.ts, and spark-daemon-runkit/projcore-run-2026-06-01/batch-b12a/* using explicit 'git add <paths>' — NEVER 'git add -A' or '-u'. Branch feat/spark-daemon-b12a-schema from feat/spark-daemon as planned. (2) STALE-DDL TESTS: do NOT broadly refactor existing tests; only make your B12a targeted tests exercise the real migration path. If an existing test hand-rolls overmind_workflows DDL and now conflicts, minimally add project_id to it and note in changes.md. Proceed. Callback FIRST on DONE, then STATUS: DONE.

## Root Cause

INJECT-002 requires projects to become the source-of-truth namespace for overmind workflows, but the current v26 schema had no `overmind_projects` table and no workflow-level nullable project FK. Existing workflow rows also needed to survive without backfill.

## Code Changes

### `src/db/schema.ts`

Why: define the v27 fresh schema.

- Bumped `SCHEMA_VERSION` from `26` to `27`.
- Added additive `overmind_projects` table with unique `slug` and `app_path`, required `parent_session`, optional `notes`, default `created_by = 'JROM'`, and timestamps.
- Added nullable `project_id INTEGER REFERENCES overmind_projects(id)` to fresh `overmind_workflows`.
- Added `idx_overmind_projects_app_path` to the fresh schema.
- Added `idx_overmind_workflows_project_id` and `idx_overmind_workflows_project_status` through `applyFreshDbExtras`, not directly in `SCHEMA_SQL`, because upgrade initialization runs `SCHEMA_SQL` before the v27 `ALTER TABLE`.

### `src/db/database.ts`

Why: apply v27 safely to existing DBs.

- Added guarded v26 to v27 migration block.
- Creates `overmind_projects` with `CREATE TABLE IF NOT EXISTS`.
- Checks `PRAGMA table_info(overmind_workflows)` before adding `project_id`.
- Creates all three required indexes with `CREATE INDEX IF NOT EXISTS`.
- Keeps `PRAGMA foreign_keys = ON`; does not rebuild tables or disable FK enforcement.

## Test Changes

No persistent test-suite files were modified, matching the commit-hygiene instruction to stage only the two schema files and B12a artifacts. Targeted B12a migration coverage was run through an isolated real `DatabaseService` migration script and recorded in `test-report.md`.

## Autonomous Decisions

See `decisions/2026-06-01-project-id-index-fresh-extras.md`.
