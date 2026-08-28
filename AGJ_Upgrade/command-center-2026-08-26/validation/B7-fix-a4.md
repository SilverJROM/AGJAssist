# B7 attempt 4 — FAIL prescription

commit judged: 7340cff4bebd137060e2a34368f5e58ba678e976
**5 findings. Only Finding 1 fails the gate, and it is a two-line revert.**

**Read this first — the defect came from an error in MY a4-previous (a3) prescription, not from your work.**
My a3 prescription told you to guard the OVM blocks at "v<10, 11, 12, …, 31". **The first two entries were wrong.**
I built that list with a scanner that ran from each `if (current && current.version < N)` line to the next one, so
every block swallowed the *comment introducing the next migration*. `v<10` absorbed the line
`// Migration: v10 → v11: add overmind_workflows table` and got misclassified as an OVM block. It is the **notes**
migration. You applied the list exactly as given. Fix the two blocks below and the slice closes; everything else you
did this round is correct and verified.

---

FINDING 1 of 5
WHAT FAILED: `src/db/database.ts:179` — the `v9 → v10` migration ("make notes.project_id nullable (recreate table)")
is now gated on `overmind_workflows` existing. OVM tables were not introduced until v11, so a genuine v9 DB can
never satisfy that guard and the migration is skipped on precisely the DBs it targets. Measured at this commit
(`B7-vitest-a4.log` [4]): the DB upgrades to v37, then `notes.project_id notnull = 1` and
`INSERT INTO notes (project_id, …) VALUES (NULL, …)` is `REJECTED: NOT NULL constraint failed: notes.project_id`.
The same v9 DB at the B7 parent 251129b gives `notnull = 0` and accepts the insert. Stated as the AC (log [5]):
`fresh: project_id INTEGER REFERENCES projects(id)` vs `upgraded: project_id INTEGER NOT NULL REFERENCES
projects(id)` → **CONVERGE? NO**, which is A4's "fresh and upgraded converge to the same schema" failing directly.
A silent regression — the upgrade reports success and the notes feature then refuses every project-less note.
THE FIX: delete the guard clause from that one line, restoring it to exactly:
```ts
      if (current && current.version < 10) {
```
Do NOT add a `notes`-existence guard in its place; the block is already safe (`CREATE TABLE IF NOT EXISTS
notes_new`, `INSERT OR IGNORE … SELECT * FROM notes` — and `SCHEMA_SQL` at line 131 has already created `notes`
unconditionally before this point).
WHY THE LAST ATTEMPT MISSED IT: my a3 block-scanner attributed a trailing comment to the wrong block, and no
fixture in the suite is older than v22 (Finding 3), so nothing exercised it.

FINDING 2 of 5
WHAT FAILED: `src/db/database.ts:206` — the `v10 → v11` block is guarded the same way, and its body is only
`this.db.exec(SCHEMA_SQL)`, which touches no OVM table either (log [6] flags both misfires). This one is currently
**harmless**, because `SCHEMA_SQL` is already exec'd unconditionally at `database.ts:131` before any of these
blocks, so the guarded copy is redundant regardless of how it evaluates. It is still a wrong condition and will
mislead the next reader.
THE FIX: same one-line revert:
```ts
      if (current && current.version < 11) {
```
Leave the other seventeen guards (v<12 … v<31) exactly as they are — log [6] confirms every one of those blocks
genuinely touches an OVM table, and `database.spec.ts` proves they still run for legacy DBs that carry the tables.
WHY THE LAST ATTEMPT MISSED IT: same bad list entry as Finding 1.

FINDING 3 of 5
WHAT FAILED: Root cause of Findings 1 and 2 going undetected — no fixture anywhere in the suite builds a DB below
v11. The new `createLegacyV22Fixture` (`tests/unit/command-center-migration.spec.ts:41`) is a real improvement and
closes a3 F3, but 22 > 10, so it cannot reach either misfiring block. My own blast-radius probe also floored at v22.
THE FIX: add one more case to `tests/unit/command-center-migration.spec.ts` alongside the v22 one — a
`createLegacyV9Fixture(dbPath)` that seeds `schema_version = 9`, `users`, `projects`, and a `notes` table whose
`project_id` is declared `INTEGER NOT NULL REFERENCES projects(id)` plus one seeded row. Then assert the two things
that discriminate, both against literals rather than against the migration's own output:
```ts
const cols = upgraded.raw.pragma("table_info(notes)") as Array<{name:string;notnull:number}>;
expect(cols.find(c => c.name === "project_id")!.notnull).toBe(0);
expect(() => upgraded.prepare("INSERT INTO notes (project_id, body, created_by) VALUES (NULL, 'x', 1)").run()).not.toThrow();
```
Both fail on today's code and pass once Finding 1 is reverted — that is what makes it a test rather than a
restatement. Adding the same v9 fixture to the fingerprint-parity case would also catch it, via the `notes` DDL.
WHY THE LAST ATTEMPT MISSED IT: the a3 prescription asked for "a pre-v31 fixture without OVM tables" and v22
satisfied that literally; it did not say the floor had to reach below v11.

FINDING 4 of 5
WHAT FAILED: `AGJ_Upgrade/command-center-2026-08-26/plan.md` is now internally inconsistent. Line 99 was updated to
`data/agjassist.db.pre-ovm-drop-<UTC>-<PID>.bak`, but line 24 — the B7 slice row in the same file — still says
`<that-db-path>.pre-ovm-drop-<UTC>.bak` and `data/agjassist.db.pre-ovm-drop-<UTC>.bak`. Half the rename landed, so
the file now documents two different names for one artifact.
THE FIX: apply the same `<UTC>` → `<UTC>-<PID>` edit to both occurrences in the B7 row at `plan.md:24`. (The Scope
block quoted in the driver briefs is generated from that row, so it goes stale until the row is fixed.)
WHY THE LAST ATTEMPT MISSED IT: my a3 prescription named `plan.md:99` specifically and did not mention line 24.

FINDING 5 of 5
WHAT FAILED: Nit, non-gating. `normalizeSql` in `tests/unit/command-center-migration.spec.ts:22-31` rewrites
`CREATE TABLE <name>` to `CREATE TABLE <table>`, erasing the identifier. I verified it is **not** masking anything
(log [7]): with no name handling the only difference is `audit_log` vs `"audit_log"` — the quoting SQLite leaves
after the v36 rebuild+RENAME — and both the shipped normalizer and a stricter one that keeps the name are
IDENTICAL. Table identity also still survives via the separate `name`/`tbl_name` fingerprint fields.
THE FIX: optional. If you want the fingerprint to keep discriminating on the table name inside the DDL, narrow the
rewrite to the actual artifact — strip the quotes instead of the name:
```ts
.replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"([^"]+)"/i, "CREATE TABLE $1")
```
Verified equivalent on this specimen. Leave as-is if you prefer; it costs nothing today.
WHY THE LAST ATTEMPT MISSED IT: nothing missed — a reasonable fix, just broader than the artifact required.
