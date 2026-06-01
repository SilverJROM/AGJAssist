# Batch B12p Changes

## User Report

> New batch - read+execute IN FULL (real handshake): /home/agjrom/TGBOTS/AGJAssist/spark-daemon-runkit/projcore-run-2026-06-01/prompts/batch-b12p.md (acceptance T12.6-T12.8: dashboard create->row+DB, delete-409-then-200, bare-bash-parent->201-warn; assert outcomes; flag-not-weaken). Conventional commit test(overmind): ...

## Root Cause / Mechanism

R12.10 acceptance coverage already had T12.1-T12.5 in `tests/acceptance/overmind-projects-api.acceptance.test.ts`, but the B12p acceptance slice for dashboard create persistence, project delete guard, and bare-bash warning had not been consolidated into the acceptance spec.

## Files Changed

- `tests/acceptance/overmind-projects-api.acceptance.test.ts`
  - Added `T12.6-T12.8 Overmind projects dashboard/delete/warn acceptance`.
  - T12.6 asserts the dashboard create API path returns `201`, list row appears, and DB/service row exists.
  - T12.7 asserts active-run project delete returns `409` and keeps the row, then completed-run delete returns `200` and removes it.
  - T12.8 asserts run registration with a bare-bash project parent succeeds with `201`, returns `parent_warning`, and persists `parent_status`.

## Caveats

- T12.6 is API-path + DB proof by design. B12j remains the browser/screenshot evidence for the modal wiring into that same API path.
- Production code was not changed.
- Autonomous decisions: none.
