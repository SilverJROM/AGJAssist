# Batch V6 Changes

## User Report

Final batch V6 (IMPLEMENTER; /projcore supervises from AGJ-51). Read plan/overmind/projcore-run-2026-05-21-ui/prompts/batch-V6.md and follow EXACTLY. V6 = elapsed-time stat that FREEZES when all tasks done + resumes if a new not-done task appears (RU8), and a task history log appended on change (RU9). Schema v13 (guarded ALTER ADD COLUMN ended_at + task_log, idempotent on live DB). MANDATORY handshake: STATUS: PROPOSED first, WAIT for APPROVED-PLAN. Stay on feat/overmind. Callback FIRST to that run's callbacks.md. Give me your PROPOSED plan now.

APPROVED-PLAN for V6. Proceed exactly as proposed (esp. guarded v13 migration idempotent on live DB; ended_at freeze-when-all-done + clear-when-a-new-not-done-task-appears; task_log no-op skip + 50 cap; reuse the existing now-interval for live elapsed). Implement on feat/overmind, commit, gate (targeted tests: v13 columns + freeze/resume + completed-stamp + log append/no-op/cap + elapsed helper; npx tsc; npm run build). Artifacts batch-V6/changes.md + test-report.md + independent-validation.md. Append callback FIRST ([projcore callback] V6 DONE <note>), THEN STATUS: DONE -- reason.

## Root Cause

Workflows tracked `created_at`, `status`, `current_task`, and the current task array, but had no persistent completion timestamp or transition history. The UI could only show current state, so elapsed time could not freeze after completion or resume when a newly injected non-done task reopened the workflow, and reviewers had no compact audit trail of task transitions.

## Changes

- `src/db/database.ts`: bumped schema version to 13, added fresh-schema `ended_at TEXT` and `task_log TEXT NOT NULL DEFAULT '[]'`, and added guarded v13 migration with `PRAGMA table_info` checks before `ALTER TABLE ADD COLUMN`.
- `src/services/overmind-service.ts`: added `ended_at` and parsed `task_log` to workflow mapping; `setTasks` now freezes `ended_at` when all tasks are done, clears it when a non-done task appears, appends task-log entries on current-task or done-count changes, skips no-op logs, and caps history at 50 entries. `setStatus('completed')` stamps `ended_at` once.
- `src/web/public/overmind-helpers.js`: added pure `elapsedMs` and `formatElapsed` helpers and reused the timestamp parser for SQLite datetime strings.
- `src/web/public/app.js`: added elapsed display to expanded workflow metadata using the existing `now` interval, with frozen completed display marked `(done)`, and rendered newest-first History from `task_log`.
- `src/web/public/style.css`: added compact History list styling.
- `tests/overmind-service.test.ts` and `tests/overmind-stream.test.ts`: added targeted coverage for schema v13, idempotent migration, freeze/resume, completed-stamp, task-log append/no-op/cap, and elapsed helpers.

## Autonomous Decisions

- Included an optional `note` field in task-log entries to preserve the RU9 `{..., note}` shape while keeping UI display focused on timestamp, current task, and done/total.
