# [driver] Slice F6 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
CSS layer: port locked `agent-window-v2` theme/responsive tokens in `style.css` (system/light/dark, 390px spacing, centered capped column on tablet/desktop) without regressing existing controls.

## Acceptance criteria (ACs)
H3,J1,J2

## Focused tests (the row's acceptance)
`npx playwright test e2e/command-center-responsive.spec.ts --project=cc`

## Contract
- estimate: 35min · deps: A0,F4,F5 · impl_tier=L2 · val_tier=L3 · budget=4
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
