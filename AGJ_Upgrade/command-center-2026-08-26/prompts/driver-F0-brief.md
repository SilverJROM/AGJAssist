# [driver] Slice F0 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
HARNESS: rewrite `e2e/command-center-window-fence.spec.ts` so G1-J2 are named-red on current HEAD (no draft isolation, no header-v2, no refresh control, no 390 dropdown). Collect ALL ids (do not abort after the first fail). Write fence-report-v1.json in finally. Do not implement product UI.

## Acceptance criteria (ACs)
HARNESS-SMOKE

## Focused tests (the row's acceptance)
`npx playwright test e2e/command-center-window-fence.spec.ts --project=cc --config=playwright.cc.config.ts --reporter=line; node -e "const r=JSON.parse(require('fs').readFileSync('fence-report-v1.json','utf8')); const f=Array.isArray(r.failed)?r.failed:[]; process.exit(f.some(x=>x&&x.kind==='assert')?0:1)"`

## Contract
- estimate: 25min · deps: A0 · impl_tier=L2 · val_tier=L3 · budget=4
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
