# Batch V4b Changes

## User Report
APPROVED-PLAN for V4b. Implement customizable bottom nav with localStorage per-device persistence, move buttons instead of drag, delete/hide, add picker, and Workflows available-to-add but not forced into the default tab set.

## Scope
- branch: feat/overmind
- requirement: RU6 customizable bottom navigation

## Files Changed
- src/web/public/app.js
- src/web/public/overmind-helpers.js
- src/web/public/style.css
- tests/bottom-nav-helpers.test.ts

## Root Cause Mechanism
- The Telegram mini-app bottom nav was a hard-coded array inside `TgApp`. Because tab definitions, order, visibility, and rendering were coupled there, users could not reorder, hide, add, or persist tabs per device.

## What Changed
- Added node-testable bottom-nav helpers for available tabs, defaults, normalization, move, remove, add, serialization, and localStorage-compatible read/write.
- Changed `TgApp` to render the bottom nav from persisted tab ids.
- Added a bottom-nav edit panel reachable from the mini-app home screen and Settings.
- The editor supports move up/down buttons, remove buttons with a keep-at-least-one guard, an add picker for hidden tabs including Workflows, and reset to defaults.
- Kept Workflows out of the default tab set while making it available to add.

## Self-Verification
- `npx vitest run tests/bottom-nav-helpers.test.ts`: PASS
- `npx tsc -p tsconfig.json`: PASS
- `npm run build`: PASS

## Caveats
- Persistence is localStorage-only via `agj_bottom_nav_tabs_v1`; no backend or schema changes.
