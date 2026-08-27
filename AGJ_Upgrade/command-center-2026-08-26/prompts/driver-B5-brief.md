# [driver] Slice B5 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
Bot layer only: remove `/overmind`, `/om_tasks`, `/om_pause`, `/om_resume`, `/om_drop`, `/ovm_start`, `/ovm_end` from `AssistantCore` and `TelegramAssistant`; they follow the normal unknown-command path.

## Acceptance criteria (ACs)
A3

## Focused tests (the row's acceptance)
`npx vitest run tests/overmind-command-removal.test.ts --minWorkers=1 --maxWorkers=4`

## Contract
- estimate: 25min · deps: A0 · impl_tier=L2 · val_tier=L2 · budget=4
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
