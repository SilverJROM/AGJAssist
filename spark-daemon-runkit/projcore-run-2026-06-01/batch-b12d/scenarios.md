# Batch B12d Scenarios

Scope: R12.2 POST only and R12.3 owner-JWT-only project mutations.

## S1 - Owner creates project
Given a valid owner JWT
When `POST /api/overmind/projects` receives non-empty `slug`, absolute existing `app_path`, `parent_session`, and optional `notes`
Then it returns `201` with the created project JSON
And `created_by` is `JROM` even if the caller sends another value.

## S2 - Duplicate protection
Given an existing `overmind_projects` row
When another create request reuses the same `slug` or the same `app_path`
Then it returns `409`.

## S3 - Owner JWT is the only accepted mutation auth
Given a loopback caller with the normal overmind token but no owner JWT
When it calls `POST /api/overmind/projects`
Then it returns `403 {"error":"projects are JROM-managed; ask JROM to create via dashboard"}`.

Given a valid viewer JWT
When it calls `POST /api/overmind/projects`
Then it returns the same `403` response.

Given no credentials
When it calls `POST /api/overmind/projects`
Then it returns `401`.

## S4 - Path validation
Given an owner JWT
When `app_path` is relative or does not exist on disk
Then it returns `400`.

## S5 - Service helpers
Given project rows and linked workflow rows
When the service reads by slug, reads by app_path, lists projects, or counts active runs
Then the service returns the stored project data and counts only non-terminal runs.
