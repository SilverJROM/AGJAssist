# [driver] Slice E3 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
API layer: owner-only `registerAgentWakeupRoutes` for schedule, pending read, and cancel; non-owner, invalid/past times, empty actions, and cross-pane access fail-closed.

## Acceptance criteria (ACs)
D1,D2

## Focused tests (the row's acceptance)
`node scripts/cc-run-isolated.mjs --slice E3 -- npx vitest run tests/agent-wakeup-routes.test.ts --minWorkers=1 --maxWorkers=4`

## Contract
- estimate: 25min · deps: A0,E2 · impl_tier=L2 · val_tier=L3 · budget=4
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
