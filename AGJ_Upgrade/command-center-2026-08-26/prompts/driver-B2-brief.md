# [driver] Slice B2 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
API layer only: remove `registerOvermindRoutes`, `OvermindStreamManager`, and Overmind fields from `ApiServices`; `/api/overmind/*` and its WebSocket no longer register. Runs after B6 so guardian no longer imports `overmind-routes`.

## Acceptance criteria (ACs)
A2

## Focused tests (the row's acceptance)
`npx vitest run tests/overmind-removal-api.test.ts --minWorkers=1 --maxWorkers=4`

## Contract
- estimate: 25min · deps: A0,B6 · impl_tier=L3 · val_tier=L3 · budget=4
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
