## User Report

"can you do fix here to show the actual time aside from the est time for the task so what we can see if we can improve the estimates"

## Root Cause

B11 computed per-task `actual_min` by scanning `task_log.current_task` and requiring a unique text match against the task id or label. In live workflows, `current_task` is run-level status text and is often dominated by stall annotations or repeated labels, so completed tasks rarely matched exactly enough to recover a start time. The service therefore left `actual_min` as null and the UI rendered `actual --`.

## Changes

- `src/services/overmind-service.ts`
  - Replaced task-log text matching with direct state-transition timing in `setTasks`.
  - Stamps `started_at` when a task transitions into `processing` without a previous start timestamp.
  - Computes `actual_min` only when the stored previous task was `processing`, the submitted task is `done`, and a valid `started_at` exists.
  - Preserves already-set `started_at` and `actual_min`; no task-log backfill is attempted.

- `src/services/overmind/types.ts`
  - Added optional `started_at?: string | null` to `OvermindTask`.

- `src/services/overmind/sanitize.ts`
  - Normalizes/preserves `started_at` on task lists and submitted task validation.
  - Keeps missing or invalid values as null for backward compatibility.

- `tests/overmind-service.test.ts`
  - Replaced the old task-log span proof with a pending -> processing -> done test using a controlled clock.
  - Added a forward-only test proving a task completed without a processing span keeps `actual_min: null`.

- `tests/overmind-sanitize.test.ts`, `tests/overmind-routes.test.ts`
  - Updated exact task-shape assertions for the new nullable `started_at` field and route-level transition stamping.

## Verification

- PASS: `npx tsc --noEmit`
- PASS: `npx vitest run` - 41 test files passed, 546 tests passed, 1 skipped.

## Acceptance Check

- [x] Replaced task-log matching with direct stored-vs-submitted task transition timing.
- [x] `processing` transition with no `started_at` stamps current ISO time.
- [x] `processing` -> `done` computes rounded non-negative `actual_min`.
- [x] Existing `started_at` and `actual_min` are preserved.
- [x] `OvermindTask` includes optional nullable `started_at`.
- [x] Sanitization preserves/normalizes `started_at`.
- [x] Forward-only behavior retained: already done/no processing span remains `actual_min: null`.
- [x] Display code was not touched.

## Caveats

- Existing completed tasks without `started_at` are intentionally not backfilled.
- Live dev smoke and pm2 restart are performed after this artifact per coord deploy order.
