# [driver] Slice F0c — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
HARNESS-CORRECTNESS ONLY. After F0b, add one named-red per G1-J2 via FENCE_STUB=<AC> that perturbs the public path (not FENCE_STUB_G* or throw-in-check). Remap fence-contract.json F7 expected_negative_fail_ids / negative_control_cmd to a server-backed contributor (I1 pane-output refresh, not F1 client-only). Collect ALL G1-J2. Write fence-report-v1.json in finally. Do not implement product UI.

## Acceptance criteria (ACs)
HARNESS-SMOKE

## Focused tests (the row's acceptance)
`FENCE_ID=F7 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate`

## Contract
- estimate: 25min · deps: A0,F0b · impl_tier=L3 · val_tier=L3 · budget=6
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
