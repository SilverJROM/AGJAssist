# G2 attempt 1 — validator red-team record (VERDICT: PASS)

commit under test: 6c26334bcfb0b7b3a8c8b97044938b2844965e08
No FAIL prescription file (`G2-fix-a1.md`) is written: every Scope clause is met.
The items below are HARDENING OBSERVATIONS on a passing slice, plus two findings that
do NOT belong to G2. None of them blocks the gate.

## Scope clauses — all verified by execution, not by reading

| # | Scope clause | How verified | Result |
|---|---|---|---|
| 1 | `scripts/release-command-center.mjs` added | on disk, matches commit byte-for-byte | PASS |
| 2 | default is `--dry-run` | ran with no args → dry-run branch | PASS |
| 3 | requires green B8,C6,D7,E5,F7 | `markerIds` literal == the five ids; all five markers exist | PASS |
| 4 | builds | `npm run build` invoked inside the run, exit 0 | PASS |
| 5 | migrates a `DB_PATH` COPY | ran against a scratch DB: temp copy migrated, source sha256 unchanged | PASS |
| 6 | prints backup path + `git reset --hard <pre-release-sha>` + DB restore | all three lines observed in real output | PASS |
| 7 | `--execute` gated by TTY **AND** phrase **AND** no `TILLER_*` | three AND-composed checks, all fail-closed | PASS |
| 8 | tiller marker ⇒ hard refuse, non-zero, 0 DB writes, 0 pm2 | guard is the FIRST statement after arg parse — before phrase, markers, build, DB open | PASS |
| 9 | spec proves the refusal | mutation-tested, see below | PASS |

Dry-run evidence (scratch DB, live DB never targeted):
```
[release-command-center] backup: .../agjassist.db.pre-release-20260828203907615.bak
[release-command-center] rollback code: git reset --hard 6c26334bcfb0b7b3a8c8b97044938b2844965e08
[release-command-center] rollback database: cp <backup> <source>
[release-command-center] DRY RUN passed; a temporary DB copy was migrated.
```
Backup fidelity checked: the `.bak` opens, reports schema_version 39 and the same 44 tables
as the source, and reproduces the source's pre-existing `integrity_check` note verbatim
("Page 843: never used") — i.e. it is a faithful, restorable copy. `better-sqlite3`'s
`.backup()` (online backup API) is the correct mechanism here; a `copyFileSync` would have
silently dropped WAL content, since this DB runs `journal_mode = WAL`.

## Test discrimination (north D-082) — mutation-proven, not asserted

The expected values are LITERALS and a second-path fixture (a sha256 computed by the test
over the DB file, independent of the script). Nothing is asked of the mechanism under test.

* **Mutant A** — deleted ONLY the tiller-env refusal, left the TTY gate:
  script still exits non-zero (TTY error) but the test **FAILS**:
  `expected '[release-command-center] --execute re…' to contain 'refused from a tiller or agent enviro…'`.
  This is the important result: the test is not satisfied by "some non-zero exit", it
  discriminates the specific guard.
* **Mutant B** — deleted BOTH the tiller-env refusal and the TTY/phrase gate:
  `--execute` ran to completion, test **FAILS** at `expect(result.status).not.toBe(0)`.

Both mutations were reverted; the four files under test are byte-identical to the commit
and `data/agjassist.db` is unchanged (sha256 ec96f4b7…) after every experiment.

## Observations (hardening — NOT gate failures)

**O1 — one of the three AC assertions cannot bite under the prescribed runner.**
`cc-run-isolated.mjs` sets `DB_PATH` to a temp copy, and the spec spreads `...process.env`
into the child. Mutant B — a completely unguarded `--execute` — still left
`data/agjassist.db` byte-identical, so `expect(fingerprint(liveDb)).toBe(before)` is
vacuous in this harness. It is live under a bare `npx vitest run` (DB_PATH unset), and the
redirection is a *safety* property of the runner, so this is belt-and-braces rather than a
false pass — the AC's "DB untouched" claim is carried by guard ordering + the message
assertion, both of which are mutation-proven. Mechanism if it is ever tightened: point the
child at a *disposable* `DB_PATH` the test itself creates and fingerprint THAT file, so the
assertion has something it can actually observe being written.

**O2 — `printRollback` runs after the destructive step in `execute()`.**
Order is `backupDatabase → migrateDatabase → pm2 restart → printRollback`. If `pm2 restart`
throws, the operator has an already-migrated live DB and never sees the backup path — which
is timestamped to the millisecond and therefore not guessable, only `ls`-able. `dryRun` has
the same shape: a failing migrate leaves an orphan `.bak` next to the live DB, unannounced.
Mechanism: call `printRollback` (or at minimum log the backup path) immediately after
`backupDatabase` returns, not at the end of the happy path.

**O3 — the printed DB rollback is unsafe for a WAL database.**
`cp <backup> <source>` is printed bare, but this DB runs in WAL mode: `-wal`/`-shm`
sidecars sit next to it (I watched them be created by the readonly open), and after
`pm2 restart` the app holds the DB open. Replacing the main file under a live connection
with stale sidecars present is undefined behaviour. Mechanism: print
`pm2 stop agjassist && cp <backup> <source> && rm -f <source>-wal <source>-shm && pm2 start agjassist`.

## Findings that are NOT G2's

**N1 — PLAN_DEFECT: A4/A5 do not describe G2's Scope.**
A4 is the overmind-teardown migration (drop tables, converge fresh vs upgraded, bump
SCHEMA_VERSION); A5 is post-teardown app boot + full green suites. G2 adds a *release
script*. Both criteria are stamped run-wide (they also appear on A0, B7, F8, G1 briefs), so
this is AC attachment, not a criterion the implementer built toward wrongly — the
implementer correctly built to the Scope paragraph. Recording it per the brief's
instruction rather than judging G2 against another slice's contract.

**N2 — A4's convergence clause is NOT met on real data (belongs to B7, not G2).**
Surfaced by exercising G2's own dry-run mechanism. A fresh DB and a migrated copy of the
live DB do NOT converge:
```
fresh ver=39 tables=41 | upgraded ver=39 tables=44
only in FRESH   : (none)
only in UPGRADED: overmind_shadow_snapshots,
                  overmind_terminal_notification_receipts,
                  overmind_terminal_receipts
```
The migration drops the three tables A4 names by hand (`overmind_projects`,
`overmind_workflows`, `overmind_task_history`) but not these three overmind-only tables,
which no fresh DB ever creates. A4's literal text names only three tables "+ any
overmind-only columns", so the drop list was written to the letter of the AC and the AC
under-specified. This does not affect G2's verdict; it should be routed to whoever owns A4.
