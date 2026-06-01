# B12f Test Report

## Commands
- `npx vitest run tests/overmind-routes.test.ts tests/overmind-service.test.ts`
- `npm run build`

## Results
- PASS: `tests/overmind-routes.test.ts` and `tests/overmind-service.test.ts` — 86 tests passed.
- PASS: TypeScript build completed successfully.

## Coverage Notes
- Existing register tests stayed green.
- New B12f tests cover attach success, nested walk-up, same-run idempotent upsert, 404 no-project body including `searched_up_to`, 422 forbidden derived field, and legacy register continuity.

