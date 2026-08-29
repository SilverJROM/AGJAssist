# [driver] Slice E0b — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
HARNESS-CORRECTNESS ONLY. E0's spec (a5a6923) still shares LITERAL_ACTION_D1/D2/D3 tokens across E1/E3/E4 (D1: test_e1 schema + test_e3 route; D2: test_e3 route + test_e4 UI), so a per-contributor FENCE_STUB cannot attribute a break to one contributor and the fence re-parks on the identical fp1:4c534f69 fingerprint 5+ cycles running (PLAN_SOUND a11 never actually implemented). Give EACH of E1,E2,E3,E4 its OWN distinct FENCE_STUB target and its OWN distinct LITERAL_ACTION token (LITERAL_ACTION_E1 through LITERAL_ACTION_E4) so each is independently named-red; keep the composed positive journey unchanged. Update fence-contract.json E5 acceptance_ids from D1/D2/D3 to the four distinct ids and its negative_control_cmd accordingly. Do not touch E1-E4 product code (all four are DONE and correct). Write fence-report-v1.json in finally. Split from E5.

## Acceptance criteria (ACs)
HARNESS-SMOKE

## Focused tests (the row's acceptance)
`FENCE_ID=E5 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs`

## Contract
- estimate: 30min · deps: A0,E1,E2,E3,E4,E0 · impl_tier=L3 · val_tier=L3 · budget=6
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
