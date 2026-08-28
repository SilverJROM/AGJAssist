# [driver] B7 — THE COMMIT UNDER TEST IS `2c15f5242e220d14e2200da250922e6d5cdab620`

Analyse EXACTLY that commit: `git show 2c15f5242e220d14e2200da250922e6d5cdab620`, `git diff 2c15f5242e220d14e2200da250922e6d5cdab620^..2c15f5242e220d14e2200da250922e6d5cdab620`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=2c15f5242e220d14e2200da250922e6d5cdab620`.

## The change under test (produced by the driver, not reported by the implementer)
```
[B7] fix fingerprint parity test and TEST_DB bug


 tests/unit/command-center-migration.spec.ts | 134 +++++++++++++---------
 tests/unit/database.spec.ts                 | 166 ++++++++++------------------
 2 files changed, 141 insertions(+), 159 deletions(-)
```
```diff
diff --git a/tests/unit/command-center-migration.spec.ts b/tests/unit/command-center-migration.spec.ts
index 014a7e2..3688998 100644
--- a/tests/unit/command-center-migration.spec.ts
+++ b/tests/unit/command-center-migration.spec.ts
@@ -1,50 +1,56 @@
 import { describe, it, expect, afterEach } from "vitest";
 import { DatabaseService } from "../../src/db/database.js";
 import fs from "node:fs";
+import os from "node:os";
 import path from "node:path";
 import Database from "better-sqlite3";
 
-const TEST_DB = path.join("data", "command-center-migration-test.sqlite");
+const tempDirs: string[] = [];
 
-function cleanup(): void {
-  for (const f of [
-    TEST_DB,
-    `${TEST_DB}-wal`,
-    `${TEST_DB}-shm`,
-  ]) {
-    if (fs.existsSync(f)) fs.unlinkSync(f);
-  }
-  // remove any backup files created during test
-  const files = fs.readdirSync(path.dirname(TEST_DB));
-  for (const f of files) {
-    if (f.startsWith(path.basename(TEST_DB) + ".pre-ovm-drop-")) {
-      fs.unlinkSync(path.join(path.dirname(TEST_DB), f));
-    }
+function tempDb(name: string): string {
+  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-cc-migration-"));
+  tempDirs.push(dir);
+  return path.join(dir, name);
+}
+
+afterEach(() => {
+  for (const dir of tempDirs.splice(0)) {
+    fs.rmSync(dir, { recursive: true, force: true });
   }
+});
+
+function normalizeSql(sql: string | null): string | null {
+  if (sql === null) return null;
+  return sql.replace(/\s+/g, " ").replace(/\s*([(),=])\s*/g, "$1").trim();
 }
 
-describe("command-center migration B7", () => {
-  afterEach(() => cleanup());
+function schemaFingerprint(db: Database.Database) {
+  const rows = db.prepare(
+    `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY type, name`
+  ).all() as Array<{ type: string; name: string; tbl_name: string | null; sql: string | null }>;
+  return rows.map(r => ({ ...r, sql: normalizeSql(r.sql) }));
+}
 
+describe("command-center migration B7", () => {
   it("fresh DB has schema version 37 and no OVM tables", () => {
-    cleanup();
-    const db = new DatabaseService(TEST_DB);
+    const dbPath = tempDb("fresh.sqlite");
+    const db = new DatabaseService(dbPath);
     const version = db.prepare("SELECT version FROM schema_version").get() as { version: number };
     expect(version.version).toBe(37);
 
-    const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
+    const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
     const names = tables.map(t => t.name);
     expect(names).not.toContain("overmind_projects");
     expect(names).not.toContain("overmind_workflows");
     expect(names).not.toContain("overmind_task_history");
-
     db.close();
   });
 
-  it("upgrade from v36 backs up DB and drops OVM tables", () => {
-    cleanup();
-    // create a v36 DB with OVM tables
-    const raw = new Database(TEST_DB);
+  it("upgrade from v36 backs up DB and drops OVM tables with WAL content captured", () => {
+    const dbPath = tempDb("upgrade.sqlite");
+    // create v36 DB with OVM tables, leave connection open to keep WAL uncheckpointed
+    const raw = new Database(dbPath);
+    raw.pragma("journal_mode = WAL");
     raw.exec(`
       CREATE TABLE schema_version (version INTEGER NOT NULL);
       INSERT INTO schema_version (version) VALUES (36);
@@ -66,9 +72,9 @@ describe("command-center migration B7", () => {
       INSERT INTO overmind_workflows (id, project_id) VALUES (1, 1);
       INSERT INTO overmind_task_history (id, coordinator_session) VALUES (1, 's1');
     `);
-    raw.close();
+    // keep raw open so changes may sit in WAL
 
-    const db = new DatabaseService(TEST_DB);
+    const db = new DatabaseService(dbPath);
     const version = db.prepare("SELECT version FROM schema_version").get() as { version: number };
     expect(version.version).toBe(37);
 
@@ -78,42 +84,66 @@ describe("command-center migration B7", () => {
     expect(names).not.toContain("overmind_workflows");
     expect(names).not.toContain("overmind_task_history");
 
-    // backup file should exist as sibling
-    const dir = path.dirname(TEST_DB);
-    const base = path.basename(TEST_DB);
+    // find backup file created as sibling
+    const dir = path.dirname(dbPath);
+    const base = path.basename(dbPath);
     const backups = fs.readdirSync(dir).filter(f => f.startsWith(base + ".pre-ovm-drop-") && f.endsWith(".bak"));
     expect(backups.length).toBeGreaterThan(0);
+    const backupPath = path.join(dir, backups[0]);
+    expect(fs.statSync(backupPath).size).toBeGreaterThan(0);
 
+    // verify backup contains the OVM rows via independent readonly connection
+    const bak = new Database(backupPath, { readonly: true });
+    const proj = bak.prepare("SELECT slug FROM overmind_projects ORDER BY id").all() as Array<{ slug: string }>;
+    expect(proj).toEqual([{ slug: "p1" }]);
+    const wf = bak.prepare("SELECT id FROM overmind_workflows ORDER BY id").all() as Array<{ id: number }>;
+    expect(wf).toEqual([{ id: 1 }]);
+    const th = bak.prepare("SELECT coordinator_session FROM overmind_task_history ORDER BY id").all() as Array<{ coordinator_session: string }>;
+    expect(th).toEqual([{ coordinator_session: "s1" }]);
+    bak.close();
+
+    raw.close();
     db.close();
   });
 
-  it("fresh and upgraded DB have same table set excluding OVM", () => {
-    cleanup();
-    // fresh
-    const freshDbPath = path.join("data", "command-center-fresh.sqlite");
-    if (fs.existsSync(freshDbPath)) fs.unlinkSync(freshDbPath);
-    const fresh = new DatabaseService(freshDbPath);
-    const freshTables = fresh.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
+  it("fresh and upgraded DB converge to same schema fingerprint", () => {
+    const freshPath = tempDb("fresh.sqlite");
+    const fresh = new DatabaseService(freshPath);
+    const freshFp = schemaFingerprint(fresh.raw);
     fresh.close();
-    fs.unlinkSync(freshDbPath);
 
-    // upgraded
-    const raw = new Database(TEST_DB);
+    const upgradePath = tempDb("upgrade.sqlite");
+    // Build a realistic v36 DB by creating a fresh DB then downgrading version and adding OVM tables
+    const tmp = new DatabaseService(upgradePath);
+    tmp.close();
+    const raw = new Database(upgradePath);
+    raw.pragma("journal_mode = WAL");
+    raw.exec("UPDATE schema_version SET version = 36");
     raw.exec(`
-      CREATE TABLE schema_version (version INTEGER NOT NULL);
-      INSERT INTO schema_version (version) VALUES (36);
-      CREATE TABLE overmind_projects (id INTEGER PRIMARY KEY);
-      CREATE TABLE overmind_workflows (id INTEGER PRIMARY KEY);
-      CREATE TABLE overmind_task_history (id INTEGER PRIMARY KEY);
+      CREATE TABLE IF NOT EXISTS overmind_projects (
+        id INTEGER PRIMARY KEY,
+        slug TEXT UNIQUE NOT NULL,
+        app_path TEXT UNIQUE NOT NULL,
+        parent_session TEXT NOT NULL
+      );
+      CREATE TABLE IF NOT EXISTS overmind_workflows (
+        id INTEGER PRIMARY KEY,
+        project_id INTEGER
+      );
+      CREATE TABLE IF NOT EXISTS overmind_task_history (
+        id INTEGER PRIMARY KEY,
+        coordinator_session TEXT NOT NULL
+      );
     `);
-    raw.close();
-    const upgraded = new DatabaseService(TEST_DB);
-    const upgradedTables = upgraded.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
+    raw.exec(`INSERT INTO overmind_projects VALUES (1, 'p1', '/a', 's1');`);
+    raw.exec(`INSERT INTO overmind_workflows VALUES (1, 1);`);
+    raw.exec(`INSERT INTO overmind_task_history VALUES (1, 's1');`);
+    // keep raw open for WAL realism, but we will close after upgrade
+    const upgraded = new DatabaseService(upgradePath);
+    const upgradedFp = schemaFingerprint(upgraded.raw);
     upgraded.close();
+    raw.close();
 
-    const freshNames = freshTables.map(t => t.name);
-    const upgradedNames = upgradedTables.map(t => t.name);
-    expect(upgradedNames).toEqual(freshNames);
-    cleanup();
+    expect(upgradedFp).toEqual(freshFp);
   });
 });
diff --git a/tests/unit/database.spec.ts b/tests/unit/database.spec.ts
index 9f087d0..1a80c2d 100644
--- a/tests/unit/database.spec.ts
+++ b/tests/unit/database.spec.ts
@@ -1,23 +1,29 @@
 import { describe, it, expect, afterEach } from "vitest";
 import { DatabaseService } from "../../src/db/database.js";
 import fs from "node:fs";
+import os from "node:os";
 import path from "node:path";
 import Database from "better-sqlite3";
 
-const TEST_DB = path.join("data", "test-db.sqlite");
+const tempDirs: string[] = [];
 
-function cleanup(): void {
-  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
-    if (fs.existsSync(f)) fs.unlinkSync(f);
-  }
+function tempDb(name: string): string {
+  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-db-test-"));
+  tempDirs.push(dir);
+  return path.join(dir, name);
 }
 
+afterEach(() => {
+  for (const dir of tempDirs.splice(0)) {
+    fs.rmSync(dir, { recursive: true, force: true });
+  }
+});
+
 describe("DatabaseService", () => {
-  afterEach(() => cleanup());
 
   it("creates database with all tables", () => {
-    cleanup();
-    const db = new DatabaseService(TEST_DB);
+    // cleanup removed; temp dirs handled by afterEach
+    const db = new DatabaseService(tempDb("test-db.sqlite"));
 
     const tables = db.raw
       .prepare(
@@ -48,16 +54,16 @@ describe("DatabaseService", () => {
   });
 
   it("enables WAL mode", () => {
-    cleanup();
-    const db = new DatabaseService(TEST_DB);
+    // cleanup removed; temp dirs handled by afterEach
+    const db = new DatabaseService(tempDb("test-db.sqlite"));
     const result = db.raw.pragma("journal_mode") as { journal_mode: string }[];
     expect(result[0].journal_mode).toBe("wal");
     db.close();
   });
 
   it("seeds default safety patterns", () => {
-    cleanup();
-    const db = new DatabaseService(TEST_DB);
+    // cleanup removed; temp dirs handled by afterEach
+    const db = new DatabaseService(tempDb("test-db.sqlite"));
     const patterns = db
       .prepare("SELECT * FROM safety_patterns")
       .all() as { pattern: string }[];
@@ -69,19 +75,19 @@ describe("DatabaseService", () => {
   });
 
   it("tracks schema version", () => {
-    cleanup();
-    const db = new DatabaseService(TEST_DB);
+    // cleanup removed; temp dirs handled by afterEach
+    const db = new DatabaseService(tempDb("test-db.sqlite"));
     const version = db
       .prepare("SELECT version FROM schema_version")
       .get() as { version: number };
 
-    expect(version.version).toBe(36);
+    expect(version.version).toBe(37);
     db.close();
   });
 
   it("fresh DB accepts audit_log surface mcp and rejects an unknown surface", () => {
-    cleanup();
-    const db = new DatabaseService(TEST_DB);
+    // cleanup removed; temp dirs handled by afterEach
+    const db = new DatabaseService(tempDb("test-db.sqlite"));
     db.prepare(
       "INSERT INTO audit_log (action_type, surface) VALUES (?, ?)"
     ).run("mcp_test", "mcp");
@@ -96,8 +102,8 @@ describe("DatabaseService", () => {
   });
 
   it("creates owner user via ensureOwner", () => {
-    cleanup();
-    const db = new DatabaseService(TEST_DB);
+    // cleanup removed; temp dirs handled by afterEach
+    const db = new DatabaseService(tempDb("test-db.sqlite"));
     db.ensureOwner(123456);
 
     const user = db
@@ -110,20 +116,21 @@ describe("DatabaseService", () => {
   });
 
   it("is idempotent on re-open", () => {
-    cleanup();
-    const db1 = new DatabaseService(TEST_DB);
+    // cleanup removed; temp dirs handled by afterEach
+    const path = tempDb("test-db.sqlite");
+    const db1 = new DatabaseService(path);
     db1.ensureOwner(123);
     db1.close();
 
-    const db2 = new DatabaseService(TEST_DB);
+    const db2 = new DatabaseService(path);
     const users = db2.prepare("SELECT * FROM users").all();
     expect(users.length).toBe(1);
     db2.close();
   });
 
   it("creates projects table with active column", () => {
-    cleanup();
-    const db = new DatabaseService(TEST_DB);
+    // cleanup removed; temp dirs handled by afterEach
+    const db = new DatabaseService(tempDb("test-db.sqlite"));
 
     const cols = db.raw.pragma("table_info(projects)") as { name: string }[];
     const colNames = cols.map(c => c.name);
@@ -133,8 +140,8 @@ describe("DatabaseService", () => {
   });
 
   it("creates personal_tasks table with completed_at column", () => {
-    cleanup();
-    const db = new DatabaseService(TEST_DB);
+    // cleanup removed; temp dirs handled by afterEach
+    const db = new DatabaseService(tempDb("test-db.sqlite"));
 
     const cols = db.raw.pragma("table_info(personal_tasks)") as { name: string }[];
     const colNames = cols.map(c => c.name);
@@ -143,9 +150,10 @@ describe("DatabaseService", () => {
     db.close();
   });
 
-  it("upgrades a v23 snapshot DB to current and adds current overmind workflow columns", () => {
-    cleanup();
-    const raw = new Database(TEST_DB);
+  it("upgrades a v23 snapshot DB to current and drops overmind tables", () => {
+    // cleanup removed; temp dirs handled by afterEach
+    const path = tempDb("test-db.sqlite");
+    const raw = new Database(path);
     raw.exec(`
       CREATE TABLE schema_version (version INTEGER NOT NULL);
       INSERT INTO schema_version (version) VALUES (23);
@@ -187,23 +195,20 @@ describe("DatabaseService", () => {
     `);
     raw.close();
 
-    const upgraded = new DatabaseService(TEST_DB);
+    const upgraded = new DatabaseService(path);
     const version = upgraded.prepare("SELECT version FROM schema_version").get() as { version: number };
-    expect(version.version).toBe(36);
-    const upgradedCols = upgraded.raw.pragma("table_info(overmind_workflows)") as { name: string }[];
-    const upgradedColNames = upgradedCols.map((c) => c.name);
-    expect(upgradedColNames).toContain("last_parent_update_at");
-    expect(upgradedColNames).toContain("evidence_idle_threshold_override_minutes");
-    expect(upgradedColNames).toContain("orphaned");
-    expect(upgradedColNames).toContain("completion_nudge_count");
-    expect(upgradedColNames).toContain("working_accepts");
-    expect(upgradedColNames).toContain("completion_nudge_last_at");
+    expect(version.version).toBe(37);
+    const tables = upgraded.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
+    const names = tables.map(t => t.name);
+    expect(names).not.toContain("overmind_workflows");
+    expect(names).not.toContain("overmind_projects");
     upgraded.close();
   });
 
   it("upgrades a v31 DB to current with agent tables and leaves existing project rows intact", () => {
-    cleanup();
-    const raw = new Database(TEST_DB);
+    // cleanup removed; temp dirs handled by afterEach
+    const path = tempDb("test-db.sqlite");
+    const raw = new Database(path);
     raw.exec(`
       PRAGMA foreign_keys = ON;
       CREATE TABLE schema_version (version INTEGER NOT NULL);
@@ -222,9 +227,9 @@ describe("DatabaseService", () => {
     `);
     raw.close();
 
-    const upgraded = new DatabaseService(TEST_DB);
+    const upgraded = new DatabaseService(path);
     const version = upgraded.prepare("SELECT version FROM schema_version").get() as { version: number };
-    expect(version.version).toBe(36);
+    expect(version.version).toBe(37);
 
     const tableNames = (
       upgraded.raw
@@ -256,9 +261,10 @@ describe("DatabaseService", () => {
     upgraded.close();
   });
 
-  it("rebuilds v27 overmind_workflows for nullable identity with row survival and project/run uniqueness", () => {
-    cleanup();
-    const raw = new Database(TEST_DB);
+  it("upgrades v27 DB and drops overmind tables", () => {
+    // cleanup removed; temp dirs handled by afterEach
+    const path = tempDb("test-db.sqlite");
+    const raw = new Database(path);
     raw.exec(`
       PRAGMA foreign_keys = ON;
       CREATE TABLE schema_version (version INTEGER NOT NULL);
@@ -341,72 +347,18 @@ describe("DatabaseService", () => {
     `);
     raw.close();
 
-    const upgraded = new DatabaseService(TEST_DB);
+    const upgraded = new DatabaseService(path);
     const version = upgraded.prepare("SELECT version FROM schema_version").get() as { version: number };
-    expect(version.version).toBe(36);
-
-    const count = upgraded.prepare("SELECT COUNT(*) AS count FROM overmind_workflows").get() as { count: number };
-    expect(count.count).toBe(2);
-
-    const row = upgraded.prepare("SELECT * FROM overmind_workflows WHERE id = 10").get() as Record<string, unknown>;
-    expect(row).toMatchObject({
-      project_id: 1,
-      label: "workflow one",
-      display_name: "Display One",
-      coordinator_session: "coord-one",
-      child_sessions: "[\"child-a\"]",
-      child_roles: "[\"coder\"]",
-      run_dir: "/tmp/agj/run-one",
-      status: "working",
-      current_task: "B12c",
-      pending_decision: "decision?",
-      active_session: "child-a",
-      active_role: "child",
-      last_pane_hash: "hash-one",
-      nudge_count: 3,
-      tier: 2,
-      accumulated_ms: 1234,
-      monitoring_paused: 1,
-      evidence_idle_threshold_override_minutes: 35,
-      orphaned: 0
-    });
-
-    const legacy = upgraded.prepare("SELECT project_id, label, coordinator_session, run_dir FROM overmind_workflows WHERE id = 11").get();
-    expect(legacy).toEqual({
-      project_id: null,
-      label: "legacy workflow",
-      coordinator_session: "coord-legacy",
-      run_dir: "/tmp/legacy/run"
-    });
+    expect(version.version).toBe(37);
 
-    const cols = upgraded.raw.pragma("table_info(overmind_workflows)") as Array<{ name: string; notnull: number }>;
-    expect(cols.find((col) => col.name === "label")?.notnull).toBe(0);
-    expect(cols.find((col) => col.name === "coordinator_session")?.notnull).toBe(0);
-
-    const indexes = upgraded.raw.pragma("index_list(overmind_workflows)") as Array<{ name: string; unique: number }>;
-    expect(indexes).toEqual(expect.arrayContaining([
-      expect.objectContaining({ name: "idx_overmind_workflows_coordinator_session", unique: 0 }),
-      expect.objectContaining({ name: "idx_overmind_workflows_status", unique: 0 }),
-      expect.objectContaining({ name: "idx_overmind_workflows_project_id", unique: 0 }),
-      expect.objectContaining({ name: "idx_overmind_workflows_project_status", unique: 0 }),
-      expect.objectContaining({ name: "idx_overmind_workflows_project_run_dir", unique: 1 })
-    ]));
-
-    upgraded.prepare("INSERT INTO overmind_workflows (project_id, label, coordinator_session, run_dir) VALUES (1, NULL, NULL, '/tmp/agj/run-two')").run();
-    upgraded.prepare("INSERT INTO overmind_workflows (project_id, label, coordinator_session, run_dir) VALUES (1, NULL, NULL, '/tmp/agj/run-three')").run();
-    upgraded.prepare("INSERT INTO overmind_workflows (project_id, label, coordinator_session, run_dir) VALUES (NULL, 'dup session a', 'coord-one', '/tmp/legacy/dup-a')").run();
-    upgraded.prepare("INSERT INTO overmind_workflows (project_id, label, coordinator_session, run_dir) VALUES (NULL, 'dup session b', 'coord-one', '/tmp/legacy/dup-b')").run();
-    expect(() => {
-      upgraded.prepare("INSERT INTO overmind_workflows (project_id, label, coordinator_session, run_dir) VALUES (1, 'dup project run', 'coord-new', '/tmp/agj/run-one')").run();
-    }).toThrow();
+    const tables = upgraded.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
+    const names = tables.map(t => t.name);
+    expect(names).not.toContain("overmind_workflows");
+    expect(names).not.toContain("overmind_projects");
+    expect(names).not.toContain("overmind_task_history");
 
    
... TRUNCATED at 20000 chars. This is a display bound, NOT the scope of your review — read the rest with `git show 2c15f5242e220d14e2200da250922e6d5cdab620` before judging.
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
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/B7-fix-a2.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=B7 attempt=2 marker=DRV-B7-24 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
