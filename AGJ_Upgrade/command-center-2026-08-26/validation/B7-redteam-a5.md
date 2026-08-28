# B7 Validator Red-Team A5

commit: 78e8448e8dbf2da3570a37146e47c22d8c5d4709
history: 2973a9f (FAIL) → 2c15f52 (FAIL, uncommitted) → 6b19e72 (FAIL, legacy crash) → 7340cff (FAIL, overbroad guard)
verdict: **standard-clean → PASS**

## Criterion authority + chosen mechanism (unchanged note, still worth recording)

The brief again says "A4 — ⚠ NO CRITERION TEXT FOUND". A4 **does** exist at `og-requirements.md:45-47` and is
stronger than the scope line (it requires the timestamped backup be taken **first**). Judged against that real text,
as in every prior attempt. A4 states an outcome ("converge to the same schema") without a mechanism; the mechanism
used throughout this series is a **full `sqlite_master` fingerprint (type + name + whitespace-normalised `sql`,
tables AND indexes) between a fresh v37 DB and a true v36 DB built by the B7 parent commit's own code** — a
specimen whose provenance does not share the code under test.

Second brief-vs-repo drift: the brief's Scope block still quotes `pre-ovm-drop-<UTC>.bak`, while `plan.md:24` (from
which that block is generated) now correctly says `<UTC>-<PID>.bak`. The brief is rendered from an older plan.md
snapshot; the repo is right and the brief is stale.

## Every a4 finding closed, each verified independently

| a4 finding | status | proof |
|---|---|---|
| F1 `v<10` guard skipped the notes migration | **closed** | `database.ts:179` is back to `if (current && current.version < 10) {`; log [5] v9 → `notnull=0` |
| F2 `v<11` guard misfire | **closed** | `database.ts:206` reverted |
| F3 no fixture below v11 | **closed** | `createLegacyV9Fixture` + two discriminating assertions; mutation-tested below |
| F4 `plan.md` internally inconsistent | **closed** | both occurrences now `<UTC>-<PID>.bak`; zero stale `<UTC>.bak` left |
| F5 over-broad `normalizeSql` | **closed** | narrowed to exactly the strict form; log [9] confirms it still does real work |

## Lens 1: is the new v9 test a real test, or a restatement? — **PASS (mutation-tested)**

The standing contract says: "If you cannot say what would make your test FAIL, it is not a test yet." So I made it
fail. Re-introducing *exactly* the a4 defect (the `overmind_workflows` guard on the v9→v10 block) in a throwaway
worktree (log [3]):

```
× command-center migration B7 > upgrade from v9 makes notes.project_id nullable
  → expected 1 to be +0 // Object.is equality      (spec line 242)
```

It fails on the defect and passes without it. Both assertions compare against **literals** (`toBe(0)`, `not.toThrow`)
on a fixture the migration would not produce for itself — a v9 DB declaring `project_id INTEGER NOT NULL`. D-082
satisfied.

## Lens 2: guard classification, both directions — **PASS**

Re-derived with comment lines excluded from each block body (the exact scanner error that produced the a4 defect),
and checked the converse too — an OVM block left *unguarded* would reintroduce a3's crash (log [4]):

```
summary: 17 correctly-guarded OVM blocks, 0 misfires
```

No non-OVM block is guarded; no OVM block is unguarded.

## Lens 3: legacy upgrade behaviour vs the pre-B7 baseline — **PASS**

Ran the same 16 legacy fixtures (v1 … v36) against the commit and against the B7 parent 251129b, comparing upgrade
outcome, `notes.project_id` nullability, and survival of a seeded note row (log [5] vs [6]). **The two tables are
identical except the target version (v37 vs v36).** Specifically:

- v9 → `notnull=0`, note row survives — the a4 defect is fixed and the rebuild loses no data.
- v10…v36 → upgrade cleanly, note row survives at every version.
- v1/v5 throw (`no such table: reminders` / `personal_tasks`) **at the parent too** — an artifact of my minimal
  hand-written fixture omitting tables a real v1/v5 DB would have, not a B7 defect.
- v10+ showing `notnull=1` is likewise a fixture artifact and identical at the parent: the v9→v10 migration is
  version-gated, so a fixture that declares NOT NULL *at v10* was never eligible for it. A genuine v10 DB would
  already be nullable.

## Lens 4: A4 convergence at full fidelity — **PASS**

True v36 DB built by the parent commit's own code, upgraded by this commit, versus a fresh v37 DB, compared over
every `sqlite_master` table and index (log [8]):

```
upgraded objects = 81   fresh objects = 81
PRESENT ONLY IN UPGRADED (leftovers): []
PRESENT ONLY IN FRESH  (missing):     []
DDL TEXT DIFFERS:                     []
```

## Lens 5: live-path behaviour still intact — **PASS**

Neither of the two hard-won a1 properties regressed while the legacy guards were being reworked (log [7]):

- **WAL fidelity** — with 24,752 B stranded in an uncheckpointed `-wal`, the backup reads back
  `[{"slug":"precious-data"}]`.
- **Fail-closed** — with the backup target unwritable: constructor throws, `ovm_table_survived = true`,
  `version_left_at = 36`. Re-runnable, no data destroyed.

## Lens 6: `normalizeSql` — **PASS, and it earns its keep**

Three normalizers over fresh-vs-v22-upgraded (log [9]): RAW (no name handling) shows exactly one difference,
`audit_log` vs `"audit_log"` — the quoting SQLite leaves after the v36 rebuild+RENAME — while both the shipped
narrowed form and a name-preserving strict form are IDENTICAL. The normalizer resolves a real artifact and masks
nothing, and table identity still rides on the separate `name`/`tbl_name` fingerprint fields.

## Observations recorded, NOT charged against this slice

1. **The dead OVM tool.** `tests/overmind-project-migration.test.ts` still fails via
   `src/tools/propose-overmind-projects.ts:71,82`. Outside B7's scope line and correctly escalated by the
   implementer at `callbacks.md:66`. It is the sole remaining red in the sweep (62/63 pass). **A5 ("full unit +
   e2e suites green") cannot close until a slice owns it** — closing mechanism is deleting the tool together with
   its spec, since the feature it proposes projects for no longer exists.
2. **Fresh-vs-upgraded column ordering.** For tables migrated by ALTER (`users`, `projects`, `notes`), a
   hand-built legacy fixture upgrades to the same columns in a different *order* than a fresh DB declares them.
   Verified pre-existing: the B7 parent produces the same divergence set for the same fixture (plus
   `overmind_workflows`), so post-B7 the set is strictly smaller. Inherent to SQLite ALTER-based migration, not
   introduced here, and out of B7's scope.
