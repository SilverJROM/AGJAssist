# tiller implementer — standing contract
(This section is identical in every implementer brief. Your specific work is in THE SLICE below.)
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.

You are the IMPLEMENTER. You write product code and tests, then commit.

---

# [driver] B7 CORRECTION (attempt 2) — fix EVERY finding the validator listed

The independent validator FAILed B7: defect_class=IMPL_INCOMPLETE gate=None.
**Validator's callback summary:** [projcore callback] validator B7 STATUS: DONE — FAIL v37 bump breaks 8 green tests; WAL backup empty; drop proceeds when backup fails

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
# B7 attempt 1 — FAIL prescription

commit judged: 2973a9feb2001cf9e83345ead4e75883d56f4525 (parent baseline 251129b)
Focused row command PASSES (3/3). It fails on regression + on A4's backup clause. **6 findings, fix in this order.**

Read first: the brief says "A4 — NO CRITERION TEXT FOUND". That is wrong. A4 is at `og-requirements.md:45-47` and is
stronger than the brief's scope line. The real text is the contract:
> **A4.** Migration drops `overmind_projects`, `overmind_workflows`, `overmind_task_history` (+ any overmind-only
> columns), **with a timestamped DB backup taken first**; a fresh DB and an upgraded DB converge to the same schema;
> `SCHEMA_VERSION` bumped.

---

FINDING 1 of 6
WHAT FAILED: The `SCHEMA_VERSION` 36 → 37 bump breaks 8 tests that were green at the parent commit — proof in
`validation/B7-vitest-a1.log` sections [2] (8 failed at 2973a9f) vs [3] (18/18 passed at 251129b).
  - `tests/unit/database.spec.ts:78`, `:192`, `:227`, `:346` — `expect(version.version).toBe(36)`
  - `tests/mcp-migration.test.ts:247`, `:248`, `:296`, `:315` — `expect(schemaVersion(...)).toBe(36)`
  - `tests/overmind-project-migration.test.ts:230` (via `:37`) — `insertWorkflow` writes to `overmind_workflows`,
    which the new migration drops → `no such table`
THE FIX: three different mechanisms, do not apply one blanket edit —
  (a) Literal bump `36` → `37` at `database.spec.ts:78` and `:227`, and at `mcp-migration.test.ts:247,248,296,315`.
      Those six assertions are incidental to their tests' subjects. Keep them LITERAL — do NOT rewrite them as
      `toBe(SCHEMA_VERSION)`, which would read the expected value out of the mechanism under test (D-082).
  (b) `database.spec.ts:146` "upgrades a v23 snapshot DB ... adds current overmind workflow columns" and
      `database.spec.ts:259` "rebuilds v27 overmind_workflows ... row survival": these assert OVM survival and now
      contradict B7. Keep each fixture, invert the assertion and rename the test — replace the
      `pragma("table_info(overmind_workflows)")` / `SELECT COUNT(*) FROM overmind_workflows` assertions with
      `expect(names).not.toContain("overmind_workflows")` (and `overmind_projects`) read off
      `SELECT name FROM sqlite_master WHERE type='table'`. That turns two dead tests into real proof that the v23
      and v27 upgrade paths — not just the v36 one the new spec covers — end with the OVM tables gone.
  (c) `tests/overmind-project-migration.test.ts` exercises `src/tools/propose-overmind-projects.ts`, which still
      issues `FROM overmind_workflows` (`:71`, `:82`) against a table that no longer exists. That tool is now dead
      code against a dropped schema. It is OUTSIDE B7's scope line — do NOT delete it inside this slice. Report it
      to the coordinator as an unclaimed A-series leftover (candidate for the B5/B-cleanup slice) and, for B7, note
      it in the callback rather than editing it.
WHY THE LAST ATTEMPT MISSED IT: the attempt ran only the focused row command, which passes; nothing in that row's
spec file touches the pre-existing version literals.

FINDING 2 of 6
WHAT FAILED: `src/db/database.ts:857-862` — `fs.copyFileSync(this.dbPath, backupPath)` copies only the main DB file.
The connection is WAL (`database.ts:22`), so a `-wal` left by a previously-crashed process is NOT in that file and
the `-wal`/`-shm` sidecars are never copied. Probe [4] in `validation/B7-vitest-a1.log`: with 24,752 bytes of OVM
data sitting in an uncheckpointed WAL, the produced backup is 4,096 bytes, `backup_tables = []`, and
`SELECT * FROM overmind_projects` on it errors `no such table` — while the migration goes on to drop the live
tables. A4's "backup taken first" produced an empty database on exactly the path where a backup matters.
THE FIX: replace the raw file copy with a snapshot taken THROUGH the open connection, so WAL content is included:
```ts
this.db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
```
Verified available here — sqlite 3.51.2 via better-sqlite3, synchronous, consistent, and it refuses a pre-existing
destination (which also closes Finding 3's EISDIR case). Do NOT reach for `this.db.backup()`: it returns a Promise and `initSchema()` is called synchronously
from the constructor, so it cannot be awaited there. If you keep `copyFileSync` for any reason, you must first run
`this.db.pragma("wal_checkpoint(TRUNCATE)")` and copy the `-wal` alongside — strictly worse, two files to keep
consistent.
WHY THE LAST ATTEMPT MISSED IT: the spec's v36 fixture is built by a connection that is `close()`d, and
better-sqlite3 checkpoints on close — so the fixture never has WAL residue and the happy path always looks faithful
(probe [5] CASE A).

FINDING 3 of 6
WHAT FAILED: `src/db/database.ts:858-861` — the `catch {}` swallows a failed backup and the three
`DROP TABLE IF EXISTS` statements execute regardless. Probe [6]: with the copy failing (`EISDIR`) while sqlite stays
writable, `constructor_threw = no`, `ovm_table_still_present = false`, `version_after = 37`,
`usable_backup_files = 0`. A4 requires the backup FIRST; here the destructive step proceeds silently without one.
The inline rationale ("backup failure is non-fatal for isolated tests") does not hold — in isolated tests the temp
dir is writable and the copy succeeds.
THE FIX: delete the empty catch. Let the snapshot throw, and gate the drops on a verified artefact:
after the snapshot, assert `fs.existsSync(backupPath) && fs.statSync(backupPath).size > 0` and otherwise
```ts
throw new Error(`v37 OVM drop aborted: pre-drop backup ${backupPath} was not written`);
```
Because
`UPDATE schema_version` runs only after the drops, throwing leaves the DB at version 36 and the migration re-runs
cleanly on the next boot — fail-closed, no data lost.
WHY THE LAST ATTEMPT MISSED IT: the catch was written to keep tests green rather than to keep the invariant.

FINDING 4 of 6
WHAT FAILED: `tests/unit/command-center-migration.spec.ts:83-85` asserts only
`expect(backups.length).toBeGreaterThan(0)` — a filename match. The zero-table 4,096-byte file from probe [4]
passes it, and so would a 0-byte file. The spec therefore cannot fail for Finding 2 or Finding 3; nothing ever
opens the backup.
THE FIX: read the backup back through a SECOND, independent path — `new Database(backupPath, { readonly: true })` —
and assert against the LITERAL rows the fixture seeded, not against anything the migration reports:
`expect(bak.prepare("SELECT slug FROM overmind_projects ORDER BY id").all()).toEqual([{ slug: "p1" }])`.
Then add the specimen that makes it discriminate: build the v36 fixture in WAL mode and **leave the fixture
connection open (no `close()`)** so the rows sit in an uncheckpointed `-wal` — an input the mechanism would not
choose for itself. With `copyFileSync` that assertion fails (`no such table`); with `VACUUM INTO` it passes. That is
the discriminator the current spec lacks: it fails on today's code and passes on Finding 2's fix.
WHY THE LAST ATTEMPT MISSED IT: existence of a correctly-named file was treated as evidence of a usable backup.

FINDING 5 of 6
WHAT FAILED: `tests/unit/command-center-migration.spec.ts:110-113` proves "converge to the same schema" by comparing
`type='table'` NAMES only — no indexes, no columns, no DDL text. Both sides are also created from the same
`SCHEMA_SQL` constant, so table equality is near-tautological. NOTE: this is a test-strength gap, **not** a live
defect — probe [7] compared a true v36 DB (built by the parent commit's own code) upgraded to v37 against a fresh
v37 DB at full `sqlite_master` fidelity and found 81 vs 81 objects, no leftovers, no missing objects, no DDL
differences. The implementation converges correctly, including the three `applyFreshDbExtras` OVM index removals.
THE FIX: compare a full fingerprint instead of names — this repo already has the comparator, reuse it rather than
inventing one: `mcp-migration.test.ts`'s `tableDescriptor()` (normalised table SQL + its indexes' SQL) and
`relevantSchemaFingerprint()` (`SELECT type, name, tbl_name, sql FROM sqlite_master ... ORDER BY type, name` with
whitespace-normalised `sql`). Assert the fresh and upgraded fingerprints are `toEqual`, indexes included. Build the
v36 side from a realistic v36 schema rather than three stub tables, so the comparison is not tautological.
WHY THE LAST ATTEMPT MISSED IT: table names satisfy the sentence "converge to the same schema" if you read it
loosely; the repo's stricter existing convention sits one file away in `tests/mcp-migration.test.ts`.

FINDING 6 of 6
WHAT FAILED: The spec writes fixtures into the repo's LIVE `data/` directory —
`data/command-center-migration-test.sqlite` (`:7`) and `data/command-center-fresh.sqlite` (`:91`) — beside the
production `data/agjassist.db`, ignoring the `DB_PATH` temp copy `scripts/cc-run-isolated.mjs` exports. B7's scope
says "Prove fresh-vs-upgrade parity **only on temp copies**". Related residue: running `database.spec.ts` at this
commit left three unowned `data/test-db.sqlite.pre-ovm-drop-*.bak` files in the live data dir (the v37 migration now
fires for every pre-v37 fixture and nothing deletes the `.bak`); this validator removed them.
THE FIX: allocate the fixture paths with `fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-cc-migration-"))` and
`rmSync(dir, { recursive: true, force: true })` in `afterEach`, exactly as `tests/mcp-migration.test.ts:18-22`
(`tempDb()` / `tempDirs`) already does. That deletes the backup files with the directory and removes the
`readdirSync` scan over the live data dir in `cleanup()`. While fixing `database.spec.ts` for Finding 1, move its
`data/test-db.sqlite` fixture the same way so its `.bak` files stop landing next to the production DB.
WHY THE LAST ATTEMPT MISSED IT: `database.spec.ts` uses `data/`, so the convention looked established; the `.bak`
residue is new because before this commit no migration wrote files next to the DB.
```
**Do this before inventing anything.** A slice spent four attempts each inventing a different mechanism while this file sat unread, and closed on the first attempt that had it. If the prescription is WRONG, say why in your callback — that is a finding worth more than a fifth invention.

Address EVERY finding in the prescription — if it lists FINDING 1 of 3, all three land in this one attempt. Leaving one for later does not defer it, it re-spends a whole cycle rediscovering it. If it says the real path is *untested/mocked/no-op*, you MUST write tests that drive the **ACTUAL** overmind code (the real watcher/completion/ingestion path) end-to-end — **do NOT mock, stub, or no-op the thing under test**; a test that asserts a mock is exactly the FAIL. Fix ALL of the listed findings and NOTHING beyond them — 'do not widen scope' means do not go past the prescription, never 'fix only the first item in it'. Re-run the focused tests, then re-commit atomically **with the slice id in the commit SUBJECT** — `feat(B7): <summary>` or `[B7] <summary>`. An untagged subject is read as a foreign commit and this slice parks again, exactly as it would on attempt 1. Then emit:
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.
`[projcore callback] implementer B7 STATUS: DONE — commit <new sha> <one line: what changed, max 100 chars>`

---

## THE SLICE (unchanged since attempt 1 — this is not the correction)

### Scope
RELEASE-ATOMIC schema layer: bump `SCHEMA_VERSION`, remove OVM DDL, and on upgrade copy the DB being migrated to `<that-db-path>.pre-ovm-drop-<UTC>.bak` before dropping `overmind_projects`, `overmind_workflows`, `overmind_task_history`. Prove fresh-vs-upgrade parity only on temp copies. Live path `data/agjassist.db.pre-ovm-drop-<UTC>.bak` is G2 execute-only. Isolated runner tears down the temp DB.

### Acceptance criteria — the TEXT is the contract, the id is only its name
- **A4** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO instead of implementing toward it** — that is a PLAN_DEFECT, and it is worth more than another attempt spent satisfying the wrong thing. **If a criterion states an OUTCOME but not a MECHANISM, name the mechanism you chose in your callback.** A correction that re-invents the mechanism is how a slice reaches attempt 6: four attempts inventing, then one with the prescription in hand.

### Focused tests
`node scripts/cc-run-isolated.mjs --slice B7 -- npx vitest run tests/unit/command-center-migration.spec.ts --minWorkers=1 --maxWorkers=4`
