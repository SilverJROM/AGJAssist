# [driver] Slice F4 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
Web UI layer: port mockup collapse chrome only (`TerminalHeaderV2` independent tabs/util/control collapse, default tabs-collapsed + utilities-expanded, single-row bell when fully collapsed). Chip content lands in C5/D6/E4.

## Acceptance criteria (ACs)
H1,H2

## Focused tests (the row's acceptance)
`npx playwright test e2e/command-center-header.spec.ts --project=cc`

## Contract
- estimate: 35min · deps: A0,C5,D6,E4,F3 · impl_tier=L2 · val_tier=L3 · budget=4
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
