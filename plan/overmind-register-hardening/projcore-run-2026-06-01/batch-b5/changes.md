# Batch B5 Changes

## Branch: `feat/ovm-register-hardening`

Cut from `feat/ovm-register-hardening` @ `99dfdfb`.

## User Report (verbatim from brief)

"When a workflow successfully registers (the 201 attach in `POST /api/overmind/register`), AGJAssist surfaces an in-app announcement so JROM sees registrations live."

## Root Cause (mechanism-level)

Feature: successful first-time attach registration now emits an Overmind websocket registration announcement, and the dashboard renders it as an in-app toast.

## Code Changes

- `src/api/websocket/overmind-stream-manager.ts` - Added typed optional registration announcements to existing update broadcasts.
- `src/api/routes/overmind-routes.ts` - Added first-insert detection before `registerAttached()` and broadcasts one registration announcement only when no existing project/run row existed.
- `src/web/public/app.js` - Added Overmind workflow toast state and websocket handling for `overmind-registration` announcements.
- `tests/overmind-stream.test.ts` - Added serialization coverage for update broadcasts carrying a registration announcement.
- `tests/overmind-routes.test.ts` - Added route coverage for first attach emit, idempotent reattach silence, and rejected 404/422 silence.

## Commits

- `HEAD` feat(overmind): announce successful registration in-app (B5, R5) | scenarios: R5.1, R5.2, R5.3

## Standing Rules (if discovered)

- First attach registration announcements must key off pre-existing `project_id + run_dir` state before `registerAttached()` because that service method performs an upsert.

## Verification

- Build: PASS (`npm run build`)
- Type-check: PASS (`npx tsc --noEmit`)
- Tests: PASS (`npx vitest run`) - 40 files passed, 540 tests passed, 1 skipped
- DEV deploy: PASS (`pm2 restart agjassist`) - PM2 reported `agjassist` online as pid `2672143`
- Smoke verify:
  - API/Websocket: `tests/overmind-routes.test.ts` asserts first attach emits exactly one stream broadcast with `project_slug`, `workflow_id`, `label`, and `run_dir`; idempotent reattach, 404 no-project, and 422 forbidden field emit no announcement.
  - Web UI: `tests/overmind-stream.test.ts` asserts the existing Overmind update stream carries the announcement payload consumed by the dashboard toast.

## Bug Reproductions (if bug fixes)

- Not applicable. This batch implements feature R5.

## Caveats

- None.
