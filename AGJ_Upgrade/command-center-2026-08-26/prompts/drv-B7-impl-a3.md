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

# [driver] B7 CORRECTION (attempt 3) — fix EVERY finding the validator listed

The independent validator FAILed B7: defect_class=FIX_LEFT_UNCOMMITTED gate=None.
**Validator's callback summary:** [projcore callback] validator B7 STATUS: DONE — FAIL src fix left UNCOMMITTED; commit still copyFileSync, own WAL test + 3 mcp tests fail

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
# B7 attempt 2 — FAIL prescription

commit judged: 2c15f5242e220d14e2200da250922e6d5cdab620 (attempt-1 commit was 2973a9f)
**6 findings, fix in this order. Finding 1 is 90% of it and takes one command.**

Read this first, before anything else:

> **The fix is already written. It is sitting UNCOMMITTED in the working tree. It was never committed, so the gate
> never saw it.** `git status --porcelain` shows ` M src/db/database.ts` and ` M tests/mcp-migration.test.ts`.
> `git diff 2973a9f..2c15f52 -- src/db/database.ts` is EMPTY — the implementation the gate judged is byte-identical
> to the one that already FAILed at attempt 1. Do not rewrite it. **Commit it.**

Also note: running the row command from the repo root **passes 3/3 and is lying to you** — the dirty working tree
carries the fix. It fails in a pristine worktree at the commit. Before reporting DONE, verify with:
`git stash list; git status --porcelain` and re-run in `git worktree add /tmp/verify <your-sha>`.

Criterion authority: the brief again claims "A4 — NO CRITERION TEXT FOUND". A4 exists at `og-requirements.md:45-47`
and requires the timestamped backup be taken **first** — an ordering guarantee, not a best-effort attempt. That real
text is the contract used here. (The brief's metric template also still says `attempt=1` on an attempt-2 brief.)

---

FINDING 1 of 6
WHAT FAILED: The slice's own focused row command fails at the commit — log `B7-vitest-a2.log` section [2],
`focused_exit_at_commit=1`:
`× upgrade from v36 backs up DB and drops OVM tables with WAL content captured → SqliteError: no such table:
overmind_projects` at `tests/unit/command-center-migration.spec.ts:97`. The committed `src/db/database.ts:855-866`
still holds attempt 1's `fs.copyFileSync(this.dbPath, backupPath)` inside a swallowing `catch {}`, so the backup the
new test reads back contains none of the OVM data (a1 Findings 2 and 3, unchanged).
THE FIX: commit the working-tree version of `src/db/database.ts`, which already contains exactly the right change:
```ts
this.db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size === 0) {
  throw new Error(`v37 OVM drop aborted: pre-drop backup ${backupPath} was not written`);
}
```
Concretely: `git add src/db/database.ts && git commit`. Verified against this exact working-tree content — the
focused row command then passes 3/3 (log section [5], `focused_exit_working_tree=0`).
WHY THE LAST ATTEMPT MISSED IT: the work was done but left unstaged, and the row command was run in the dirty repo
root where it passes, so nothing contradicted a DONE report.

FINDING 2 of 6
WHAT FAILED: `tests/mcp-migration.test.ts` still fails 3 tests at the commit — `expected 37 to be 36` at `:247`
(two assertions), `:296`, `:315` (log section [3], `regression_exit_at_commit=1`). a1 Finding 1a is fixed in the
working tree but, like Finding 1, was never committed.
THE FIX: `git add tests/mcp-migration.test.ts` and commit it in the same commit as Finding 1. The pending diff is
already correct — four `toBe(36)` → `toBe(37)` literal edits, kept as literals rather than `toBe(SCHEMA_VERSION)`,
which is what D-082 requires. Verified: the file then passes 3/3.
WHY THE LAST ATTEMPT MISSED IT: same unstaged-file cause as Finding 1.

FINDING 3 of 6
WHAT FAILED: `tests/overmind-project-migration.test.ts` fails at the commit AND in the working tree —
`SqliteError: no such table: overmind_workflows` via `insertWorkflow` at `:230`. `src/tools/propose-overmind-
projects.ts:71,82` still queries the dropped table. a1 Finding 1c asked for this to be left alone (it is outside
B7's scope line) but **reported to the coordinator**; the implementer callback (`callbacks.md:63`) contains no such
report.
THE FIX: still do NOT edit the tool inside B7 — it is out of scope. Add one line to the B7 implementer callback
naming it, e.g. `NOTE: src/tools/propose-overmind-projects.ts + tests/overmind-project-migration.test.ts query the
dropped overmind_workflows table; unowned A-series leftover, needs a slice.` The mechanism that closes it later is
deleting the tool and its spec together, since the feature it proposes projects for no longer exists.
WHY THE LAST ATTEMPT MISSED IT: the a1 prescription's "report it" instruction had no artifact to write to, so it
evaporated.

FINDING 4 of 6
WHAT FAILED: Not yet failing — an edge in the pending `VACUUM INTO` change, worth closing before it lands.
`VACUUM INTO` **refuses a destination that already exists**: verified — a second call to the same path throws
`output file already exists`. The backup name has one-second granularity
(`new Date().toISOString().replace(/[-:T]/g,'').slice(0,14)` → `YYYYMMDDHHMMSS`), so two upgrades of the *same* DB
path within one second abort the migration. With the fail-closed throw this now takes the app down rather than
being silently swallowed.
THE FIX: make the destination unique instead of second-granular, or tolerate collision explicitly. Cheapest
mechanism that keeps the `<UTC>` name the scope asks for: keep the timestamp and append `process.pid` —
`` `${this.dbPath}.pre-ovm-drop-${utc}-${process.pid}.bak` `` — or, if the literal
`data/agjassist.db.pre-ovm-drop-<UTC>.bak` shape is required for G2, guard with
`if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath)` immediately before the `VACUUM INTO`. Do not widen the
catch back out — the fail-closed throw is the correct behaviour for a real backup failure.
WHY THE LAST ATTEMPT MISSED IT: the a1 prescription named `VACUUM INTO` without noting its destination-exists rule.

FINDING 5 of 6
WHAT FAILED: `tests/unit/command-center-migration.spec.ts:100-127` builds its "v36" parity specimen by creating a
**fresh v37 DB**, then `UPDATE schema_version SET version = 36` plus re-adding the three OVM tables. Both sides of
`expect(upgradedFp).toEqual(freshFp)` therefore come from the same `SCHEMA_SQL` constant, so the comparison is
near-tautological for every non-OVM object — it proves OVM leftovers are gone (real value) but cannot catch a
migration that fails to bring a genuine v36 DB up to the fresh shape. NOT a live defect: attempt 1's probe proved
true convergence on a real v36 DB (81 vs 81 objects, no DDL differences). The fingerprint itself
(`type IN ('table','index')` + normalised SQL) is correct and satisfies a1 Finding 5.
THE FIX: give the upgraded side a provenance the fresh side does not share. Cheapest mechanism that stays inside a
unit test: build the v36 specimen from the **hand-written fixture pattern already in `tests/mcp-migration.test.ts`**
(`createFixture(path, 34)` — explicit CREATE TABLE statements for the old shape, not a downgraded fresh DB), seeded
at version 36. If that is too much surface for this slice, leave the test as-is and say so in the callback — it is
a rigour gap, not a defect, and it should not cost an attempt.
WHY THE LAST ATTEMPT MISSED IT: "build a realistic v36 schema" was read as "make the specimen look like v36" rather
than "make the specimen come from somewhere other than the code under test".

FINDING 6 of 6
WHAT FAILED: `tests/unit/database.spec.ts:120, 155, 210, 266` declare `const path = tempDb("test-db.sqlite")` inside
test bodies, shadowing the `import path from "node:path"` at line 5. It passes today only because none of those four
bodies calls `path.join` afterwards.
THE FIX: rename the local to `dbPath` at all four sites — `const dbPath = tempDb("test-db.sqlite")` and update the
`new DatabaseService(...)` / `new Database(...)` call in each body. Purely mechanical, no behaviour change.
WHY THE LAST ATTEMPT MISSED IT: introduced while moving these tests onto temp dirs for a1 Finding 6; the tests pass,
so nothing surfaced it.
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
