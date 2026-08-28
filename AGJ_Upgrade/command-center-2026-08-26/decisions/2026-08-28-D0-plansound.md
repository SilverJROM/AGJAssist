# 2026-08-28 D0 PLAN_SOUND (north)

RAISE-D0-c1: a4 sonnet5 SLICE-TOO-BIG (hard-cap 1800s, pane still moving). a1+a2 TEST_NOT_DISCRIMINATING, a3 IMPL_INCOMPLETE (E1 timeout / no create-path). Park rolled HEAD to b1d8258; durable ref `refs/tiller/command-center-2026-08-26/D0` = 8a0ebc5.

North ruling: F-SUMMARIES ACs SATISFIABLE — not criterion drift, do not re-plan, do not re-suspect, do not split. RETRY_WITH_DIRECTION carrying `validation/D0-fix-a3.md` in full at sonnet5 a4. If that FULL direction still fails → sol/opus5 a5 + budget 8.

Two fixes:
1. Real create-path (closed-C6 fire → pane reply → app-owned ReplySummaryService hook vs deterministic fixture LITERAL_SUMMARY_FOR_TEST → public GET poll). No Playwright-local import. Dropdown only reads.
2. Named E1 assert must beat Playwright 60000ms (explicit per-test timeout or trim 10s+120 poll). Outer command-timeout wrapper unchanged.

Keep FENCE_STUB=D3 named-red on E1. No product routes.

Applied: DIRECTION-D0-a4.json RETRY_WITH_DIRECTION + what_validator_missed. Plan budget 6→8. E0 already in-flight on live driver 1679333 — DIRECTION unparks D0 into the live drain; do not kill E0; `tiller resume` only if the pidfile is dead.
