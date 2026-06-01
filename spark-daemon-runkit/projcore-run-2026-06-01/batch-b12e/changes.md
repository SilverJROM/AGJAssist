# B12e Changes

## User Report
You are the IMPLEMENTER (codex). /projcore from AGJ-51. New batch — read+execute in full: /home/agjrom/TGBOTS/AGJAssist/spark-daemon-runkit/projcore-run-2026-06-01/prompts/batch-b12e.md (overmind_projects GET/PATCH/DELETE routes + active-runs guard; PATCH/DELETE owner-JWT-only, reads dual-auth; reuse B12d service + gate). Handshake: STATUS: PROPOSED then WAIT for APPROVED-PLAN. Callback FIRST on state change. DISPATCH-MARKER: AGJ-B12E

APPROVED-PLAN for B12e. Surgical and correct (read dual-auth, mutations reuse the owner gate, slug/app_path immutable→400, DELETE active-runs guard). One note: keep the active-runs definition consistent with activeRunsCountForProjectSlug from B12d (non-terminal statuses = active) so the GET count and the DELETE guard agree. Proceed. Callback FIRST on DONE.

## Root Cause
`overmind_projects` creation and service read helpers existed from B12d, but there were no GET/PATCH/DELETE project routes. There were also no service helpers for updating mutable project metadata or deleting a project after validating active-run state.

## Files Changed
- `src/api/routes/overmind-routes.ts`: added dual-auth project reads, owner-only PATCH/DELETE routes, immutable `slug`/`app_path` rejection, and response shaping with `active_runs_count`.
- `src/services/overmind-service.ts`: added `updateProjectBySlug` and `deleteProjectBySlug`; delete detaches workflow FK references before removing the project row.
- `src/services/overmind/types.ts`: added `UpdateOvermindProjectInput`.
- `tests/overmind-routes.test.ts`: covered read dual-auth, viewer reads, PATCH owner-only/immutability/404, and DELETE 409/200/non-owner behavior.
- `tests/overmind-service.test.ts`: covered project update/delete helpers.

## Autonomous Decisions
- Logged: `../decisions/2026-06-01-b12e-delete-detaches-history.md`.
