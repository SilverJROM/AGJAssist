# Batch W6 Changes

- Bumped overmind schema to v19 with `parent_status TEXT` and `child_statuses TEXT NOT NULL DEFAULT '[]'` on fresh schema and guarded migration.
- Added `TmuxService.sessionExists(target)` using `tmux has-session` against the session portion of a tmux target.
- Added independent per-session classifiers:
  - parent coordinator pane: `working | idle | waiting_human | awaiting_decision | stuck`
  - child pane/session: `working | idle | closed`
- Updated `OvermindWatcher` to persist `parent_status` and `child_statuses` every tick, including all-tasks-done paths, while leaving overall workflow `status`, `active_session`, `active_role`, brain, nudge, notification, and UI behavior unchanged.
- Updated `OvermindService` interfaces, row mapping, and `update()` persistence to round-trip the new v19 fields.
- Added targeted tests for parent working/idle/waiting/decision/stuck, child working/idle/closed, watcher persistence with a closed child, and v19 service/schema round-trip.
