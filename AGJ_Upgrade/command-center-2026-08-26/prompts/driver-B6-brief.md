# [driver] Slice B6 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
API layer: remove `registerGuardianRoutes` and `POST /api/guardian/escalate`; stop importing `isLoopbackAddress` / `buildGuardianEscalationNotification` (delete them here if unused, else leave a local copy for non-OVM loopback routes). Regression fixture: calendar-reminder Telegram paging still sends. Precedes B2/B3.

## Acceptance criteria (ACs)
B1,B2

## Focused tests (the row's acceptance)
`npx vitest run tests/guardian-removal.test.ts --minWorkers=1 --maxWorkers=4`

## Contract
- estimate: 25min · deps: A0 · impl_tier=L2 · val_tier=L3 · budget=4
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
