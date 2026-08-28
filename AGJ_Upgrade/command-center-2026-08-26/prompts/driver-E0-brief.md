# [driver] Slice E0 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
HARNESS-CORRECTNESS ONLY. Rewrite e2e/command-center-wakeup-fence.spec.ts against real E3 owner-only GET /api/agent-wakeups/pending and E2 fire-once into a temp pane. Do not invent GET /api/agent-wakeups 200 or POST /api/agent-wakeups/fire. Use FENCE_ORIGIN and OWNER_TOKEN. Collect ALL of D1,D2,D3 (do not abort after the first fail). FENCE_STUB=E2 named-red on D3 kind=assert. Write fence-report-v1.json in finally. Do not add product routes.

## Acceptance criteria (ACs)
HARNESS-SMOKE

## Focused tests (the row's acceptance)
`FENCE_ID=E5 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate`

## Contract
- estimate: 25min · deps: A0,E1,E2,E3,E4 · impl_tier=L3 · val_tier=L3 · budget=6
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
