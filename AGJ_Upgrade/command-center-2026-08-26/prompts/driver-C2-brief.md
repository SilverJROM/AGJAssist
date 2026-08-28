# [driver] Slice C2 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
Services layer: `AgentSolicitService` CRUD and due-state for preset/custom cadence, stop-after-N or unlimited, immediate include/skip, persisted active-reminder projections.

## Acceptance criteria (ACs)
C2,C3,C4,C6

## Focused tests (the row's acceptance)
`node scripts/cc-run-isolated.mjs --slice C2 -- npx vitest run tests/unit/agent-reminder-service.spec.ts --minWorkers=1 --maxWorkers=4`

## Contract
- estimate: 30min · deps: A0,C1 · impl_tier=L2 · val_tier=L2 · budget=4
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
