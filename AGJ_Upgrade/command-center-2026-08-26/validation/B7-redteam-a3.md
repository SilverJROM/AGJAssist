# B7 Validator Red-Team A3

commit: 6b19e7245ae0a34a574a199590515125a3e43863
prior attempts: 2973a9f (FAIL, 6 findings) → 2c15f52 (FAIL, fix left uncommitted)
verdict: standard-fail

## What this attempt got right

Everything the last two attempts were told to fix is fixed, and I verified each one rather than taking the diff's
word for it:

| carry-over | status | proof |
|---|---|---|
| a2: fix left uncommitted | **closed** | `git status --porcelain src/ tests/` is empty; the commit's blobs match the working tree byte-for-byte |
| a1 F2: backup loses WAL content | **closed** | log [5]A — with 24,752 B stranded in an uncheckpointed `-wal`, the backup now reads back `[{"slug":"precious-data"}]` (attempt 1 produced a zero-table file) |
| a1 F3: backup failure swallowed | **closed** | log [5]B — with the backup target unwritable the constructor throws, `ovm_table_survived = true`, `version_left_at = 36`. Fail-closed and re-runnable |
| a1 F1 / a2 F2: version-literal regressions | **closed** | `database.spec.ts` 12/12, `mcp-migration.test.ts` 3/3 |
| a2 F6: `path` shadowing | **closed** | no `const path = ` remains in either spec |
| a2 F3: escalate the dead OVM tool | **done** | implementer NOTE at `callbacks.md:66` |
| A4 convergence (live path) | **clean** | log [6] — true v36 DB built by the parent commit's own code, upgraded: 81 vs 81 objects, no leftovers, no missing objects, no DDL differences |

The focused row command passes 3/3 at the pristine commit (`focused_exit_at_commit=0`).

## Lens 1: broad regression sweep — **FAIL (new, and neither prior attempt looked here)**

Attempts 1 and 2 swept only `database.spec.ts`, `mcp-migration.test.ts` and `overmind-project-migration.test.ts`.
Widening to every schema-touching spec surfaced a second casualty:

```
❯ tests/notes-migration.test.ts (1 test | 1 failed)
  → expected [Function] to not throw an error but 'SqliteError: no such table: overmind_workflows' was thrown
    at tests/notes-migration.test.ts:80
```

That file contains **zero** overmind references. It builds a legacy v22 DB and asserts
`expect(() => { db = new DatabaseService(TEST_DB); }).not.toThrow()`. Baseline at the B7 parent 251129b: **green**
(log [3]). At this commit: **red**. A pre-existing green test, broken by this slice — the same standard attempt 1
was failed on.

**It is not a test-only artifact.** Removing the OVM DDL from `SCHEMA_SQL` removed the free
`CREATE TABLE IF NOT EXISTS overmind_workflows` that `this.db.exec(SCHEMA_SQL)` (line 131) used to perform *before*
the legacy migration chain ran. Sixteen legacy blocks then `ALTER TABLE overmind_workflows ...` on a table that no
longer exists. Measured blast radius (log [4]):

```
v22 → THROWS    v24 → THROWS    v27 → THROWS    v28 → THROWS    v30 → THROWS
v31 → OK        v33 → OK        v36 → OK
```

**Every DB below v31 that lacks the OVM tables now crashes on open.** The boundary is the last OVM `ALTER` block,
`v<31` at `database.ts:596`; the first one to fire for a v22 DB is `v<24` at `database.ts:376-380`.

Bounding the real-world impact honestly: the **live** DB is at v36, so the live G2 execute is unaffected (`v36 → OK`),
and a genuine in-the-wild v22–v30 DB would carry the OVM tables (v11 created them), so it would still upgrade —
`database.spec.ts`'s v23/v27 fixtures include those tables and stay green. What broke is the robustness the code
previously had for any DB missing them. It is still a green→red regression caused by this slice's own edit.

## Lens 2: backup filename vs the documented rollback artifact — **PARTIAL**

The commit names the backup `${this.dbPath}.pre-ovm-drop-${utc}-${process.pid}.bak`. The slice scope and
`plan.md:99` both name the live artifact **`data/agjassist.db.pre-ovm-drop-<UTC>.bak`**, and plan.md:99 is the
attended rollback procedure: "restore that backup and reset to the recorded pre-release commit."

The PID suffix was the first of two mechanisms my a2 prescription offered, so the implementer followed guidance
faithfully and this is not held against the attempt. But the emitted name no longer matches the documented one, and
nothing else in the repo consumes it (the spec's filter is prefix+suffix, so it still matches). Either plan.md:99
gets a one-line amendment or the operator globs. Flagging so G2 is not surprised at rollback time.

Accuracy note on my own a2 reasoning: the PID suffix removes cross-process collisions only. The in-process
same-second case I cited is in fact unreachable on the success path — after a successful upgrade the version is 37,
so the v<37 block is never re-entered. Where it can still collide (a retry after a failed first attempt), the
outcome is a fail-closed throw with the data intact, which is benign.

## Lens 3: parity-fingerprint specimen provenance — **PARTIAL (carry-over, deliberately not failed)**

Unchanged from a2: the spec's "v36" specimen is a fresh v37 DB with `UPDATE schema_version SET version = 36` plus
re-added OVM tables, so both sides of `expect(upgradedFp).toEqual(freshFp)` originate from the same `SCHEMA_SQL`.
It discriminates OVM leftovers but is near-tautological for non-OVM objects. My a2 prescription said explicitly that
this "should not cost an attempt", so it does not drive this verdict. Log [6] independently proves real convergence.

Note the connection to Lens 1: a parity specimen with genuine legacy provenance would have caught the crash. The
tautological specimen is why three attempts passed a parity test while the legacy upgrade path was broken.

## Lens 4: the dead OVM tool — **PARTIAL, out of scope, now correctly escalated**

`tests/overmind-project-migration.test.ts` still fails (`no such table: overmind_workflows` via
`src/tools/propose-overmind-projects.ts`). Outside B7's scope line, and the implementer has now escalated it
(`callbacks.md:66`). Not charged to this slice, but A5 ("full unit + e2e suites green") cannot close until some
slice owns it.

## Lens 5: fail-closed vs boot availability — **PASS, with an operational note**

The new `throw` means a backup that cannot be written takes the app down instead of silently destroying data
(log [5]B). That is the correct trade and what a1 asked for. Operationally G2 should know the failure mode is now
"app refuses to boot, DB untouched at v36" rather than "boots with data gone".

## Lens 6: `VACUUM INTO` interaction with the migration chain — **PASS**

`VACUUM INTO` cannot run inside a transaction. Verified across every upgrade path exercised here (v22–v36 legacy
fixtures, the v23/v27/v31 spec fixtures, the mcp v34/v35 fixtures): no "cannot VACUUM from within a transaction"
error in any run, so the v36 mcp `transaction()` block has committed before the v37 block is reached.
