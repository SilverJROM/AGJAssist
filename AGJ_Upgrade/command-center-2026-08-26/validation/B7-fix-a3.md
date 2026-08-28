# B7 attempt 3 — FAIL prescription

commit judged: 6b19e7245ae0a34a574a199590515125a3e43863
**4 findings. Only Finding 1 fails the gate — and its fix is written out below and already VERIFIED to work.**

First, so no effort is wasted re-doing solved work: every carry-over from attempts 1 and 2 is **fixed and verified**
— the uncommitted-fix problem, the WAL-lossy backup, the swallowed backup failure, the version literals, the `path`
shadowing, and the dead-tool escalation. The focused row command passes 3/3 at the pristine commit. Do not touch any
of that. Finding 1 is a *different* defect that the previous sweeps never looked for.

---

FINDING 1 of 4
WHAT FAILED: `tests/notes-migration.test.ts:80` — `expect(() => { db = new DatabaseService(TEST_DB); }).not.toThrow()`
now throws `SqliteError: no such table: overmind_workflows`. That spec has **zero** overmind references; it builds a
legacy **v22** DB and asserts opening it does not throw. It is **green at the B7 parent 251129b** and red at this
commit (log `B7-vitest-a3.log` sections [2] and [3]) — a regression caused by this slice.
Mechanism: removing the OVM DDL from `SCHEMA_SQL` also removed the free `CREATE TABLE IF NOT EXISTS
overmind_workflows` that `this.db.exec(SCHEMA_SQL)` at `src/db/database.ts:131` performed **before** the legacy
migration chain. Sixteen legacy blocks then `ALTER TABLE overmind_workflows ...` a table that no longer exists. The
first to fire for a v22 DB is the `v<24` block at `src/db/database.ts:376-380`; the last is `v<31` at `:596`.
Measured blast radius (log [4]): **every DB below v31 lacking the OVM tables crashes on open** —
v22/v24/v27/v28/v30 THROW, v31/v33/v36 OK. (The live DB is v36 so the G2 execute itself is safe, and a real
in-the-wild legacy DB carries the OVM tables — but the code lost a robustness property it had, and a green test is
now red.)
THE FIX: append a table-existence check to the guard of each OVM legacy-migration block, so a block whose table is
absent is skipped instead of ALTERing into a crash. Exact edit, applied to the `if (current && current.version < N)`
line of each OVM block:
```ts
if (current && current.version < 24 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
```
Apply to the OVM blocks at **v<10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 24, 25, 27, 28, 29, 30, 31**.
**Do NOT guard the `v<37` block at `:856`** — that one must always run; it is the drop itself.
**This is verified, not proposed.** I applied exactly this in a throwaway worktree (no product code written to the
repo) and re-ran everything — log [7]: v22/v24/v27/v28/v30/v31/v33/v36 all upgrade `OK -> v37`, and
`notes-migration` + `database.spec` + `mcp-migration` + `command-center-migration` + `notes-folders` pass
**45/45**. Note the guard deliberately keys on `overmind_workflows` for every block, including the `v<27` one that
also creates `overmind_projects`: if workflows is absent the whole legacy OVM chain is moot, and v37 drops
everything regardless.
Do NOT fix this by re-adding the OVM DDL to `SCHEMA_SQL` — that undoes the slice.
WHY THE LAST ATTEMPT MISSED IT: every sweep so far (mine included, attempts 1 and 2) ran only `database.spec.ts`,
`mcp-migration.test.ts` and `overmind-project-migration.test.ts`. `notes-migration.test.ts` was never in the set,
and its fixture is the only one that exercises a pre-v31 upgrade *without* OVM tables.

FINDING 2 of 4
WHAT FAILED: Not gating — a naming drift to settle. The commit emits
`${this.dbPath}.pre-ovm-drop-${utc}-${process.pid}.bak` (`src/db/database.ts:858`), but the slice scope **and**
`plan.md:99` both name the live artifact `data/agjassist.db.pre-ovm-drop-<UTC>.bak`, and plan.md:99 is the attended
rollback procedure ("restore that backup"). Nothing in code consumes the name — the spec filters on prefix+suffix,
which still matches — so this is a docs-vs-implementation mismatch a human hits at rollback time.
THE FIX: pick one and make them agree. Either (a) keep the PID and amend `plan.md:99` to
`data/agjassist.db.pre-ovm-drop-<UTC>-<PID>.bak`, or (b) drop the PID back to the documented shape and keep
collisions safe with `if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);` immediately before the
`VACUUM INTO`. (a) is one line of markdown and is the cheaper close. Correcting my own a2 reasoning so it is not
carried further: the PID suffix only removes *cross-process* collisions; the in-process same-second case I cited is
unreachable on the success path, because after a successful upgrade the version is 37 and the block is never
re-entered.
WHY THE LAST ATTEMPT MISSED IT: my a2 prescription offered the PID suffix as the first option without checking that
plan.md:99 documents the exact filename for an attended restore.

FINDING 3 of 4
WHAT FAILED: Carry-over PARTIAL, unchanged and **deliberately not gating** (a2 said it "should not cost an
attempt"). `tests/unit/command-center-migration.spec.ts:100-127` builds its "v36" parity specimen from a fresh v37
DB via `UPDATE schema_version SET version = 36` plus re-added OVM tables, so both sides of
`expect(upgradedFp).toEqual(freshFp)` come from the same `SCHEMA_SQL` and the comparison is near-tautological for
every non-OVM object.
THE FIX: worth doing now only because it is the exact blind spot behind Finding 1 — a specimen with genuine legacy
provenance would have caught the crash three attempts ago. Mechanism: seed the upgraded side from the hand-written
legacy fixture pattern already used in `tests/mcp-migration.test.ts` (`createFixture(path, 34)` — explicit CREATE
TABLE statements for the old shape) at a pre-v31 version, **without** OVM tables, and assert the upgrade completes
and matches the fresh fingerprint. If you fix Finding 1, add exactly one such case (v22, no OVM tables) so the
regression cannot come back.
WHY THE LAST ATTEMPT MISSED IT: it was explicitly deferred as a rigour gap; Finding 1 is the cost of that deferral.

FINDING 4 of 4
WHAT FAILED: `tests/overmind-project-migration.test.ts` still fails —
`SqliteError: no such table: overmind_workflows` via `src/tools/propose-overmind-projects.ts:71,82`. Outside B7's
scope line, and the implementer **has now escalated it correctly** (`callbacks.md:66`), so it is not charged to this
slice.
THE FIX: nothing to do inside B7 — leave the tool alone. For the coordinator: A5 ("full unit + e2e suites are
green") cannot close until a slice owns it; the closing mechanism is deleting `src/tools/propose-overmind-
projects.ts` together with `tests/overmind-project-migration.test.ts`, since the feature it proposes projects for no
longer exists.
WHY THE LAST ATTEMPT MISSED IT: nothing missed — correctly reported, still unowned.
