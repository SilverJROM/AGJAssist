# [driver] Slice F0b — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
HARNESS-CORRECTNESS ONLY. POSITIVE path of e2e/command-center-window-fence.spec.ts so G1-J2 match og-req on frozen F1-F6: restore check() await assertion; wait primary AND secondary in /api/tmux/sessions; H1 assert default tabs-collapsed without click; click tabs-collapse only to reveal switcher for G2/J1/J2; literal fixtures not expect(true); J2 uses data-testid=terminal-header-tab. Named-reds and fence-contract remap are F0c. Collect ALL G1-J2. Write fence-report-v1.json in finally. Do not implement product UI. Split from SLICE-TOO-BIG a4.

## Acceptance criteria (ACs)
HARNESS-SMOKE

## Focused tests (the row's acceptance)
`FENCE_ID=F7 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs`

## Contract
- estimate: 25min · deps: A0,F0,F1,F2,F3,F4,F5,F6 · impl_tier=L3 · val_tier=L3 · budget=6
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
