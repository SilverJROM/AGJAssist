# B12i Changes

## User Report

> R11.4 pre-nudge recheck: before each outbound overmind nudge, is_agent_pane(project.parent_session via project_id) -> bare-bash/no-session -> suppress + parent-orphaned + TG URGENT once-per-run + log.

## Root Cause

After B12c/B12f, attached workflows no longer store the project parent in `coordinator_session`; the parent source of truth is `overmind_projects.parent_session`. The watcher/nudge code still sent directly to `workflow.coordinator_session`, so a parent that died or became a bare shell could still receive Overmind nudge text as pasted shell input.

## What Changed

- `src/services/overmind/parent-nudge-guard.ts`
  - Added the shared chokepoint for outbound parent nudge/reminder sends.
  - Resolves `overmind_projects.parent_session` with `getParentSessionForWorkflow(workflow.id)`, then falls back to legacy `workflow.coordinator_session`.
  - Reuses B12b `isAgentPane()` before sending.
  - Suppresses sends for `bare-bash` and `no-session`, persists `parent_status`, logs the suppression, and sends TG URGENT once per run.

- `src/services/nudge-state-service.ts`
  - Added an in-memory `parentOrphanedAlerts` debounce set.
  - No DB column and no migration: server-restart re-fire is accepted for pre-live per approved clarification.

- `src/services/overmind-watcher.ts`
  - Routed reconcile registration-gap asks, PATH 2 apparent-idle nudges, completeness requests, and PATH 3 artifact fail-safe calls through the guard.
  - Preserves orphaned `parent_status` in the final workflow update for the tick.

- `src/services/overmind/nudge-ladder.ts`
  - Routed canned stuck nudges, Tier-3 brain nudges, and decision auto-answer sends through the guard.

- `src/services/overmind/idle-detector.ts`
  - Routed artifact fail-safe sends through the guard and reports suppressed parent status to the watcher.

- `src/services/overmind/completion-detector.ts`
  - Routed all-tasks-done completion consult sends through the guard.

- `src/services/overmind-notifications.ts`
  - Added TG URGENT formatting for parent-orphaned suppression.

- `tests/overmind-parent-nudge-guard.test.ts`
  - Added focused coverage for project parent routing, legacy fallback, bare-bash suppression/debounce/log/TG, and no-session suppression.

- `tests/overmind-nudge.test.ts`
  - Mocked `isAgentPane()` as an agent by default so existing mock-tmux nudge tests do not suppress sends because their fake sessions do not exist in real tmux.

## Caveats

- Debounce is process-memory only; a server restart may re-fire the parent-orphaned TG alert once for the same run. This was explicitly accepted for pre-live.
- Route-level register corrective advice and child-close reminders remain outside B12i scope.
