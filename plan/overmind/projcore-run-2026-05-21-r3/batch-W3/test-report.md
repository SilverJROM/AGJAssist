# Batch W3 Test Report

## Commands

- `npx vitest run tests/overmind-service.test.ts`: PASS, 13 tests.
- `npx vitest run tests/overmind-routes.test.ts`: PASS, 5 tests.
- `npx vitest run tests/overmind-service.test.ts tests/overmind-routes.test.ts tests/overmind-notifications.test.ts`: PASS, 22 tests.
- `npx tsc`: PASS.
- `npm run build`: PASS.

## Critical Scenario

`tests/overmind-service.test.ts` includes `preserves display_name across re-register and setTasks updates`.

Coverage:
- Register a workflow.
- Set `display_name` to `JROM custom name`.
- Re-register the same `coordinator_session` with a different projcore `label`.
- Assert `label` updates while `display_name` remains `JROM custom name`.
- Run `setTasks`.
- Assert `display_name` still remains `JROM custom name`.

## Route Scenario

`tests/overmind-routes.test.ts` covers:
- Unauthenticated rename request returns 401.
- Authenticated rename trims and persists `display_name`.
- Empty name clears to null.
- Unknown workflow returns 404.

## Notification Scenario

`tests/overmind-notifications.test.ts` covers DONE, BLOCKED, and needs-input messages using `display_name` when present.
