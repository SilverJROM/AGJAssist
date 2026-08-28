# [driver] Slice D4 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
API layer: owner-only `registerSummaryRoutes` for endpoint CRUD/default and per-agent summary reads (newest first); validate OpenAI-compatible base URLs; secrets stay out of responses and logs.

## Acceptance criteria (ACs)
E2,F1,F2,F3

## Focused tests (the row's acceptance)
`node scripts/cc-run-isolated.mjs --slice D4 -- npx vitest run tests/summary-routes.test.ts --minWorkers=1 --maxWorkers=4`

## Contract
- estimate: 30min · deps: A0,D2,D3 · impl_tier=L2 · val_tier=L3 · budget=4
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
