# Batch O1 Changes

## Scope
- branch or checkpoint: feat/overmind

## Files Changed
- src/api/routes/overmind-routes.ts
- tests/overmind-routes.test.ts

## What Changed
- Added localhost plus OVERMIND_TOKEN guarded operator controls:
  - POST /api/overmind/workflows/:id/pause
  - POST /api/overmind/workflows/:id/resume
  - DELETE /api/overmind/workflows/:id
- Reused the existing loopback/token guard path and added x-overmind-token header support for local curl deletes.
- Pause/resume delegate to overmindService.setStatus(id, "paused" | "active").
- Drop delegates to overmindService.delete(id) and preserves task history rows.
- Broadcasts updated overmind workflow snapshots when a control operation succeeds.

## Self-Verification
- command or method: npx vitest run tests/overmind-routes.test.ts
- result: PASS
- command or method: npx tsc
- result: PASS
- command or method: npm run build
- result: PASS

## Reproduction Notes
- before: OU1 routes did not exist in src/api/routes/overmind-routes.ts.
- after: route tests cover pause, resume, drop, missing/bad token 401, unknown workflow 404, and history survival after route-driven drop.

## Caveats
- Header token support uses x-overmind-token; body token remains supported for the shared lifecycle guard.
