# [driver] Slice H8 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
HARNESS-CORRECTNESS ONLY. Fix B8 CLOSE measurement. Do not remove more product. (1) e2e/command-center-ovm-fence.spec.ts collects ALL of A1,A2,A3,A4,A5,B1,B2 and does not throw after a named assert; write passed and failed in finally. (2) e2e/run-command-center-playwright-fence.mjs sets FENCE_REPORT_PATH on the integration path, copies spec passed/failed into fence-report-v1.json, and verdict_line contains whitespace-split tokens fence=B8 verdict=PASS or FAIL fault_class=none or implementation or plan (no spaces in values). (3) FENCE_STUB=B2: a Fastify preHandler on unregistered /api/overmind/status never fires; re-register a stub GET that returns 200 so A2 kind=assert is named-red. --gate must exit 0: positive PASS with B2 in passed, negative named-red on A2.

## Acceptance criteria (ACs)
HARNESS-SMOKE

## Focused tests (the row's acceptance)
`FENCE_ID=B8 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate`

## Contract
- estimate: 25min · deps: A0,B1,B2,B3,B4,B5,B6,B7 · impl_tier=L3 · val_tier=L3 · budget=4
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
