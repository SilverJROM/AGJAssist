# B7 Validator Red-Team A4

commit: 7340cff4bebd137060e2a34368f5e58ba678e976
prior: 2973a9f (FAIL) → 2c15f52 (FAIL, uncommitted) → 6b19e72 (FAIL, legacy crash)
verdict: standard-fail

## ⚠ The defect in this commit came from an error in MY OWN a3 prescription

Own it up front so the next seat does not misread the history. My a3 prescription said to guard the OVM blocks at
"**v<10, 11**, 12, …, 31". Those first two entries are wrong. I generated that list with a scanner that walked from
each `if (current && current.version < N)` line to the next one, so each block absorbed the *trailing comment
introducing the following migration*. The `v<10` block picked up `// Migration: v10 → v11: add overmind_workflows
table` and was misclassified as OVM. It is not — it is the **notes** migration. The implementer applied my list
faithfully. The defect is real and must be fixed, but it is not an implementer error.

## What this attempt got right

| carry-over | status | proof |
|---|---|---|
| a3 F1: legacy DBs below v31 crash on upgrade | **closed** | log [3] — v22/v24/v27/v28/v30/v31/v33/v36 all `OK -> v37`; `notes-migration.test.ts` green in log [2] |
| a3 F3: tautological parity specimen | **closed** | the spec now builds a genuine v22 fixture with explicit legacy DDL and no OVM tables — real second-path provenance |
| a3 F2: backup filename vs docs | **partly** | `plan.md:99` now says `<UTC>-<PID>.bak`; see Lens 4 |
| a2/a1: WAL backup, fail-closed, literals, temp dirs, committed work | **still closed** | focused row command 3/3 at the pristine commit; working tree clean and byte-identical to the commit |

## Lens 1: guard classification — **FAIL (2 misfires)**

Re-derived the OVM/non-OVM classification properly this time, excluding comment lines from each block body
(log [6]):

```
*** v<10 (line 179) GUARDED but body does NOT touch any OVM table  <-- MISFIRE
*** v<11 (line 206) GUARDED but body does NOT touch any OVM table  <-- MISFIRE
    v<12 … v<31  guarded, body touches OVM  (correct — 17 blocks)
```

**v<10** is `// Migration: v9 → v10: make notes.project_id nullable (recreate table)` at `src/db/database.ts:178-203`.
It rebuilds `notes` so `project_id` loses `NOT NULL`. OVM tables did not exist until v11, so a genuine v9 DB can
**never** satisfy `SELECT name FROM sqlite_master WHERE name='overmind_workflows'` — the guard skips the migration
exactly on the DBs it exists to serve.

Measured at the commit (log [4]):

```
version after upgrade    = {"version":37}
notes.project_id notnull = 1        (0 = nullable/correct, 1 = migration was SKIPPED)
insert note with NULL project_id -> REJECTED: NOT NULL constraint failed: notes.project_id
```

Same v9 DB at the B7 parent 251129b:

```
notes.project_id notnull = 0
insert note with NULL project_id -> OK — nullable project_id accepted
```

A silent functional regression: the DB upgrades "successfully" to v37 and then refuses every project-less note.
Silent divergence is worse than a3's loud crash, because nothing in the suite reports it.

**v<11** is the second misfire, but harmless: its whole body is `this.db.exec(SCHEMA_SQL)`, and `SCHEMA_SQL` is
already exec'd unconditionally at `database.ts:131` before any of these blocks. The condition is still wrong and
should come off.

## Lens 2: is that an A4 violation, or merely an unrelated bug? — **A4, directly** (log [5])

A4: "a **fresh** DB and an **upgraded** DB converge to the same schema."

```
fresh    : CREATE TABLE notes ( id INTEGER PRIMARY KEY, project_id INTEGER REFERENCES projects(id), …
upgraded : CREATE TABLE notes ( id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id), …
CONVERGE ? NO
```

The fresh and upgraded schemas differ in the DDL itself, which is exactly the clause the slice must satisfy. That is
why `failed_gate=A4` rather than A5 — the suites are green; the convergence property is not.

## Lens 3: why no test caught it — **root cause, PARTIAL**

The new v22 fixture is a genuine improvement and closes a3 F3, but 22 > 10, so it cannot reach either misfiring
block. Nothing in the suite constructs a DB below v11. The blast-radius probe I have been running since a3 also
started at v22. Both the specimen set and my own probe had the same floor, which is why two attempts' worth of
"legacy upgrade" checking missed a pre-v11 defect.

## Lens 4: `plan.md` is now internally inconsistent — **PARTIAL**

Line 99 (release boundary) now reads `data/agjassist.db.pre-ovm-drop-<UTC>-<PID>.bak`. Line 24 — the B7 slice row
in the same file — still says `<that-db-path>.pre-ovm-drop-<UTC>.bak` and `data/agjassist.db.pre-ovm-drop-<UTC>.bak`.
Half the rename landed. The brief's Scope block (copied from line 24) is likewise stale.

## Lens 5: the widened `normalizeSql` — **PARTIAL, not masking anything** (log [7])

The spec now rewrites any `CREATE TABLE <name>` to `CREATE TABLE <table>`, erasing the identifier. I tested three
normalizers against fresh-vs-v22-upgraded:

```
RAW     (no name handling): 1 difference  -> audit_log vs "audit_log"   (quoting left by the v36 rebuild+RENAME)
SHIPPED (name erased)     : IDENTICAL
STRICT  (name kept, unquoted only): IDENTICAL
```

So normalization is genuinely needed, and the shipped form is not hiding a divergence — `name` and `tbl_name` are
still compared as separate fingerprint fields, so table identity survives. It is simply broader than the artifact
requires. A nit, not a defect.

## Lens 6: the dead OVM tool — **PARTIAL, out of scope, escalated**

`tests/overmind-project-migration.test.ts` still fails via `src/tools/propose-overmind-projects.ts`. Outside B7's
scope line, already escalated by the implementer at `callbacks.md:66`. Not charged to this slice; A5 cannot close
until a slice owns it.

## Lens 7: real legacy DBs that DO carry OVM tables — **PASS**

`database.spec.ts` v23/v27/v31 fixtures include the OVM tables, so the guards evaluate true and every legacy OVM
migration still runs: 12/12 green. The guards do not disturb the path they were written for.
