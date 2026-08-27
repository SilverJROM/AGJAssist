# Decision — coordinator custody edits after co-planner DONE

Date: 2026-08-27 · `[projcore]`

Co-planners grok46 + sol both STATUS: DONE on the five-fence plan. Structural check found two residual defects; applied as custody (not product code):

1. **E1 deps `B8` → `D1`.** C1 and E1 both mutated `schema.ts` / `SCHEMA_VERSION` after B8 and could dispatch in parallel. Capability independence of F-WAKEUP vs F-SUMMARIES is preserved (E1 still does not wait on D7). Schema order is now C1 → (C6) → D1 → E1.
2. **G1 tests:** dropped unbounded `npx vitest run` (full-suite-at-once). Cleanup stays targeted `tests/command-center-cleanup.test.ts` plus the named terminal-ux Playwright specs. Full unit+e2e remain on B8/F7.

No other plan/queue/fence-contract edits.
