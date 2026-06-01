# Batch B2 Scenarios

## Scope

R7.1, R7.2 endpoint side, and R12.8 project-join adaptation for the spark daemon active-runs registry.

## Scenarios

### S1 - Empty Registry

Given no project-backed active workflows exist
When `GET /api/overmind/runs/active` is called from loopback with the Overmind token
Then the response is `200` with `{"runs":[]}`.

### S2 - Project-Backed Active Workflow

Given an `overmind_workflows` row linked to `overmind_projects`
And its status is in the non-terminal active set
And `<run_dir>/dispatch/` contains `.json` files
When `GET /api/overmind/runs/active` is called from loopback with the Overmind token
Then the response includes one run with:
- `run_id` from the workflow id
- `run_dir` from the workflow
- `label` from workflow label, falling back to project slug
- `parent_label` from `overmind_projects.slug`
- `parent_session` from `overmind_projects.parent_session`
- `status` from the workflow
- `registered_at` from `overmind_workflows.created_at`
- `children` parsed by zipping `child_sessions` and `child_roles`
- `dispatch_manifests` as sorted absolute paths to `*.json` files under `<run_dir>/dispatch/`

### S3 - Terminal And Legacy Rows Excluded

Given completed or paused workflows
And a legacy active workflow with `project_id IS NULL`
When the active-runs endpoint is called
Then terminal workflows and null-project legacy workflows are not returned.

### S4 - Auth

Given a request without the Overmind token
When the active-runs endpoint is called
Then it returns `401`.

Given a request from a non-loopback remote address
When the active-runs endpoint is called with the token
Then it returns `403`.

