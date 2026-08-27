# [driver] Slice B1 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
Web UI layer only: remove Workflows, Overmind Projects, and OVM Console (`OvmConsole` at `/conversations`) screens, header links, and bottom-nav entries; unknown `#/overmind*` hashes redirect home. Extract surviving bottom-nav/landing helpers out of `overmind-helpers.js` before dropping the OVM import. Do not delete FriendlyTerminalView or the file wholesale (G1 deletes leftovers).

## Acceptance criteria (ACs)
A1

## Focused tests (the row's acceptance)
`npx playwright test e2e/command-center-ovm.spec.ts --project=cc --grep B1`

## Contract
- estimate: 25min · deps: A0 · impl_tier=L2 · val_tier=L2 · budget=4
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
