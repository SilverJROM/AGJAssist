# [driver] Slice F2 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
Web UI layer: wire per-pane drafts into `FriendlyTerminalView` and the agent switcher (restore on switch, draft-kept + switcher indicators, clear only the sent pane). After B8 so OVM chrome is gone.

## Acceptance criteria (ACs)
G1,G2,G3

## Focused tests (the row's acceptance)
`npx playwright test e2e/command-center-drafts.spec.ts --project=cc`

## Contract
- estimate: 30min · deps: A0,F1,B8 · impl_tier=L2 · val_tier=L3 · budget=4
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
