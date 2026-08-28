# [driver] Slice F1 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
`terminal-chat-state.js` only: `readTerminalDraft` / `writeTerminalDraft` / `clearTerminalDraft`, keyed by viewer and pane, localStorage isolation, reload persistence. Does not wait on wakeups.

## Acceptance criteria (ACs)
G1,G2,G3

## Focused tests (the row's acceptance)
`npx vitest run tests/unit/terminal-draft-jsdom.spec.ts --minWorkers=1 --maxWorkers=4`

## Contract
- estimate: 20min · deps: A0,F0 · impl_tier=L1 · val_tier=L2 · budget=3
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
