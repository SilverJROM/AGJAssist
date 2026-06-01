# B12f Changes

## User Report
REGISTER CORE: `{run_dir}`-only attach by walk-up `app_path` match, 422 forbidden fields, 404 no-project, while preserving legacy register back-compat for child-add/rm and un-migrated clients.

## Root Cause Mechanism
Before B12f, `POST /api/overmind/register` only accepted the legacy self-registration identity `{label, session, run_dir, ...}`. That let callers provide derived project identity and tied workflow lookup to caller-provided coordinator sessions. INJECT-002 requires Overmind projects to be JROM-owned and registration to attach a run to an existing project by filesystem containment instead.

## File Changes
- `src/api/routes/overmind-routes.ts`: added dual-shape register dispatch. `{run_dir}` without legacy `label+session` now follows the project attach path; legacy payloads keep the existing validation/upsert branch.
- `src/services/overmind-service.ts`: added realpath-normalized run-dir walk-up matching against `overmind_projects.app_path`, plus attached workflow upsert by `(project_id, run_dir)`.
- `src/services/overmind/types.ts`: exposed `project_id` on `OvermindWorkflow`.
- `tests/overmind-routes.test.ts`: added B12f route coverage for attach success, nested walk-up, idempotent upsert, 404 `searched_up_to`, 422 forbidden field, and legacy continuity.

## Caveats
- Parent-session warn-check is intentionally not included; that is B12g.
- `overmind.sh register --run-dir` client stripping is intentionally not included; that is B12h.
- Attached workflows store `coordinator_session = NULL` at runtime per B12c. The broader watcher/nudge paths still assume legacy rows until the later R12 routing batches consume project-owned parent sessions.

