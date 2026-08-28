# [driver] Slice D1 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
Schema layer: additive `summary_llm_endpoints` and `agent_summaries` with one default, provenance, timestamps, no plaintext secret columns, fresh-vs-upgrade parity.

## Acceptance criteria (ACs)
E1,E3,F2,F3

## Focused tests (the row's acceptance)
`node scripts/cc-run-isolated.mjs --slice D1 -- npx vitest run tests/unit/summary-schema.spec.ts --minWorkers=1 --maxWorkers=4`

## Contract
- estimate: 30min · deps: C6 · impl_tier=L3 · val_tier=L3 · budget=4
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
