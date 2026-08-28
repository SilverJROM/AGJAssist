# [driver] Slice D6 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
Web UI layer: port `AgentSummariesDropdown` (per-agent newest-first cards, endpoint tags, scroll, empty state). After D5 as the other new agent-window sheet.

## Acceptance criteria (ACs)
E2,E3

## Focused tests (the row's acceptance)
`npx playwright test e2e/command-center-summaries.spec.ts --project=cc`

## Contract
- estimate: 25min · deps: A0,D4,D5 · impl_tier=L1 · val_tier=L2 · budget=4
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
