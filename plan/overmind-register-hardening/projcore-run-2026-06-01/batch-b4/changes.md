# Batch B4 Changes

## Branch: `feat/ovm-register-hardening`

Cut from `feat/ovm-register-hardening` @ `5426a11`.

## User Report (verbatim from brief)

"Batch-B4: OVM Projects UI — collapse-by-default + expand + 3-dots edit/delete menu"

## Root Cause (mechanism-level)

Feature: the OVM Projects web view needed project cards to render collapsed by default, expand per row, and move existing edit/delete actions into a three-dot row menu while preserving the existing owner-JWT mutation routes.

## Code Changes

- `src/web/public/app.js` — Added `expandedProjectSlugs` and `openProjectMenuSlug` state in `OvermindProjects` so each project row independently toggles details and opens a row-scoped actions menu.
- `src/web/public/app.js` — Replaced always-expanded project card details with a compact summary row, preserving existing create/list/refresh, edit modal PATCH, and delete confirmation/DELETE handlers.
- `src/web/public/style.css` — Added scoped OVM Projects row, chevron, summary text, actions menu, and expanded-details styles using the existing card/context-menu visual language.

## Commits

- Created in final batch commit: `feat(overmind): OVM Projects collapse/expand + 3-dots edit/delete menu (B4, R4)`

## Standing Rules (if discovered)

- None.

## Verification

- Build: PASS (`npm run build`)
- Type-check: PASS (`npm run build`, via `tsc -p tsconfig.json`)
- DEV deploy: PASS (`pm2 restart agjassist`; live at `http://localhost:3101`)
- Smoke verify:
  - Web UI: Login: temporary owner JWT session for local Playwright context / Opened: `http://localhost:3101/#/overmind-projects` / Observed: 5 project rows, 0 details panels initially, first row expands to exactly 1 details panel, three-dot menu stays open with Edit and Delete while other rows remain collapsed.
- Screenshot: `plan/overmind-register-hardening/projcore-run-2026-06-01/batch-b4/screenshots/ovm-projects-collapsed-expanded-menu.png`

## Bug Reproductions (if bug fixes)

- N/A — feature batch.

## Caveats

- None.
