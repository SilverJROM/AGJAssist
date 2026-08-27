# [driver] Slice A0 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
HARNESS-CORRECTNESS ONLY. Validator gates this row on `--harness-smoke` exit 0, NEVER on product A5. `acs` is HARNESS-SMOKE (not A5 — A5 stays B8/G2). Recovered HEAD still uses an HTTP proxy for FENCE_STUB (`scripts/cc-run-isolated.mjs` startStubProxy); remaining work: replace that with in-process Fastify preload so FENCE_STUB=ID patches the unit before route/job registration (INTERCEPTION_GAP). Also: every spec writes fence-report-v1.json in finally; `--gate` requires named expected_negative_fail_ids kind=assert (no synthesized ids); print reclaimed_bytes. Recovered commits already on HEAD (3439337). No product OVM removal.

## Acceptance criteria (ACs)
HARNESS-SMOKE

## Focused tests (the row's acceptance)
`FENCE_ID=B8 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --harness-smoke`

## Contract
- estimate: 30min · deps: — · impl_tier=L3 · val_tier=L3 · budget=4
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
