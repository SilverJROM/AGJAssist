# B7 Validator Red-Team A1

commit: 2973a9feb2001cf9e83345ead4e75883d56f4525
parent (baseline): 251129b762e17543c14e54be5f12db748dd2237e
verdict: standard-fail

## Criterion authority note (PLAN_DEFECT, low severity)

The brief states: "**A4** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority."
That is wrong. A4 **does** exist, at `og-requirements.md:45-47`:

> **A4.** Migration drops `overmind_projects`, `overmind_workflows`, `overmind_task_history` (+ any overmind-only
> columns), with a timestamped DB backup taken first; a **fresh** DB and an **upgraded** DB converge to the same
> schema; `SCHEMA_VERSION` bumped.

This pass judged against the **real A4 text**, which is strictly stronger than the brief's scope line (scope says
"copy the DB ... before dropping"; A4 says "with a timestamped DB backup taken **first**" — an ordering *and*
existence guarantee on an irreversible operation). Findings 2 and 3 come from that clause. The brief's
"no criterion text" claim should be corrected before the next attempt so the next seat is not judged against the
weaker scope line.

Mechanism chosen where A4 states an outcome but not a mechanism: A4 says "converge to the same schema" without
saying how convergence is proved. **The mechanism used here is a full `sqlite_master` fingerprint (type + name +
whitespace-normalised `sql`, tables AND indexes) compared between a fresh v37 DB and a true-v36 DB upgraded to
v37**, where the v36 specimen is built by the *parent commit's* own code rather than hand-written in the test.

---

## Lens 1: regression — does the version bump break specs that were green before this commit? **FAIL**

`SCHEMA_VERSION` 36 → 37 with no corresponding update to the existing suite.

At the commit under test: **8 tests fail across 3 files**. The same three files at the parent commit: **18/18 pass**.

| file | failing | cause |
|---|---|---|
| `tests/unit/database.spec.ts` | 4 | `expect(version.version).toBe(36)` at :78, :192, :227, :346 |
| `tests/mcp-migration.test.ts` | 3 | `expect(schemaVersion(...)).toBe(36)` at :247, :248, :296, :315 |
| `tests/overmind-project-migration.test.ts` | 1 | `insertWorkflow` → `overmind_workflows` no longer exists |

Two of those are **not** fixable by bumping the literal — they assert OVM survival, which B7 deliberately destroys:
- `database.spec.ts:146` "upgrades a v23 snapshot DB ... adds current overmind workflow columns" — asserts
  `table_info(overmind_workflows)` contains six columns; the table is now dropped, so the pragma returns `[]`.
- `database.spec.ts:259` "rebuilds v27 overmind_workflows ... row survival" — `SELECT COUNT(*) FROM overmind_workflows`
  now throws `no such table`.

This is the A5 clause ("full unit + e2e suites are green (no dangling overmind imports/types)") failing.

Not counted against B7: `tests/acceptance/overmind-projects-migration.acceptance.test.ts` and the ~26 specs importing
`src/services/overmind*` fail at the **parent** commit too (B3 deletion residue, a different slice's cleanup).

## Lens 2: backup fidelity under WAL — **FAIL**

`fs.copyFileSync(this.dbPath, backupPath)` copies **only the main database file**. The connection runs
`PRAGMA journal_mode = WAL` (`database.ts:22`), and a `-wal` left by a previously-crashed process is recovered into
the reader's view but is *not* checkpointed into the main file before the copy.

Probe [4] — a v36 DB whose OVM rows live in a 24,752-byte uncheckpointed `-wal`:

```
main_db_size_before = 4096      wal_size_before = 24752
backup_size   = 4096
backup_tables = []                              <-- the "backup" holds ZERO tables
backup_overmind_projects_rows = ERROR: no such table: overmind_projects
```

The migration then drops the live tables. The backup that A4 requires is an empty database. The `-wal`/`-shm`
sidecars are never copied. Probe [5] CASE A confirms the happy path *is* faithful (`[{"id":1,"slug":"precious-data"}]`),
so this is specifically the crash-residue path — which is exactly when a pre-drop backup matters. The live path is
G2 execute-only against the real `data/agjassist.db`, so this is the highest-consequence finding.

## Lens 3: backup failure is swallowed, drop proceeds anyway — **FAIL**

```ts
try { fs.copyFileSync(this.dbPath, backupPath); }
catch { /* backup failure is non-fatal for isolated tests; live path is G2 execute-only */ }
this.db.exec("DROP TABLE IF EXISTS overmind_task_history"); // ... runs regardless
```

Probe [6] makes the copy fail (target pre-exists as a directory → `EISDIR`) while sqlite stays writable:

```
constructor_threw       = no
ovm_table_still_present = false      <-- dropped anyway
version_after           = {"version":37}
usable_backup_files     = 0          <-- no backup exists
```

A4's "with a timestamped DB backup taken first" is an ordering guarantee on a destructive, irreversible statement.
As written the guarantee is best-effort and its failure is silent. The in-code rationale ("non-fatal for isolated
tests") does not hold: in isolated tests the temp dir is writable and the copy succeeds — probe [5] CASE A.

## Lens 4: does the spec discriminate the backup at all? — **FAIL (TEST_NOT_DISCRIMINATING)**

`command-center-migration.spec.ts:83-85` asserts only that a filename with the right prefix/suffix exists:
`expect(backups.length).toBeGreaterThan(0)`. The zero-table 4,096-byte file from probe [4] satisfies that assertion,
and so would a 0-byte file. Nothing in the spec reads the backup's contents, so neither Lens 2 nor Lens 3 can ever
be caught by it. Per D-082 the assertion needs a second path that does not share the code under test — reading the
backup back through an independent `better-sqlite3` connection.

## Lens 5: fresh-vs-upgraded convergence — implementation **PASS**, test **PARTIAL**

Probe [7], the realistic live shape (a true v36 DB built by the parent commit's own code, upgraded by the commit
under test, vs a fresh v37 DB), compared at full `sqlite_master` fidelity:

```
upgraded objects = 81   fresh objects = 81
PRESENT ONLY IN UPGRADED (leftovers): []
PRESENT ONLY IN FRESH  (missing):     []
DDL TEXT DIFFERS:                     []
```

The implementation genuinely converges — OVM tables *and* their indexes are gone on both paths, and the three
`applyFreshDbExtras` OVM index creations were correctly removed alongside the DDL. **No live divergence exists.**

The *test*, however, compares `type='table'` **names only** — no indexes, no column sets, no DDL text — which is
weaker than A4's "converge to the same schema" and weaker than this repo's own established convention
(`mcp-migration.test.ts` `tableDescriptor()` / `relevantSchemaFingerprint()`, normalised DDL + per-index SQL).
Its v36 specimen is also hand-written as `schema_version` + three stub OVM tables, so both sides of the comparison
are built from the same `SCHEMA_SQL` constant and the equality is close to tautological for tables.

## Lens 6: `+ any overmind-only columns` clause — **PASS (vacuous)**

Checked the parent commit's `schema.ts` for OVM-only columns on surviving tables. The only cross-reference is
`overmind_workflows.project_id → overmind_projects(id)`, i.e. inside the dropped set. No surviving table carries an
overmind-only column, so the clause is satisfied with nothing to do. Probe [7]'s empty "leftovers" set confirms it.

## Lens 7: test isolation / residue — **PARTIAL**

The spec writes its fixtures into the repo's **live `data/` directory** (`data/command-center-migration-test.sqlite`,
`data/command-center-fresh.sqlite`), beside the production `data/agjassist.db` — it ignores the `DB_PATH` temp copy the
isolated runner exports. B7's scope says "Prove fresh-vs-upgrade parity **only on temp copies**". The spec does clean
up after itself (prefix-scoped, so it cannot touch the live DB), and `database.spec.ts` already uses `data/`, so the
convention is mixed — but `mcp-migration.test.ts` shows the correct `fs.mkdtempSync(os.tmpdir(), ...)` pattern.

Observed side effect: running `database.spec.ts` at this commit left three unowned
`data/test-db.sqlite.pre-ovm-drop-*.bak` files in the live data dir (the v37 migration now fires for every pre-v37
fixture, and nothing removes the `.bak`). Removed by this validator after the run.

## Lens 8: idempotency / crash-safety of the migration step — **PASS**

The three `DROP TABLE IF EXISTS` run outside a transaction and the version `UPDATE` is separate, so a crash mid-drop
leaves version 36 and the next boot re-runs harmlessly (`IF EXISTS`, plus a second backup). Downgrade (version > 37)
is skipped by the outer `current.version < SCHEMA_VERSION` guard. The `if (current && ...)` shape mirrors every other
migration in the file, so the empty-`schema_version`-table edge (drop skipped, `UPDATE` matches no row) is a
pre-existing repo-wide pattern, not something B7 introduced. Not charged to this slice.
