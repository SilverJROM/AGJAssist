# B7 Validator Red-Team A2

commit: 2c15f5242e220d14e2200da250922e6d5cdab620
prior attempt: 2973a9feb2001cf9e83345ead4e75883d56f4525 (FAIL, 6 findings)
verdict: standard-fail

## Headline: the fix exists on disk but is NOT in the commit

`git diff --name-only 2c15f52^..2c15f52` returns **two test files only**. `git diff 2973a9f..2c15f52 --
src/db/database.ts src/db/schema.ts` is **empty** — the implementation is byte-identical to the attempt-1 commit
that already FAILed on it.

Meanwhile `git status --porcelain` shows:

```
 M src/db/database.ts
 M tests/mcp-migration.test.ts
```

Those two *unstaged* files contain the attempt-1 Findings 1a/2/3 fixes (`VACUUM INTO` + fail-closed throw; the
`toBe(37)` literals). The implementer did the work and reported DONE without committing it. The gate judges the
commit, so the slice fails on an implementation that was never staged.

**This nearly escaped detection.** Running the row command in the repo root passes 3/3 — because the dirty working
tree carries the fix. It only fails in a pristine `git worktree` at 2c15f52. Every result below is from that
worktree; log sections [2] and [3].

## Criterion authority note (repeat of an a1 defect, still unfixed)

The a2 brief again says "**A4** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md". A4 **does** exist at
`og-requirements.md:45-47` and is stronger than the brief's scope line — it requires the timestamped backup be taken
**first**, an ordering guarantee, not a best-effort attempt. This pass judged against that real text again. The
brief's metric-line template also still reads `attempt=1` on an attempt-2 brief; echoed verbatim as instructed
(non-gating), flagged here so the driver template can be corrected.

## Lens 1: the slice's own focused row command — **FAIL**

At the pristine commit (`focused_exit_at_commit=1`):

```
× command-center migration B7 > upgrade from v36 backs up DB and drops OVM tables with WAL content captured
  → SqliteError: no such table: overmind_projects   (at spec line 97, reading the backup back)
 Tests  1 failed | 2 passed (3)
```

The commit's own new test catches the attempt-1 Finding 2 defect exactly as designed — the backup produced by
`fs.copyFileSync` contains none of the OVM data — because the implementation half of the fix never landed.

## Lens 2: is the new WAL specimen genuine, or does it merely look like one? — **PASS (it is genuine)**

The obvious way this "fix" could have been faked is a specimen that never actually leaves data uncheckpointed.
Replicating the spec's fixture exactly (log [4]):

```
main_size_before = 4096   wal_size_before = 65952
MAIN-FILE-ONLY tables BEFORE migration = []      <-- a raw file copy here captures nothing
main_size_after  = 4096   wal_size_after  = 1207192
```

Leaving the fixture connection open genuinely keeps the whole database in the `-wal`; the main file stays a bare
4,096-byte header for the entire migration and is only checkpointed on `close()` (`main_size_after_close = 425984`).
This is a correctly-built discriminating specimen: it fails against `copyFileSync` and passes against `VACUUM INTO`.
Credit where due — it is the mechanism from the a1 prescription, implemented properly.

## Lens 3: regression sweep at the commit — **FAIL (partially fixed)**

| file | at 2c15f52 | note |
|---|---|---|
| `tests/unit/database.spec.ts` | **12/12 pass** | a1 Findings 1b + 6 landed correctly |
| `tests/mcp-migration.test.ts` | **3 fail** — `expected 37 to be 36` at :247, :296, :315 | fix sits uncommitted |
| `tests/overmind-project-migration.test.ts` | **1 fail** — `no such table: overmind_workflows` | out of scope, see Lens 4 |

The two obsolete OVM-survival tests were correctly converted to "drops overmind tables" assertions rather than
deleted, which is the stronger of the two options the a1 prescription offered.

## Lens 4: the out-of-scope leftover was neither fixed nor reported — **PARTIAL**

a1 Finding 1c asked the implementer to leave `src/tools/propose-overmind-projects.ts` alone (it is outside B7's
scope line) but to **report it to the coordinator** as an unclaimed A-series leftover. The implementer's callback
(`callbacks.md:63`) reads only "fix fingerprint parity and TEST_DB bug" — no escalation. The tool still issues
`FROM overmind_workflows` against a dropped table, and its test still fails at both the commit and the working tree.
Escalating here on the implementer's behalf so it is not lost: **the dead tool needs an owning slice.**

## Lens 5: parity-fingerprint specimen provenance — **PARTIAL**

`schemaFingerprint()` now compares `type IN ('table','index')` with normalised SQL — a genuine improvement over the
table-name comparison, and it satisfies a1 Finding 5's mechanism.

The specimen, though, is built by creating a **fresh v37 DB**, then `UPDATE schema_version SET version = 36` and
re-adding the three OVM tables. Both sides of the comparison therefore originate from the same `SCHEMA_SQL`
constant, so the assertion is near-tautological for every non-OVM object: it discriminates OVM leftovers (real
value) but cannot catch a migration that fails to bring a *genuine* v36 DB up to the fresh shape, because the
specimen already has the v37 shape before the migration runs. Not a live defect — attempt 1's probe [7] proved true
convergence against a real v36 DB built by the parent commit's own code (81 vs 81 objects, zero DDL differences).

## Lens 6: `const path = tempDb(...)` shadows the `node:path` import — **PARTIAL**

`tests/unit/database.spec.ts` lines 120, 155, 210, 266 declare `const path = tempDb("test-db.sqlite")` inside test
bodies while line 5 imports `path from "node:path"`. It passes today only because those four bodies never call
`path.join`. A latent trap for the next edit in those tests.

## Lens 7: temp-dir isolation and `data/` residue — **PASS**

Both specs now allocate fixtures with `fs.mkdtempSync(os.tmpdir(), ...)` and remove them in `afterEach`. a1 Finding
6 is fully addressed: no test writes beside the production `data/agjassist.db`, and the `.bak` files land inside the
temp dir and are removed with it. Verified: `data/` is clean of `pre-ovm-drop` residue after every run in this pass.

## Lens 8: would landing the uncommitted files close the slice? — informational

Log section [5], same commands against the working tree: focused row command **3/3 pass**
(`focused_exit_working_tree=0`), `database.spec.ts` 12/12, `mcp-migration.test.ts` 3/3. The only remaining failure is
the out-of-scope `overmind-project-migration.test.ts` from Lens 4. The pending `VACUUM INTO` + throw implementation
matches the a1 prescription; one edge worth noting before it lands is in the prescription as Finding 4.
