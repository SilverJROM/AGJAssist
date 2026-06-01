# Batch B12n Scenarios

## TS-B12N-01 — Probe live project endpoint read-only

**Given** the live AGJAssist server is running at `http://127.0.0.1:3101`
**When** `GET /api/overmind/projects` is requested without credentials
**Then** the server responds `401`, proving the route exists and is auth-gated rather than absent.

**And when** the same route is requested with the existing loopback overmind token
**Then** the server responds `200` with a `projects` array, proving the live server has the R12 project endpoints.

## TS-B12N-02 — Create or verify AGJ project on live server

**Given** the live server supports `/api/overmind/projects`
**When** project `AGJ` does not exist
**Then** create it through an owner JWT request with:

- `slug=AGJ`
- `app_path=/home/agjrom/TGBOTS/AGJAssist`
- `parent_session=AGJ-51`

**When** project `AGJ` already exists
**Then** verify those fields match exactly and do not create a duplicate.

## TS-B12N-03 — Disposable attach proof

**Given** the AGJ project exists
**When** a separate disposable run directory under `/home/agjrom/TGBOTS/AGJAssist/tmp/` is registered through `POST /api/overmind/register`
**Then** the response is `201` with `project_slug=AGJ`, `parent_session=AGJ-51`, and a `workflow_id`.

**And when** `GET /api/overmind/projects/AGJ` is requested during the proof
**Then** AGJ shows the disposable active run attached.

## TS-B12N-04 — Cleanup safety

**Given** the disposable workflow was created only for the proof
**When** cleanup runs
**Then** only that disposable workflow is deleted, the AGJ project remains, and workflow `4` is not re-registered or mutated.
