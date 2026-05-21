# Batch V6 Test Report

## Commands

- `npx vitest run tests/overmind-service.test.ts tests/overmind-stream.test.ts`
  - PASS: 2 files, 16 tests.
- `npx tsc`
  - PASS.
- `npm run build`
  - PASS.

## Targeted Coverage

- Schema v13 fresh DB includes `ended_at` and `task_log`.
- Legacy overmind workflow table migrates to v13 with guarded, idempotent `ALTER TABLE ADD COLUMN`.
- `setTasks` stamps `ended_at` when every task is `done`.
- `setTasks` preserves the frozen `ended_at` on repeated all-done updates.
- `setTasks` clears `ended_at` when a new pending task appears.
- `setStatus('completed')` stamps `ended_at`.
- `task_log` appends on current-task change and done-count change.
- `task_log` skips identical no-op updates.
- `task_log` caps at 50 entries.
- `elapsedMs` and `formatElapsed` cover live and frozen elapsed calculations, including SQLite-style timestamps.
