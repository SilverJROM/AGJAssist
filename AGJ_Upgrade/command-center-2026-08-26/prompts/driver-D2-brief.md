# [driver] Slice D2 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
Services layer: `SummaryEndpointService` owner-scoped add/edit/remove/default; seed OpenAI-compatible endpoint labelled `140`; never log secrets.

## Acceptance criteria (ACs)
F1,F2,F3

## Focused tests (the row's acceptance)
`node scripts/cc-run-isolated.mjs --slice D2 -- npx vitest run tests/unit/summary-endpoint-service.spec.ts --minWorkers=1 --maxWorkers=4`

## Contract
- estimate: 30min · deps: A0,D1 · impl_tier=L2 · val_tier=L3 · budget=4
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
