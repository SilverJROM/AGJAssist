# [driver] Slice D0 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
HARNESS-CORRECTNESS ONLY. Rewrite e2e/command-center-summaries-fence.spec.ts against the real D4 owner-gated contract plus the closed-C6 solicit-reply arrival fixture. Do not invent unauth GET /api/summary-endpoints 200, GET /api/agent-summaries, or GET /api/summary-endpoints/default. Use FENCE_ORIGIN and OWNER_TOKEN. Collect ALL of E1,E2,E3,F1,F2,F3. FENCE_STUB=D3 named-red on E1 kind=assert. Write fence-report-v1.json in finally. Do not add product routes. North 2026-08-28 PLAN_SOUND: carry validation/D0-fix-a3.md.

## Acceptance criteria (ACs)
HARNESS-SMOKE

## Focused tests (the row's acceptance)
`FENCE_ID=D7 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate`

## Contract
- estimate: 25min · deps: A0,C6,D1,D2,D3,D4,D5,D6 · impl_tier=L3 · val_tier=L3 · budget=8
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
