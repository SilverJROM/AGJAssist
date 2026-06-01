# B12q Scenarios

## Scope

R12.10 T12.9-T12.10 final INJECT-002 acceptance coverage.

## Scenarios

1. T12.9 migration proposer dry-run:
   - Given a temp SQLite DB with completed workflows under fake project trees, same-app duplicates, non-completed workflows, and a completed missing run_dir.
   - When `analyzeCompletedWorkflows` and `formatDryRunOutput` run.
   - Then completed workflows produce `/api/overmind/projects` curl proposals, same-app rows group by canonical app_path, non-completed statuses are ignored, missing run_dir is review-needed, and no network function is called.

2. T12.10 deterministic AGJ attach re-proof:
   - Given a temp DB app.inject server and an owner JWT.
   - When AGJ is created with `app_path=/home/agjrom/TGBOTS/AGJAssist` and a disposable ignored run_dir under that app path registers by run_dir only.
   - Then registration returns 201 with `project_slug=AGJ`, `parent_session=AGJ-51`, a workflow_id, DB state attached to AGJ, and GET `/api/overmind/projects/AGJ` shows one active run.

## Safety

Live `:3101`, workflow `wf=4`, and `data/agjassist.db` are out of scope and were not touched.
