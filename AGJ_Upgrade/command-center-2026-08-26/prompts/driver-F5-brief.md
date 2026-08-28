# [driver] Slice F5 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
Web UI layer: `AgentGroupSwitcher` — below 900px status/draft dropdown with no drag; at 900px+ horizontal strip plus working pointer scrubber; both paths call the same switch action.

## Acceptance criteria (ACs)
J1,J2

## Focused tests (the row's acceptance)
`npx playwright test e2e/command-center-switcher.spec.ts --project=cc`

## Contract
- estimate: 30min · deps: A0,F2,F4 · impl_tier=L2 · val_tier=L3 · budget=4
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
