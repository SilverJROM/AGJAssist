# [driver] Slice E2 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
Services layer, ONE claim=fire-once: `AgentWakeupService` create/cancel/fire; due fires pass the action through existing `SafetyService`+`TmuxService`, write `AuditService`, atomically clear pending.

## Acceptance criteria (ACs)
D1,D2,D3

## Focused tests (the row's acceptance)
`node scripts/cc-run-isolated.mjs --slice E2 -- npx vitest run tests/unit/agent-wakeup-service.spec.ts --minWorkers=1 --maxWorkers=4`

## Contract
- estimate: 35min · deps: A0,E1 · impl_tier=L3 · val_tier=L3 · budget=5
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
