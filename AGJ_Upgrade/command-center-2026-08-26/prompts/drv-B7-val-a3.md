# [driver] B7 — THE COMMIT UNDER TEST IS `6b19e7245ae0a34a574a199590515125a3e43863`

Analyse EXACTLY that commit: `git show 6b19e7245ae0a34a574a199590515125a3e43863`, `git diff 6b19e7245ae0a34a574a199590515125a3e43863^..6b19e7245ae0a34a574a199590515125a3e43863`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=6b19e7245ae0a34a574a199590515125a3e43863`.

## The change under test (produced by the driver, not reported by the implementer)
```
[B7] commit VACUUM INTO backup, mcp version bump, rename path var


 src/db/database.ts          |  9 ++++-----
 tests/mcp-migration.test.ts |  8 ++++----
 tests/unit/database.spec.ts | 24 ++++++++++++------------
 3 files changed, 20 insertions(+), 21 deletions(-)
```
```diff
diff --git a/src/db/database.ts b/src/db/database.ts
index 93e8685..3d48c78 100644
--- a/src/db/database.ts
+++ b/src/db/database.ts
@@ -855,11 +855,10 @@ export class DatabaseService {
       // Migration: v36 → v37: remove OVM tables, backup before drop
       if (current && current.version < 37) {
         const utc = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
-        const backupPath = `${this.dbPath}.pre-ovm-drop-${utc}.bak`;
-        try {
-          fs.copyFileSync(this.dbPath, backupPath);
-        } catch {
-          // backup failure is non-fatal for isolated tests; live path is G2 execute-only
+        const backupPath = `${this.dbPath}.pre-ovm-drop-${utc}-${process.pid}.bak`;
+        this.db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
+        if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size === 0) {
+          throw new Error(`v37 OVM drop aborted: pre-drop backup ${backupPath} was not written`);
         }
         this.db.exec("DROP TABLE IF EXISTS overmind_task_history");
         this.db.exec("DROP TABLE IF EXISTS overmind_workflows");
diff --git a/tests/mcp-migration.test.ts b/tests/mcp-migration.test.ts
index c4c3483..f2406ac 100644
--- a/tests/mcp-migration.test.ts
+++ b/tests/mcp-migration.test.ts
@@ -244,8 +244,8 @@ describe("MCP schema v36 migration parity", () => {
         );
       }
 
-      expect(schemaVersion(fresh)).toBe(36);
-      expect(schemaVersion(upgraded)).toBe(36);
+      expect(schemaVersion(fresh)).toBe(37);
+      expect(schemaVersion(upgraded)).toBe(37);
       expect(
         upgraded.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'terminal_groups'").get()
       ).toEqual({ name: "terminal_groups" });
@@ -293,7 +293,7 @@ describe("MCP schema v36 migration parity", () => {
 
     const reopened = new DatabaseService(dbPath);
     try {
-      expect(schemaVersion(reopened)).toBe(36);
+      expect(schemaVersion(reopened)).toBe(37);
       expect(relevantSchemaFingerprint(reopened.raw)).toEqual(before);
       expect(reopened.prepare("SELECT * FROM audit_log ORDER BY id").all()).toEqual(auditBefore);
       expect(reopened.raw.pragma("foreign_key_check")).toEqual([]);
@@ -312,7 +312,7 @@ describe("MCP schema v36 migration parity", () => {
         .prepare("SELECT sql, rootpage FROM sqlite_master WHERE type = 'table' AND name = 'audit_log'")
         .get() as { sql: string; rootpage: number };
 
-      expect(schemaVersion(upgraded)).toBe(36);
+      expect(schemaVersion(upgraded)).toBe(37);
       expect(auditEntry.sql).toBe(fixture.auditSql);
       expect(auditEntry.rootpage).toBe(fixture.auditRootPage);
       expect(upgraded.prepare("SELECT * FROM audit_log ORDER BY id").all()).toEqual(fixture.auditRows);
diff --git a/tests/unit/database.spec.ts b/tests/unit/database.spec.ts
index 1a80c2d..61c0cdd 100644
--- a/tests/unit/database.spec.ts
+++ b/tests/unit/database.spec.ts
@@ -117,12 +117,12 @@ describe("DatabaseService", () => {
 
   it("is idempotent on re-open", () => {
     // cleanup removed; temp dirs handled by afterEach
-    const path = tempDb("test-db.sqlite");
-    const db1 = new DatabaseService(path);
+    const dbPath = tempDb("test-db.sqlite");
+    const db1 = new DatabaseService(dbPath);
     db1.ensureOwner(123);
     db1.close();
 
-    const db2 = new DatabaseService(path);
+    const db2 = new DatabaseService(dbPath);
     const users = db2.prepare("SELECT * FROM users").all();
     expect(users.length).toBe(1);
     db2.close();
@@ -152,8 +152,8 @@ describe("DatabaseService", () => {
 
   it("upgrades a v23 snapshot DB to current and drops overmind tables", () => {
     // cleanup removed; temp dirs handled by afterEach
-    const path = tempDb("test-db.sqlite");
-    const raw = new Database(path);
+    const dbPath = tempDb("test-db.sqlite");
+    const raw = new Database(dbPath);
     raw.exec(`
       CREATE TABLE schema_version (version INTEGER NOT NULL);
       INSERT INTO schema_version (version) VALUES (23);
@@ -195,7 +195,7 @@ describe("DatabaseService", () => {
     `);
     raw.close();
 
-    const upgraded = new DatabaseService(path);
+    const upgraded = new DatabaseService(dbPath);
     const version = upgraded.prepare("SELECT version FROM schema_version").get() as { version: number };
     expect(version.version).toBe(37);
     const tables = upgraded.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
@@ -207,8 +207,8 @@ describe("DatabaseService", () => {
 
   it("upgrades a v31 DB to current with agent tables and leaves existing project rows intact", () => {
     // cleanup removed; temp dirs handled by afterEach
-    const path = tempDb("test-db.sqlite");
-    const raw = new Database(path);
+    const dbPath = tempDb("test-db.sqlite");
+    const raw = new Database(dbPath);
     raw.exec(`
       PRAGMA foreign_keys = ON;
       CREATE TABLE schema_version (version INTEGER NOT NULL);
@@ -227,7 +227,7 @@ describe("DatabaseService", () => {
     `);
     raw.close();
 
-    const upgraded = new DatabaseService(path);
+    const upgraded = new DatabaseService(dbPath);
     const version = upgraded.prepare("SELECT version FROM schema_version").get() as { version: number };
     expect(version.version).toBe(37);
 
@@ -263,8 +263,8 @@ describe("DatabaseService", () => {
 
   it("upgrades v27 DB and drops overmind tables", () => {
     // cleanup removed; temp dirs handled by afterEach
-    const path = tempDb("test-db.sqlite");
-    const raw = new Database(path);
+    const dbPath = tempDb("test-db.sqlite");
+    const raw = new Database(dbPath);
     raw.exec(`
       PRAGMA foreign_keys = ON;
       CREATE TABLE schema_version (version INTEGER NOT NULL);
@@ -347,7 +347,7 @@ describe("DatabaseService", () => {
     `);
     raw.close();
 
-    const upgraded = new DatabaseService(path);
+    const upgraded = new DatabaseService(dbPath);
     const version = upgraded.prepare("SELECT version FROM schema_version").get() as { version: number };
     expect(version.version).toBe(37);
 
```

# tiller validator — standing contract
(This section is identical in every validator brief. Your specific work is in THE SLICE below.)
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.

You are the VALIDATOR. **Write NO product code** (verifier != fixer). You judge, independently.

---

# THE SLICE — B7 (run command-center-2026-08-26)

## Scope (do ONLY this)
RELEASE-ATOMIC schema layer: bump `SCHEMA_VERSION`, remove OVM DDL, and on upgrade copy the DB being migrated to `<that-db-path>.pre-ovm-drop-<UTC>.bak` before dropping `overmind_projects`, `overmind_workflows`, `overmind_task_history`. Prove fresh-vs-upgrade parity only on temp copies. Live path `data/agjassist.db.pre-ovm-drop-<UTC>.bak` is G2 execute-only. Isolated runner tears down the temp DB.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **A4** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`node scripts/cc-run-isolated.mjs --slice B7 -- npx vitest run tests/unit/command-center-migration.spec.ts --minWorkers=1 --maxWorkers=4`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=B7 attempt=1 role=validator
  marker=DRV-B7-24 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate B7 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator B7 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/B7-fix-a3.md`** (absolute — do NOT resolve it against your cwd) before your callback.
**One block per finding that is NOT A CLEAN PASS — including PARTIAL. If N things failed or partially failed, write N blocks** — numbered, in the order you would fix them. Do NOT collapse them to the most important one. Only a lens that passed CLEANLY gets no block:
```
FINDING 1 of <N>
WHAT FAILED: <the specific assertion/behaviour, and where>
THE FIX: <the concrete change that would make this pass>
WHY THE LAST ATTEMPT MISSED IT: <one line, optional>

FINDING 2 of <N>
WHAT FAILED: ...
THE FIX: ...
```
**A finding you leave out can cost a FULL ATTEMPT CYCLE to rediscover** — an implementer turn, a validator turn and the callback latency — to learn something already written on disk. A strong seat sometimes infers past the omission; do not rely on the next seat being that seat. The gate id below stays singular because it names ONE gate; your prescription must not.
**NAME A MECHANISM, NOT AN OUTCOME.** A call, a path, a specimen, a structure, a flag — not the property the change should have. *"Tests must fail when the clause is violated"* is an OUTCOME and is worth nothing to the next seat; *"the negative specimen's NAME must contradict its shape"* is a mechanism and closed the slice. That distinction is not stylistic: a slice spent FOUR attempts each inventing a different mechanism for one question — zero-arg call, bytecode scan, object() sentinel, MagicMock sentinel — while the fix sat unwritten, and closed on the first attempt that had it. **The next implementer sees this file VERBATIM and sees your callback line only as a summary; if the fix is not in the file, it does not reach them.**
`[VERDICT-V1] run=command-center-2026-08-26 batch=B7 attempt=3 marker=DRV-B7-24 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
