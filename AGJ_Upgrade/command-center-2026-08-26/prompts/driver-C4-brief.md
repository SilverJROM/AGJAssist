# [driver] Slice C4 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
API layer: owner-only `registerAgentReminderRoutes` for create/update/cancel, include/skip, and active-reminder reads; non-owner and malformed cadence/repeat fail-closed.

## Acceptance criteria (ACs)
C1,C4,C6

## Focused tests (the row's acceptance)
`node scripts/cc-run-isolated.mjs --slice C4 -- npx vitest run tests/agent-reminder-routes.test.ts --minWorkers=1 --maxWorkers=4`

## Contract
- estimate: 30min · deps: A0,C2 · impl_tier=L2 · val_tier=L3 · budget=4
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
