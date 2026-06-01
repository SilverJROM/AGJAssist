# Batch B12j Scenarios

Scope: R12.6a / T12.6 dashboard Overmind Projects list + create only.

## TS-B12J-001 Distinct Navigation
Given the dashboard is open
When the navigation renders
Then an `OVM Projects` route/tab exists at `/overmind-projects`
And it is distinct from the existing code-browser `Projects` route at `/projects`.

## TS-B12J-002 List Projects
Given `GET /api/overmind/projects` returns Overmind project rows
When the `/overmind-projects` page loads
Then it renders each project's `slug`, `app_path`, `parent_session`, `active_runs_count`, and `updated_at`.

## TS-B12J-003 Create Project
Given an owner JWT is stored in the dashboard session
When JROM opens `+ New Project`, fills `slug`, `app_path`, `parent_session`, optional `notes`, and submits
Then the page sends `POST /api/overmind/projects`
And on `201` the modal closes, the list refreshes, the new row appears, and the DB row exists.

## TS-B12J-004 Create Errors
Given the create modal is open
When the server returns `409`, `400`, or `403`
Then the modal shows the server response body's `error` message to the user.
