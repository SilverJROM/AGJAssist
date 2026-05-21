# Batch W7 Changes

## User Report

Final batch W7 (IMPLEMENTER; /projcore from AGJ-51). Read plan/overmind/projcore-run-2026-05-21-r3/prompts/batch-W7.md and follow EXACTLY. W7 = restructure the expanded card (header name+rename+chevron+badge; sub-status task#+desc; parent|child grid with each session's status colored; Elapsed/Total; Tier/Stuck; tasks), UNIFY colors (working=green, idle=yellow, needs-you=blue, stuck=red, done/paused/closed=grey), and REMOVE the inline history block (History TAB stays). child=n/a if none. UI only. MANDATORY handshake: STATUS: PROPOSED first, WAIT for APPROVED-PLAN. feat/overmind. Callback FIRST. Give me your PROPOSED plan now.

## Root Cause Mechanism

- The W2 card still used the previous expanded layout with coordinator/children/active rows and an inline per-card History section.
- `statusColor()` still encoded the older RU2 colors, including `working -> yellow` and needs-you statuses as green.
- W6 provided independent `parent_status` and `child_statuses`, but the card was not yet rendering those per-session statuses.

## Per-File WHY

- `src/web/public/overmind-helpers.js`
  - Remapped `statusColor()` to the WU7 unified status scheme and added `idle` plus `closed` handling.
- `src/web/public/app.js`
  - Reworked the active/completed workflow card header to show name, rename, chevron, and colored overall badge.
  - Added sub-status with `task#<id/index>` and current task description.
  - Replaced expanded detail rows with the required parent/child, colored status, elapsed/total, and tier/stuck grid.
  - Used W6 `parent_status` and `child_statuses` for per-session status cells.
  - Removed the inline per-card History details block while leaving the History tab rendering intact.
- `src/web/public/style.css`
  - Added `ovm-blue`, status-cell dot styling, compact extra-child rows, sub-status styling, and header control styling.
- `tests/overmind-stream.test.ts`
  - Updated status color expectations for green working, yellow idle/active, blue needs-you, red stuck/failed, and grey completed/paused/closed.

## Autonomous Decisions

- No non-trivial autonomous decisions. For workflows with no child sessions, the child cell and child status cell render `n/a`; actual `closed` child statuses render grey.
