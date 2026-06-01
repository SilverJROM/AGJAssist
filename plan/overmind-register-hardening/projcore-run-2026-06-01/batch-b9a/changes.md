# Batch B9a Changes

## Branch: `feat/ovm-register-hardening`

Cut from existing branch state during projcore run `overmind-register-hardening/projcore-run-2026-06-01`.

## User Report

"Today a healthy projcore run (wf=11, project-attached, coordinator_session=AGJ-51 alive) got false "you appear idle / unregistered child" nudges, AND its codex child failed to register (child-add 404)."

## Root Cause

Bug 1: `OvermindService.findWorkflow()` accepted `run_dir` as a lifecycle identity key but only queried `overmind_workflows.run_dir = ?` by exact string. Attach registration canonicalizes run_dir through `findProjectForRunDir()`, so a later `/api/overmind/children` call that supplied an equivalent symlink/resolved path without `workflow_id` could miss and return 404.

Bug 2: watcher reconcile used workflow objects captured before `tickWorkflow()` updated/cleared `info_request`, so a gap that had just become healthy could still emit a stale "registration gap" nudge. The idle/no-child wording also pointed agents at the legacy `/register` child roster shape instead of the project child endpoint.

## Code Changes

- `src/services/overmind-service.ts` - Made `findWorkflow()` async and added canonical run_dir fallback after exact run_dir lookup and before session fallback.
- `src/api/routes/overmind-routes.ts` - Awaited async `findWorkflow()` in `/complete`, `/tasks`, and `/children`.
- `src/services/overmind-watcher.ts` - Refreshed active workflows before reconcile, reloaded each workflow inside `reconcile()`, and updated child roster guidance to `overmind.sh child-add/child-rm` or `POST /api/overmind/children`.
- `src/services/overmind/nudge-ladder.ts` - Replaced legacy no-child idle guidance with project-model child-add guidance.
- `src/services/overmind/completeness.ts` - Replaced child roster gap guidance with `/children`/`child-add` wording.
- `tests/overmind-service.test.ts` - Added canonical run_dir lookup coverage for exact-miss/canonical-hit.
- `tests/overmind-routes.test.ts` - Added attach workflow `/children` coverage addressed by canonicalized run_dir without workflow_id.
- `tests/overmind-reconcile.test.ts` - Added stale-gap suppression coverage for a healthy attached run with registered children.
- `tests/overmind-completeness.test.ts` - Updated child roster guidance assertion to the project-model endpoint.

## Commits

- This commit: fix(overmind): child-add for attach runs + stop false nags on healthy attached runs (B9a, R14.2/R11)

## Verification

- Type-check: PASS (`npx tsc --noEmit`)
- Tests: PASS (`npx vitest run tests/overmind-service.test.ts tests/overmind-routes.test.ts tests/overmind-reconcile.test.ts tests/overmind-completeness.test.ts tests/overmind-nudge.test.ts`)

## Bug Reproductions

- child-add 404 mechanism reproduced in tests by registering through a symlinked attach run_dir, then posting `/api/overmind/children` with the symlink path and no workflow_id. Before the fix, exact run_dir lookup would miss the stored canonical path; after the fix, canonical fallback resolves the workflow and persists children.
- false stale registration-gap mechanism reproduced in tests by passing reconcile a stale workflow with `info_request` while the service returns the current healthy attached workflow with registered child sessions. After the fix, reconcile reloads the workflow and sends no nudge.

## Caveats

- PRE-EXISTING: Coordinator-dead and missing-run-dir completeness text still says re-register because those are parent/run identity corrections, not child roster updates.
