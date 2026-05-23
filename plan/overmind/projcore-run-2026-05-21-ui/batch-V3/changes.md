# Batch V3 Changes

## User Report Verbatim

APPROVED-PLAN for V3. Proceed exactly as proposed. Implement on feat/overmind, commit, gate (isActiveStatus test + npx tsc + npm run build). Artifacts batch-V3/changes.md + test-report.md + independent-validation.md. Append callback FIRST ([projcore callback] V3 DONE <note>), THEN STATUS: DONE -- reason. Tabs only - preserve V1 collapse + V2 attribution.

## Root Cause Mechanism

`OvermindWorkflows` rendered the complete workflow list directly, so the dashboard had no local tab state and no status-based partitioning. The public helper module had status formatting and color helpers, but no node-testable classifier for deciding whether a workflow belongs in the Active tab.

## Changes

- `src/web/public/overmind-helpers.js`: added `isActiveStatus(status)` for `active`, `working`, `waiting_human`, `awaiting_decision`, and `stuck`.
- `src/web/public/app.js`: added component-local tab state defaulting to `active`, derived Active and Done workflow arrays, rendered `Active (n)` and `Done (n)` dashboard-level tabs, and filtered the existing workflow card renderer through the selected tab.
- `src/web/public/app.js`: preserved the existing collapsed card toggle path and expanded active-session attribution display inside each filtered card.
- `src/web/public/style.css`: added compact Overmind tab styling consistent with the existing dashboard density.
- `tests/overmind-stream.test.ts`: added focused helper coverage for the Active status mapping and Done false cases.

## Autonomous Decisions

None.
