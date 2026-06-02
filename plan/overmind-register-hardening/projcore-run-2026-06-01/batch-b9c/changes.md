# Batch B9c Changes

## Summary

Implemented multi-signal run detection for Overmind so a workflow is considered idle only when parent, children, and recent activity signals are all quiet.

## Code Changes

- Added `src/services/overmind/idle-decision.ts` with a pure `decideRunIdle` helper.
- Added shared `hasBusySignal` pane detection for:
  - real `esc to interrupt` active-turn lines
  - `Working (`
  - `Worked for `
- Updated workflow, parent, child, and active-session classifiers to use the shared busy signal.
- Updated `OvermindWatcher` to:
  - calculate idle from coordinator busy, child busy, child working status, `last_activity_at`, `last_parent_update_at`, task log, tracked artifact mtimes, and `.git/HEAD`/ref mtime
  - suppress all-idle nudges while any activity signal is fresh
  - suppress stuck/problem status when recent activity or active child work proves the run is live
  - avoid artifact fail-safe double-nudges for workflows already handled by the stuck ladder
- Updated artifact fail-safe freshness to include `last_activity_at`.

## Tests

- Added pure idle-decision coverage for busy child, recent activity, and genuinely stale idle.
- Added watcher coverage for:
  - static coordinator plus busy child does not nudge or stay stuck
  - fresh progress artifact suppresses all-idle nudge
  - stale/quiet run still sends the all-idle nudge
- Updated existing stale-run fixtures to explicitly stale B9c activity signals.

## Scope

No child sessions are targeted by nudges. Git activity detection is file-stat based (`.git/HEAD` and referenced ref), with no per-tick shelling out.
