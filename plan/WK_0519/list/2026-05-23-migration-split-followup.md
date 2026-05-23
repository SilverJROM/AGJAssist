---
date: 2026-05-23
type: refactor / hygiene
status: deferred
handler: future-batch (out of WK_0519 modularization scope)
source: claude DEC-003 during AGJAssist modularization
qa_verification: required if/when attempted
---

# 2026-05-23 — split db migration logic into its own file (gated on parity test)

## What

`src/db/database.ts` still owns the version-by-version migration block (~330
LOC, interleaved ALTER statements + a mid-flow re-exec of SCHEMA_SQL). Per
og-requirements R2.4 the proposal was to extract this to `src/db/migrations.ts`.

## Why deferred

DEC-003 (in modularization run decisions/): the N1a incident showed this code
path is high-blast-radius. Moving it without a fresh-DB-vs-upgrade-DB regression
test first is reckless. Strict zero-behavior-change posture said no for this
run.

## Prereq for picking up

Add `tests/db/migration-paths.test.ts`: build a fresh DB and a v22-snapshot DB,
run boot on both, assert identical `pragma table_info(*)` output across every
table + identical `pragma index_list(*)` output. THEN the migration split is
safe.

## Estimated work

Prereq test: ~1-2 hours. Actual split: ~30 min once the test is green.
