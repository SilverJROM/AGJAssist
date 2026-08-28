# [driver] Slice F3 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
Web UI layer: always-reachable refresh control on `FriendlyTerminalView`; re-pull pane output and session metadata together; in-progress then completion; composer stays interactive. Project `cc` supplies live API/tmux. North 2026-08-27 PLAN_SOUND: I1/I2 satisfiable; after L1 resume at L4 (sol) with budget 6 so >=2 strong informed attempts on the a4 remainder.

## Acceptance criteria (ACs)
I1,I2

## Focused tests (the row's acceptance)
`npx playwright test e2e/command-center-refresh.spec.ts --project=cc`

## Contract
- estimate: 30min · deps: A0,F2 · impl_tier=L4 · val_tier=L4 · budget=6
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
