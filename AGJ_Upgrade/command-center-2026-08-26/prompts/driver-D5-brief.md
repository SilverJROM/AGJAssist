# [driver] Slice D5 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
Web UI layer: port `SummaryEndpointSettings` (add/edit/remove, radio default, seeded `140`, owner-only errors). After C5 to avoid a dual `app.js` merge.

## Acceptance criteria (ACs)
F1,F2,F3

## Focused tests (the row's acceptance)
`npx playwright test e2e/command-center-endpoints.spec.ts --project=cc`

## Contract
- estimate: 30min · deps: A0,D4,C5 · impl_tier=L2 · val_tier=L3 · budget=4
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
