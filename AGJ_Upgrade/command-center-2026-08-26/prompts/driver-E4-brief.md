# [driver] Slice E4 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
Web UI layer: port `WakeupSheet` plus expanded/collapsed pending indicator (manual date/time/action, pending time, clear on fire or cancel). After C5 to serialize agent-window `app.js` edits.

## Acceptance criteria (ACs)
D1,D2,D3

## Focused tests (the row's acceptance)
`npx playwright test e2e/command-center-wakeup.spec.ts --project=cc`

## Contract
- estimate: 30min · deps: A0,E3,C5 · impl_tier=L2 · val_tier=L3 · budget=4
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
