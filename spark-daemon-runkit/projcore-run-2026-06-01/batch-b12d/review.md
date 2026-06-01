# Batch B12d Review

## Scope Check
PASS. The diff is limited to the overmind project service helpers, POST route, targeted tests, and B12d artifacts.

## Auth Check
PASS. `POST /api/overmind/projects` does not call `requireLoopbackAndToken` as an accepted path. The only success path is a valid owner JWT. Valid viewer JWT and loopback-token-only both return the documented 403 response.

## Route Surface Check
PASS. Only POST was added. GET list, GET by slug, PATCH, and DELETE remain out of scope for B12e.

## Data Validation Check
PASS. Required strings are trimmed and checked for non-empty values. `app_path` must be absolute and exist on disk. `created_by` is ignored from caller input and forced in SQL.

## Conflict Check
PASS. SQLite unique conflicts on `slug` or `app_path` return 409.

## Residual Risk
Low. `activeRunsCountForProjectSlug` defines active as status not in `completed`, `failed`, or `paused`, matching the existing terminal-status set used by the service.
