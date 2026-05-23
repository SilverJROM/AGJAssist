# Batch V4a Changes

## User Report
Next batch V4 (IMPLEMENTER; /projcore supervises from AGJ-51). V4 = home Workflows card (RU5) + customizable bottom nav (RU6). APPROVED-PLAN for V4a AND V4b. Implement V4a first.

## Scope
- branch: feat/overmind
- requirement: RU5 home Workflows quick-view card

## Files Changed
- src/web/public/app.js
- src/web/public/overmind-helpers.js
- tests/overmind-stream.test.ts

## Root Cause Mechanism
- The home Workflows card existed, but it had no live workflow summary. The dashboard did not fetch `/api/overmind/workflows` while loading home stats, so it could not show the requested tiny quick-view status.

## What Changed
- Added a pure `summarizeWorkflows` helper for total and active workflow counts.
- Included `/api/overmind/workflows` in the web and Telegram home dashboard stat loads.
- Updated the Workflows card on both home surfaces to show total workflow count and an `N workflows · M active` summary while preserving navigation to `#/overmind`.

## Self-Verification
- `npx vitest run tests/overmind-stream.test.ts`: PASS
- `npx tsc -p tsconfig.json`: PASS
- `npm run build`: PASS

## Caveats
- No backend or schema changes. Workflow summary failures fall back to `0 workflows · 0 active`.
