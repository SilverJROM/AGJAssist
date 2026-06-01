# B12e Test Report

## Commands
`npm test -- --run tests/overmind-routes.test.ts tests/overmind-service.test.ts -t "overmind project|overmind_projects"`

Result: PASS. 2 files passed, 6 tests passed, 77 skipped.

`npm test -- --run tests/overmind-routes.test.ts tests/overmind-service.test.ts`

Result: PASS. 2 files passed, 83 tests passed.

`npm run build`

Result: PASS.

## Coverage Notes
- GET list and GET by slug return `active_runs_count` using non-terminal workflow statuses as active.
- Reads pass with loopback token and viewer JWT.
- PATCH updates `parent_session` and `notes` with owner JWT, rejects immutable fields, returns 403 for non-owner callers, and 404 for missing projects.
- DELETE returns 409 while an active run exists, succeeds after completion, leaves the row on 409, removes the row on 200, and rejects non-owner callers.
