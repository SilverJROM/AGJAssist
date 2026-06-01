# B12e Scenarios

Scope: R12.2 GET/PATCH/DELETE for `/api/overmind/projects` and R12.11 parent_session updates.

## Scenario 1: Read project list and detail with dual auth
Given overmind projects exist
And one project has `active` and `working` workflows plus a `completed` workflow
When a loopback caller sends `X-Overmind-Token`
Then `GET /api/overmind/projects` returns all projects with `active_runs_count`.

When a viewer JWT calls `GET /api/overmind/projects/:slug`
Then the project is returned with the same `active_runs_count`.

When the slug does not exist
Then the route returns 404.

## Scenario 2: Patch project metadata with owner JWT only
Given an overmind project exists
When an owner JWT patches `parent_session` and `notes`
Then the route returns the updated project.
And active workflows pick up the new `parent_session` on the next server-side project read.

When the body contains `slug` or `app_path`
Then the route returns 400 and leaves the stored row unchanged.

When loopback-token-only or viewer JWT callers patch the project
Then the route returns 403.

When the slug does not exist
Then the route returns 404.

## Scenario 3: Delete project with active-runs guard
Given an overmind project has a `working` workflow
When an owner JWT deletes the project
Then the route returns 409 with `active_runs`.
And the project row remains.

When the workflow is completed
And the owner JWT deletes the project again
Then the route returns 200 and removes the project row.

When loopback-token-only or viewer JWT callers delete the project
Then the route returns 403.
