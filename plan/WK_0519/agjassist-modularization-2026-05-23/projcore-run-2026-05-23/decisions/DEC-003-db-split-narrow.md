---
id: DEC-003
raised_by: claude-supervisor (B8 planning)
decided_by: claude-supervisor (trust-defaults)
date: 2026-05-23
status: resolved
---

# DEC-003 — `database.ts` split: extract schema data only, not migration logic

## The choice

og-requirements R2.4 and implementation-plan B8 originally proposed splitting
`src/db/database.ts` into three files: `schema.ts` + `migrations.ts` +
`database.ts`. The migration logic is ~330 LOC of tightly-interleaved
version-by-version `ALTER` statements, including one stretch where SCHEMA_SQL is
re-`exec`'d mid-flow (so post-migration `CREATE TABLE IF NOT EXISTS`s pick up
any newly-added tables).

## Decision: split schema-data only, leave migration logic in database.ts

- **`src/db/schema.ts`** (new) — `SCHEMA_VERSION` const, the `SCHEMA_SQL` template
  string, the `DEFAULT_SAFETY_PATTERNS` seed list, and a small
  `applyFreshDbExtras(db)` function that runs the two new-column indexes the
  fresh-DB path needs (`idx_notes_folder`, `idx_notes_pinned`).
- **`src/db/database.ts`** unchanged in behavior; just imports those constants
  from `schema.ts`. The migration block + initSchema flow stays put.

## Reasoning

- **N1a precedent.** The last time someone moved migration code around (putting
  the new-column indexes into SCHEMA_SQL before the v23 ALTER), the app refused
  to boot on existing DBs. The fresh-DB-vs-upgrade-DB path is a known
  high-blast-radius seam.
- **Strict zero-behavior-change.** Pure data move (SCHEMA_SQL is a string
  constant) cannot change runtime behavior. Logic move can, even if "obviously"
  identical.
- **Modularity value still captured.** The 800-LOC database.ts becomes ~470
  LOC (a 41% reduction); the 340-LOC SCHEMA_SQL string + 11-line
  DEFAULT_SAFETY_PATTERNS + version const are now in their own file,
  individually readable.
- **A future B-style batch can split migrations** when there's appetite for a
  targeted "fresh-DB vs upgrade-DB regression test" first. Filed below.

## Follow-up

A new entry will be added to `plan/WK_0519/list/2026-05-23-migration-split-followup.md`
for the deferred migration-logic split, gated on adding a fresh-DB vs upgrade-DB
parity test.

## Implementation-plan delta

- B8 narrowed to: extract `src/db/schema.ts` only (data + minimal fresh-DB-extras
  hook). `migrations.ts` deferred.
