# Batch B12n Changes

## User Report

APPROVED-PLAN for B12n. STEP-0 done read-only, live path confirmed, and the safety design is exactly right: real AGJ project (verify-match if exists, no dup) + a SEPARATE disposable run for the T12.10 attach proof, never wf=4 / never the live run_dir / no :3101 restart, cleanup leaves the AGJ project + removes only the throwaway. Two notes: (1) keep the owner JWT in a shell var only, short TTL, never write it to a file or artifact. (2) In decisions/, explicitly document that literally re-registering wf=4 is DEFERRED-by-design (re-registering a live-monitored run risks duplicate/orphan) — the disposable-run attach is the safe T12.10 equivalent, and the real wf=4 attach happens naturally on its next clean registration post-deploy. Proceed. Callback FIRST on DONE.

## Root Cause / Mechanism

B12n is an operations proof, not a code fix. R12 had added live project endpoints and attach-by-run-dir registration. The remaining T12.10 risk was proving the real AGJ app path can be represented as an overmind project and that a run under the AGJ repo attaches to it, without disrupting the active supervisor workflow `wf=4`.

The safe mechanism is:

- Probe `:3101` first.
- If the live server supports R12 endpoints, use it.
- Create or verify the real `AGJ` project.
- Register a separate disposable run under `tmp/`.
- Verify the disposable workflow attached to AGJ.
- Delete only the disposable workflow.

## Evidence Summary

- Live unauthenticated probe: `GET /api/overmind/projects` returned `401`, proving the route exists and is auth-gated.
- Live loopback-token probe: `GET /api/overmind/projects` returned `200`.
- AGJ project action: `created`.
- AGJ project row after proof: `id=4`, `slug=AGJ`, `app_path=/home/agjrom/TGBOTS/AGJAssist`, `parent_session=AGJ-51`, `created_by=JROM`.
- Disposable registration: `POST /api/overmind/register` returned `201`.
- Disposable workflow: `workflow_id=13`, `project_slug=AGJ`, `parent_session=AGJ-51`, `parent_status=ok`, `run_dir=/home/agjrom/TGBOTS/AGJAssist/tmp/b12n-20260601T112845Z`.
- During proof, `GET /api/overmind/projects/AGJ` showed `active_runs_count=1`.
- Cleanup deleted only workflow `13` with HTTP `200`.
- After cleanup, `GET /api/overmind/projects/AGJ` showed `active_runs_count=0`.
- Read-only DB check after cleanup: workflow `13` absent; workflow `4` still exists with `project_id=NULL`, `run_dir=/home/agjrom/TGBOTS/AGJAssist/spark-daemon-runkit/projcore-run-2026-06-01`, `status=working`.

## Per-file WHY

- `batch-b12n/scenarios.md` — documents the T12.10 proof contract and cleanup safety.
- `batch-b12n/changes.md` — records the user report, mechanism, and sanitized evidence.
- `batch-b12n/test-report.md` — records exact checks and results.
- `batch-b12n/review.md` — records implementation/scope review for this ops-only batch.
- `batch-b12n/independent-validation.md` — records the independent acceptance view for R12.9b/T12.10.
- `batch-b12n/decisions/2026-06-01-live-agj-disposable-proof.md` — documents why `wf=4` literal re-register is deferred by design.

## Safety Notes

- Owner JWT was kept only in a shell variable for the live proof.
- Owner JWT was never written to an artifact or file.
- The temporary owner session was deleted after use.
- `:3101` was not restarted.
- `data/agjassist.db` live workflows were not bulk-edited.
- `wf=4` was not re-registered or attached.
- The disposable workflow was removed; the AGJ project was intentionally left in place.

Autonomous decisions: none beyond the approved plan.
