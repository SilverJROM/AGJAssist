# [driver] Slice E0c — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
HARNESS-CORRECTNESS ONLY. e2e/command-center-wakeup-fence.spec.ts's report aggregation drops a genuine failure: FENCE_STUB=E2 correctly throws inside test_e2 (Playwright's own runner reports "1 failed", and the per-test finishContributor assertion correctly sees the failure) but the FINAL fence-report-v1.json (written by writeReport()/test.afterAll's shard aggregation over CONTRIBUTOR_TESTS) shows failed:[] and E2 silently absent from passed too -- confirmed reproducible 2/2 including an exact replica of the driver's own subprocess invocation (Popen, piped stdout/stderr, start_new_session), so this is not load-timing. Trace why test_e2's shard (fence-report-v1.json.test_e2_service_fires_due_wakeup_once_into_temp_pane.json, written by finishContributor before the test throws) is not reaching the aggregate writeReport() reads in test.afterAll, and fix the aggregation so a real per-test failure always survives into the top-level report regardless of which test in the file fails. Do not touch E1-E4 product code (all four are DONE and correct) or the FENCE_STUB targets/tokens E0b just fixed. Split from E5 (fence stuck on a harness report-aggregation defect, not a plan or product defect).

## Acceptance criteria (ACs)
HARNESS-SMOKE

## Focused tests (the row's acceptance)
`FENCE_ID=E5 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate`

## Contract
- estimate: 25min · deps: A0,E0b · impl_tier=L3 · val_tier=L3 · budget=5
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
