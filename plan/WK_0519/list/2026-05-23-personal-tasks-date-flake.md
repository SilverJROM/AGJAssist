---
date: 2026-05-23
type: bug / test infrastructure
status: quarantined
handler: future-batch (out of WK_0519 modularization scope)
source: surfaced by repeated vitest runs during overmind work
qa_verification: required when fixed
---

# 2026-05-23 — personal-tasks daily-completion date-rollover flake

## What

`tests/unit/personal-tasks-reminders.spec.ts > toggles completion for daily task` fails near the UTC midnight boundary:

- `toggleCompletion(task.id, today)` writes a completion row keyed on `today` (`YYYY-MM-DD`).
- `list(userId, "daily")` reads `completed_today` using its own (different) date computation path.
- When the two compute different dates (e.g. test starts at 23:59:59.xxx and the list read happens after rollover), `completed_today` reads `false` even though the write succeeded.

Pre-dates the modularization refactor (confirmed by stashing the refactor changes and re-running — still failed).

## Action

Quarantined as `it.skip` in B1 of the modularization run with a comment explaining the divergence. Baseline becomes `442 passing | 1 skipped | 0 failing` for the duration of the refactor.

## Proposed fix (when picked up)

Either share the "today" derivation between `toggleCompletion` and the `list` `completed_today` join, or pass an explicit `today` arg into both. Single atomic ~15min batch.
