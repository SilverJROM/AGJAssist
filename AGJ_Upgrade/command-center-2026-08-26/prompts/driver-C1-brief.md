# [driver] Slice C1 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
Schema layer: additive `agent_solicit_reminders` plus recipient rows in `SCHEMA_SQL` and `DatabaseService` migrations (folder-group, cadence, repeat limit, include/skip, next-fire, fresh-vs-upgrade). Do not alter calendar `reminders`.

## Acceptance criteria (ACs)
C1,C2,C3,C4,C6

## Focused tests (the row's acceptance)
`node scripts/cc-run-isolated.mjs --slice C1 -- npx vitest run tests/unit/agent-reminder-schema.spec.ts --minWorkers=1 --maxWorkers=4`

## Contract
- estimate: 30min · deps: B8 · impl_tier=L3 · val_tier=L3 · budget=4
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
