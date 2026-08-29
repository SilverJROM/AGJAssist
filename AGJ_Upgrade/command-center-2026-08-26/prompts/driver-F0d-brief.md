# [driver] Slice F0d — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
HARNESS-CORRECTNESS ONLY. The I1 negative-control assertion in e2e/command-center-window-fence.spec.ts (test_f3, `await expect(status).toHaveText('Updated', { timeout: 10000 })` at line 393) is load-flaky, not broken: confirmed by direct repeated execution (including an exact replica of the driver's own subprocess invocation) that it correctly detects the stubbed I1 failure every time under light load, but the driver's live run — concurrent with other active seats — missed it. Raise the timeout (10000 -> 30000) and/or replace the fixed-poll toHaveText wait with a deterministic wait on the actual `/api/tmux/panes/*/output` response (e.g. `page.waitForResponse` before asserting the status text) so the assertion is not a race against system load. Do not touch product code (F1-F6 are DONE and correct) or any other assertion. Re-verify both the positive journey and the FENCE_STUB=I1 negative control still pass/fail as expected after the change. Split from F7 (fence stuck on a harness timing defect, not a plan or product defect).

## Acceptance criteria (ACs)
HARNESS-SMOKE

## Focused tests (the row's acceptance)
`FENCE_ID=F7 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate`

## Contract
- estimate: 20min · deps: A0,F0c · impl_tier=L3 · val_tier=L3 · budget=5
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
