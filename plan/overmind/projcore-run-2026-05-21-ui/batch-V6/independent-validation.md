# Batch V6 Independent Validation

## Scope Check

Validated RU8 and RU9 only. No nudge, brain, watcher, or prior V1-V4 behavior was intentionally changed.

## Requirement Evidence

- RU8: `ended_at` persists in schema v13 and is mapped through `OvermindWorkflow`. Service tests prove all-done tasklists freeze elapsed, repeated all-done updates keep the same freeze timestamp, newly introduced non-done tasks clear `ended_at`, and `setStatus('completed')` stamps completion.
- RU9: `task_log` persists in schema v13, maps as a parsed array, appends only on current-task or done-count changes, skips identical updates, and caps to the last 50 entries. The expanded workflow card renders History newest first.

## Build Evidence

- Targeted Vitest: PASS.
- TypeScript: PASS.
- Build: PASS.

## Residual Risk

No browser smoke screenshot was captured for the expanded History display in this batch. The DOM path is narrow and reuses the existing expanded-card data flow and existing `now` interval.
