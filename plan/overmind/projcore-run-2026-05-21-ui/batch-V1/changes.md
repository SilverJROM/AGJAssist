# Batch V1 Changes

## Scope
- branch: feat/overmind
- requirements: RU1, RU2 only

## Files Changed
- src/web/public/app.js
- src/web/public/overmind-helpers.js
- src/web/public/style.css
- tests/overmind-stream.test.ts

## What Changed
- Added exported `statusColor(status)` helper with stable `ovm-*` color class mapping.
- Made Overmind workflow cards collapsed by default with session-only per-card expand state.
- Collapsed card view shows workflow name, colored status badge/icon, and current task line only.
- Expanded card view reveals the existing pending decision, tier, stuck duration, coordinator, children, and tasklist details.
- Applied status color classes to the status badge/icon and card left accent.

## Self-Verification
- command: `npx vitest run tests/overmind-stream.test.ts`
- result: PASS, 7 tests
- command: `npx tsc`
- result: PASS
- command: `npm run build`
- result: PASS

## Reproduction Notes
- before: Overmind workflow cards rendered all details expanded by default and reused generic badge status colors.
- after: Overmind workflow cards default collapsed and reveal details only after tapping/clicking the header; status colors use RU2 mapping.

## Caveats
- `npm run build` completed and copied static web assets into `dist/`, but no tracked `dist` diff was produced in this checkout.
