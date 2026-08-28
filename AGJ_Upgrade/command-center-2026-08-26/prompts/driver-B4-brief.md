# [driver] Slice B4 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
Bootstrap layer only: remove Overmind imports, construction, watcher startup, and server injection from `src/index.ts`; production bootstrap starts with no OVM wiring.

## Acceptance criteria (ACs)
A2,A5

## Focused tests (the row's acceptance)
`npx vitest run tests/overmind-removal-bootstrap.test.ts --minWorkers=1 --maxWorkers=4`

## Contract
- estimate: 25min · deps: A0,B2,B3 · impl_tier=L3 · val_tier=L3 · budget=4
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
