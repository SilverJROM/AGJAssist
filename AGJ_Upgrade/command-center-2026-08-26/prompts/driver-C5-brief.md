# [driver] Slice C5 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
Web UI layer: port `AgentReminderSheet` + `ActiveRemindersView` (current terminal group, presets/custom cadence, stop-N/unlimited, include/skip). Reload-stable persist is C6, not this row.

## Acceptance criteria (ACs)
C1,C2,C3,C4

## Focused tests (the row's acceptance)
`npx playwright test e2e/command-center-reminders.spec.ts --project=cc`

## Contract
- estimate: 35min · deps: A0,C4 · impl_tier=L2 · val_tier=L3 · budget=4
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
