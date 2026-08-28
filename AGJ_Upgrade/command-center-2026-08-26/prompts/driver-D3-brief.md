# [driver] Slice D3 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
Services layer: `ReplySummaryService` captures the post-solicit pane reply, calls selected `/v1/chat/completions`, persists a short endpoint-attributed summary; LLM failure degrades without undoing the solicit.

## Acceptance criteria (ACs)
E1,E3

## Focused tests (the row's acceptance)
`node scripts/cc-run-isolated.mjs --slice D3 -- npx vitest run tests/unit/reply-summary-service.spec.ts --minWorkers=1 --maxWorkers=4`

## Contract
- estimate: 35min · deps: A0,C3,D2 · impl_tier=L3 · val_tier=L3 · budget=5
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
