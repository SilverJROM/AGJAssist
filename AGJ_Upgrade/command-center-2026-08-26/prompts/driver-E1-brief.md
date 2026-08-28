# [driver] Slice E1 — deterministic brief (run command-center-2026-08-26)

## Scope (verbatim from hardened plan row — do ONLY this)
Schema layer: additive `agent_one_time_wakeups` (pane, manual fire time, action, pending/fired/cancelled, fresh-vs-upgrade). Do not reuse OVM `agent_wake_schedule`. Capability-independent of summaries, but deps D1 so `SCHEMA_VERSION` / `schema.ts` edits serialize C1→D1→E1 (no parallel bump).

## Acceptance criteria (ACs)
D1,D2,D3

## Focused tests (the row's acceptance)
`node scripts/cc-run-isolated.mjs --slice E1 -- npx vitest run tests/unit/agent-wakeup-schema.spec.ts --minWorkers=1 --maxWorkers=4`

## Contract
- estimate: 25min · deps: D1 · impl_tier=L3 · val_tier=L3 · budget=4
- Verifier ≠ fixer. Do NOT widen scope beyond the row (any widen = re-plan/EDGE).
- End your terminal DONE callback with the VERDICT-V1 line (see design/VERDICT-V1.md).
