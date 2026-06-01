# B12k Changes

## User Report

APPROVED-PLAN for B12k. Tight and correct - edit (immutable slug/app_path), delete (409-aware, row kept), warn tile from the minimal latest_parent_status GET field, conventional commit. Good. For 'latest attached workflow parent_status', use the most-recently-updated workflow for that project_id. Seed a bare-bash-parent project + an active-run project to prove the warn tile + delete-409 visually. Proceed. Callback FIRST on DONE.

## Root Cause / Mechanism

B12j created the OVM Projects list and create flow only. The existing CRUD endpoints already allowed owner-only PATCH/DELETE, but the dashboard had no row actions and the project GET response did not expose the latest workflow parent warning state needed by R12.6/R12.7.

## Files Changed

- `src/services/overmind-service.ts`: added `latestParentStatusForProjectSlug`, selecting the most recently updated workflow for the project's `project_id`.
- `src/services/overmind/types.ts`: added optional `latest_parent_status` to the project read shape.
- `src/api/routes/overmind-routes.ts`: included `active_runs_count` plus `latest_parent_status` on project list/read/update responses.
- `src/web/public/app.js`: added Edit modal, owner PATCH submit, Delete confirm, 409/error surfacing, row removal on delete success, and yellow warning rendering.
- `src/web/public/style.css`: added compact row action and parent warning styles.
- `tests/overmind-routes.test.ts`: extended project read coverage for `latest_parent_status`.

## Autonomous Decisions

None.
