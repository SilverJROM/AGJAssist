# [driver] Slice C3 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
Services layer, ONE claim=`fireDue`: resolve current group panes, skip excluded agents, pass every solicit through existing `SafetyService`+`TmuxService`, write `AuditService`, advance/deactivate repeats with the Mini App closed.

## Acceptance criteria (ACs)
C5

## Focused tests (the row's acceptance)
`node scripts/cc-run-isolated.mjs --slice C3 -- npx vitest run tests/unit/agent-reminder-scheduler.spec.ts --minWorkers=1 --maxWorkers=4`

## Contract
- estimate: 35min · deps: A0,C2 · impl_tier=L3 · val_tier=L3 · budget=5
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
