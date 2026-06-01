# Independent Validation — Batch B12n

## Verdict

PASS.

B12n satisfies the safe T12.10 equivalent: the real AGJ project exists on the live overmind server and a separate disposable run attached under that project with a `201` register response and visible AGJ active-run count. Cleanup removed only the throwaway workflow, leaving the AGJ project in place.

## Acceptance Mapping

| Acceptance | Status | Evidence |
|---|---|---|
| AGJ project created or verified | PASS | Live project `id=4`, `slug=AGJ`, `app_path=/home/agjrom/TGBOTS/AGJAssist`, `parent_session=AGJ-51` |
| Run under AGJAssist registers and attaches | PASS | Disposable workflow `13` registered with `project_slug=AGJ`, `parent_session=AGJ-51`, HTTP `201` |
| GET shows run under AGJ project | PASS | During proof, `GET /api/overmind/projects/AGJ` showed `active_runs_count=1` |
| Decision log documents live path and wf=4 deferral | PASS | `batch-b12n/decisions/2026-06-01-live-agj-disposable-proof.md` |
| No `wf=4` disruption | PASS | Post-cleanup read-only DB check: `wf=4` remains `status=working`, `project_id=NULL`, live run_dir unchanged |
| Cleanup leaves AGJ project and removes throwaway | PASS | Workflow `13` deleted; AGJ remains with `active_runs_count=0` |

## Gate Notes

- No production diff to review.
- No build required for an ops-only proof.
- No live server restart occurred.
- Owner credential material is not present in artifacts.
