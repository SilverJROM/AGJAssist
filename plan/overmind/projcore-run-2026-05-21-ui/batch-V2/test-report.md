# Batch V2 Test Report

## Commands

- `npx vitest run tests/overmind-classifier.test.ts tests/overmind-nudge.test.ts tests/overmind-service.test.ts tests/overmind-stream.test.ts tests/unit/database.spec.ts`
  - PASS: 5 files, 36 tests.
- `npx tsc`
  - PASS: clean.
- `npm run build`
  - PASS: `tsc -p tsconfig.json && cp -r src/web dist/`.

## Coverage Notes

- Watcher attribution:
  - Parent coordinator pane busy -> `active_session` is the coordinator session and `active_role` is `parent`.
  - Only child pane busy -> `active_session` is the busy child name and `active_role` is `child`.
  - No panes busy -> both fields are null.
- Schema/service:
  - Fresh DB creates schema v12 with both columns.
  - Existing v11 `overmind_workflows` table migrates via guarded ALTER statements and remains idempotent on reopen.
  - Service round-trips active attribution and resets it on workflow re-register.
- UI helper:
  - Formats child-active, parent-active, and none-active display strings.
