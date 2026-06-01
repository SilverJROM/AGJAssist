# Batch B12d Changes

## User Report
You are the IMPLEMENTER (codex). /projcore from AGJ-51. New batch - read+execute in full: /home/agjrom/TGBOTS/AGJAssist/spark-daemon-runkit/projcore-run-2026-06-01/prompts/batch-b12d.md (overmind_projects service + POST /api/overmind/projects, OWNER-JWT-ONLY mutations). Handshake: STATUS: PROPOSED then WAIT for APPROVED-PLAN. Callback FIRST on state change. DISPATCH-MARKER: AGJ-B12D

APPROVED-PLAN for B12d. Auth gate is exactly right. Two reinforcements: (1) a VALID but NON-owner JWT (role=viewer) must ALSO return 403 - the 403 path covers any non-owner caller including loopback+token-only; only role==='owner' proceeds. (2) Do NOT wire requireLoopbackAndToken as an accepted auth path for POST /api/overmind/projects (that's the exact hole we're closing) - owner-JWT is the ONLY accept. Proceed. Callback FIRST on DONE.

## Root Cause Mechanism
`overmind_projects` existed from B12a, but there was no service API or creation route. R12.3 also corrected the original dual-auth idea: loopback plus `X-Overmind-Token` is not a JROM-only boundary because projcore already has that token. The create mutation needed a route-local gate where only a verified dashboard JWT with `role === "owner"` can proceed.

## Changes
- `src/services/overmind/types.ts`: added `OvermindProject` and `CreateOvermindProjectInput`.
- `src/services/overmind-service.ts`: added create, get-by-slug, get-by-app-path, list, and active-runs-count helpers for `overmind_projects`. `createProject` forces `created_by = 'JROM'`.
- `src/api/routes/overmind-routes.ts`: added only `POST /api/overmind/projects`; no B12e read/update/delete routes. The route rejects loopback-token-only and viewer JWT callers with the documented 403 body.
- `tests/overmind-routes.test.ts`: added route coverage for owner create, duplicate slug/app_path, loopback-token-only 403, viewer JWT 403, missing auth, invalid paths, and forced `created_by`.
- `tests/overmind-service.test.ts`: added service helper coverage.

## Caveats
- No autonomous decisions.
- No screenshots; this batch is API/service only.
