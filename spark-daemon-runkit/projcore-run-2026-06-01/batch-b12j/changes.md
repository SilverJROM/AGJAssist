# Batch B12j Changes

## User Report Verbatim
You are the IMPLEMENTER (codex). /projcore from AGJ-51. New batch — read+execute in full: /home/agjrom/TGBOTS/AGJAssist/spark-daemon-runkit/projcore-run-2026-06-01/prompts/batch-b12j.md (dashboard Overmind-Projects page PART-A: new bottom-nav tab + list + create modal, Preact+htm in app.js, owner-JWT create, DISTINCT from code-browser /api/projects). Follow existing dashboard conventions. Handshake: STATUS: PROPOSED then WAIT. Callback FIRST. DISPATCH-MARKER: AGJ-B12J

APPROVED-PLAN for B12j. Real plan, well-scoped (list+create only, distinct tab, owner-JWT via api(), running-app+DB proof for T12.6). One note: for error states, prefer surfacing the server's actual {error} message from the response body (you already do for 400) rather than hardcoded strings — keeps 409/403 accurate without an api() rewrite. Proceed; capture screenshots of the new tab + created row under batch-b12j/screenshots/ if feasible. Callback FIRST on DONE.

## Root Cause Mechanism
The Overmind project CRUD endpoints existed from B12d/B12e, but the dashboard had no dedicated route for the separate `overmind_projects` namespace. The existing `/projects` page is the on-disk code-browser project feature backed by `/api/projects`, so exposing Overmind project creation there would mix two different data models and violate the JROM-managed namespace contract.

## Per-File WHY
- `src/web/public/overmind-helpers.js`: registered a distinct `/overmind-projects` bottom-nav entry labeled `OVM Projects` and included it in default bottom nav IDs so the new tab appears on fresh/default nav state.
- `src/web/public/app.js`: added the `OvermindProjects` Preact+htm component, desktop header link, TG/deep-link known-route handling, and route wiring for both app shells. The component uses existing `api()` bearer auth, loads `GET /api/overmind/projects`, renders the required fields, and submits owner-JWT creates via `POST /api/overmind/projects`.
- `src/web/public/style.css`: added small scoped card/grid styles for Overmind project rows and mobile wrapping, reusing existing dashboard variables and card/modal conventions.
- `spark-daemon-runkit/projcore-run-2026-06-01/batch-b12j/*`: added scenarios, review, test report, screenshots, and validation artifacts for this batch.

## Error Handling
The create modal displays `e.message` from the existing `api()` helper. That helper already reads `{ error }` from non-2xx responses, so `409`, `400`, and `403` surface the server's own messages without a broad helper rewrite.

## Autonomous Decisions
None.
