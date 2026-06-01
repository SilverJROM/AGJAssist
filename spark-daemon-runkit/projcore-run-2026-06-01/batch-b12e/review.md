# B12e Review

Verdict: PASS.

## Scope
- Stayed within `/api/overmind/projects` read/update/delete routes and matching service helpers.
- Did not touch register, client, dashboard, migration, or unrelated overmind lifecycle routes.
- Reused the B12d owner-JWT mutation gate for PATCH/DELETE.
- Reads accept either dashboard JWT, including viewer role, or loopback plus `X-Overmind-Token`.

## Risk Checks
- `active_runs_count` for GET and the DELETE guard both call `activeRunsCountForProjectSlug`, so active-run semantics stay consistent.
- `slug` and `app_path` are rejected with 400 on PATCH before update.
- Project deletion first requires active count 0 at the route layer. The service then clears `project_id` from historical workflow rows so completed/paused/failed history does not violate the FK.

## Out Of Scope Confirmed
- No POST behavior changes beyond shared helper typing.
- No dashboard/client changes.
- No register changes.
