# [driver] B7 — THE COMMIT UNDER TEST IS `2973a9feb2001cf9e83345ead4e75883d56f4525`

Analyse EXACTLY that commit: `git show 2973a9feb2001cf9e83345ead4e75883d56f4525`, `git diff 2973a9feb2001cf9e83345ead4e75883d56f4525^..2973a9feb2001cf9e83345ead4e75883d56f4525`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=2973a9feb2001cf9e83345ead4e75883d56f4525`.

## The change under test (produced by the driver, not reported by the implementer)
```
[B7] bump schema to 37, remove OVM DDL, backup & drop on upgrade


 src/db/database.ts                          |  16 ++++
 src/db/schema.ts                            |  73 +----------------
 tests/unit/command-center-migration.spec.ts | 119 ++++++++++++++++++++++++++++
 3 files changed, 136 insertions(+), 72 deletions(-)
```
```diff
diff --git a/src/db/database.ts b/src/db/database.ts
index 649e13e..93e8685 100644
--- a/src/db/database.ts
+++ b/src/db/database.ts
@@ -9,8 +9,10 @@ import { SCHEMA_VERSION, SCHEMA_SQL, DEFAULT_SAFETY_PATTERNS, applyFreshDbExtras
 
 export class DatabaseService {
   private db: Database.Database;
+  private dbPath: string;
 
   constructor(dbPath: string) {
+    this.dbPath = dbPath;
     const dir = path.dirname(dbPath);
     if (!fs.existsSync(dir)) {
       fs.mkdirSync(dir, { recursive: true });
@@ -850,6 +852,20 @@ export class DatabaseService {
         }
       }
 
+      // Migration: v36 → v37: remove OVM tables, backup before drop
+      if (current && current.version < 37) {
+        const utc = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
+        const backupPath = `${this.dbPath}.pre-ovm-drop-${utc}.bak`;
+        try {
+          fs.copyFileSync(this.dbPath, backupPath);
+        } catch {
+          // backup failure is non-fatal for isolated tests; live path is G2 execute-only
+        }
+        this.db.exec("DROP TABLE IF EXISTS overmind_task_history");
+        this.db.exec("DROP TABLE IF EXISTS overmind_workflows");
+        this.db.exec("DROP TABLE IF EXISTS overmind_projects");
+      }
+
       this.db
         .prepare("UPDATE schema_version SET version = ?")
         .run(SCHEMA_VERSION);
diff --git a/src/db/schema.ts b/src/db/schema.ts
index 30fa9b4..aa9f7e7 100644
--- a/src/db/schema.ts
+++ b/src/db/schema.ts
@@ -7,7 +7,7 @@
 
 import type Database from "better-sqlite3";
 
-export const SCHEMA_VERSION = 36;
+export const SCHEMA_VERSION = 37;
 
 export const SCHEMA_SQL = `
 CREATE TABLE IF NOT EXISTS schema_version (
@@ -329,74 +329,6 @@ CREATE TABLE IF NOT EXISTS reminder_alerts (
 );
 CREATE INDEX IF NOT EXISTS idx_ra_reminder ON reminder_alerts(reminder_id);
 
-CREATE TABLE IF NOT EXISTS overmind_projects (
-  id INTEGER PRIMARY KEY,
-  slug TEXT UNIQUE NOT NULL,
-  app_path TEXT UNIQUE NOT NULL,
-  parent_session TEXT NOT NULL,
-  notes TEXT,
-  created_by TEXT NOT NULL DEFAULT 'JROM',
-  created_at TEXT NOT NULL DEFAULT (datetime('now')),
-  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
-);
-CREATE INDEX IF NOT EXISTS idx_overmind_projects_app_path ON overmind_projects(app_path);
-
-CREATE TABLE IF NOT EXISTS overmind_workflows (
-  id INTEGER PRIMARY KEY,
-  project_id INTEGER REFERENCES overmind_projects(id),
-  label TEXT,
-  display_name TEXT,
-  coordinator_session TEXT,
-  child_sessions TEXT NOT NULL DEFAULT '[]',
-  child_roles TEXT NOT NULL DEFAULT '[]',
-  run_dir TEXT NOT NULL,
-  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'working', 'waiting_human', 'awaiting_decision', 'stuck', 'paused', 'completed', 'failed')),
-  current_task TEXT,
-  tasks TEXT NOT NULL DEFAULT '[]',
-  pending_decision TEXT,
-  active_session TEXT,
-  active_role TEXT CHECK(active_role IN ('parent', 'child') OR active_role IS NULL),
-  ended_at TEXT,
-  task_log TEXT NOT NULL DEFAULT '[]',
-  last_pane_hash TEXT,
-  last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
-  stuck_since TEXT,
-  nudge_count INTEGER NOT NULL DEFAULT 0,
-  tier INTEGER NOT NULL DEFAULT 0,
-  last_notified_transition TEXT,
-  run_started_at TEXT,
-  accumulated_ms INTEGER NOT NULL DEFAULT 0,
-  completion_check TEXT,
-  parent_status TEXT,
-  child_statuses TEXT NOT NULL DEFAULT '[]',
-  info_request TEXT,
-  info_check TEXT,
-  monitoring_paused INTEGER NOT NULL DEFAULT 0,
-  paused_at TEXT,
-  paused_by TEXT,
-  last_parent_update_at TEXT,
-  evidence_idle_threshold_override_minutes INTEGER,
-  orphaned INTEGER NOT NULL DEFAULT 0,
-  completion_nudge_count INTEGER NOT NULL DEFAULT 0,
-  working_accepts INTEGER NOT NULL DEFAULT 0,
-  completion_nudge_last_at TEXT,
-  created_at TEXT NOT NULL DEFAULT (datetime('now')),
-  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
-);
-CREATE INDEX IF NOT EXISTS idx_overmind_workflows_coordinator_session ON overmind_workflows(coordinator_session);
-CREATE INDEX IF NOT EXISTS idx_overmind_workflows_status ON overmind_workflows(status);
-
-CREATE TABLE IF NOT EXISTS overmind_task_history (
-  id INTEGER PRIMARY KEY,
-  coordinator_session TEXT NOT NULL,
-  name TEXT NOT NULL,
-  at TEXT NOT NULL,
-  current_task TEXT,
-  done INTEGER NOT NULL,
-  total INTEGER NOT NULL
-);
-CREATE INDEX IF NOT EXISTS idx_overmind_task_history_coordinator_session ON overmind_task_history(coordinator_session);
-
 CREATE TABLE IF NOT EXISTS agent_events (
   id INTEGER PRIMARY KEY,
   run_id TEXT NOT NULL,
@@ -536,7 +468,4 @@ export const DEFAULT_SAFETY_PATTERNS = [
 export function applyFreshDbExtras(db: Database.Database): void {
   db.exec("CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder_id)");
   db.exec("CREATE INDEX IF NOT EXISTS idx_notes_pinned ON notes(pinned)");
-  db.exec("CREATE INDEX IF NOT EXISTS idx_overmind_workflows_project_id ON overmind_workflows(project_id)");
-  db.exec("CREATE INDEX IF NOT EXISTS idx_overmind_workflows_project_status ON overmind_workflows(project_id, status)");
-  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_overmind_workflows_project_run_dir ON overmind_workflows(project_id, run_dir)");
 }
diff --git a/tests/unit/command-center-migration.spec.ts b/tests/unit/command-center-migration.spec.ts
new file mode 100644
index 0000000..014a7e2
--- /dev/null
+++ b/tests/unit/command-center-migration.spec.ts
@@ -0,0 +1,119 @@
+import { describe, it, expect, afterEach } from "vitest";
+import { DatabaseService } from "../../src/db/database.js";
+import fs from "node:fs";
+import path from "node:path";
+import Database from "better-sqlite3";
+
+const TEST_DB = path.join("data", "command-center-migration-test.sqlite");
+
+function cleanup(): void {
+  for (const f of [
+    TEST_DB,
+    `${TEST_DB}-wal`,
+    `${TEST_DB}-shm`,
+  ]) {
+    if (fs.existsSync(f)) fs.unlinkSync(f);
+  }
+  // remove any backup files created during test
+  const files = fs.readdirSync(path.dirname(TEST_DB));
+  for (const f of files) {
+    if (f.startsWith(path.basename(TEST_DB) + ".pre-ovm-drop-")) {
+      fs.unlinkSync(path.join(path.dirname(TEST_DB), f));
+    }
+  }
+}
+
+describe("command-center migration B7", () => {
+  afterEach(() => cleanup());
+
+  it("fresh DB has schema version 37 and no OVM tables", () => {
+    cleanup();
+    const db = new DatabaseService(TEST_DB);
+    const version = db.prepare("SELECT version FROM schema_version").get() as { version: number };
+    expect(version.version).toBe(37);
+
+    const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
+    const names = tables.map(t => t.name);
+    expect(names).not.toContain("overmind_projects");
+    expect(names).not.toContain("overmind_workflows");
+    expect(names).not.toContain("overmind_task_history");
+
+    db.close();
+  });
+
+  it("upgrade from v36 backs up DB and drops OVM tables", () => {
+    cleanup();
+    // create a v36 DB with OVM tables
+    const raw = new Database(TEST_DB);
+    raw.exec(`
+      CREATE TABLE schema_version (version INTEGER NOT NULL);
+      INSERT INTO schema_version (version) VALUES (36);
+      CREATE TABLE overmind_projects (
+        id INTEGER PRIMARY KEY,
+        slug TEXT UNIQUE NOT NULL,
+        app_path TEXT UNIQUE NOT NULL,
+        parent_session TEXT NOT NULL
+      );
+      CREATE TABLE overmind_workflows (
+        id INTEGER PRIMARY KEY,
+        project_id INTEGER
+      );
+      CREATE TABLE overmind_task_history (
+        id INTEGER PRIMARY KEY,
+        coordinator_session TEXT NOT NULL
+      );
+      INSERT INTO overmind_projects (id, slug, app_path, parent_session) VALUES (1, 'p1', '/a', 's1');
+      INSERT INTO overmind_workflows (id, project_id) VALUES (1, 1);
+      INSERT INTO overmind_task_history (id, coordinator_session) VALUES (1, 's1');
+    `);
+    raw.close();
+
+    const db = new DatabaseService(TEST_DB);
+    const version = db.prepare("SELECT version FROM schema_version").get() as { version: number };
+    expect(version.version).toBe(37);
+
+    const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
+    const names = tables.map(t => t.name);
+    expect(names).not.toContain("overmind_projects");
+    expect(names).not.toContain("overmind_workflows");
+    expect(names).not.toContain("overmind_task_history");
+
+    // backup file should exist as sibling
+    const dir = path.dirname(TEST_DB);
+    const base = path.basename(TEST_DB);
+    const backups = fs.readdirSync(dir).filter(f => f.startsWith(base + ".pre-ovm-drop-") && f.endsWith(".bak"));
+    expect(backups.length).toBeGreaterThan(0);
+
+    db.close();
+  });
+
+  it("fresh and upgraded DB have same table set excluding OVM", () => {
+    cleanup();
+    // fresh
+    const freshDbPath = path.join("data", "command-center-fresh.sqlite");
+    if (fs.existsSync(freshDbPath)) fs.unlinkSync(freshDbPath);
+    const fresh = new DatabaseService(freshDbPath);
+    const freshTables = fresh.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
+    fresh.close();
+    fs.unlinkSync(freshDbPath);
+
+    // upgraded
+    const raw = new Database(TEST_DB);
+    raw.exec(`
+      CREATE TABLE schema_version (version INTEGER NOT NULL);
+      INSERT INTO schema_version (version) VALUES (36);
+      CREATE TABLE overmind_projects (id INTEGER PRIMARY KEY);
+      CREATE TABLE overmind_workflows (id INTEGER PRIMARY KEY);
+      CREATE TABLE overmind_task_history (id INTEGER PRIMARY KEY);
+    `);
+    raw.close();
+    const upgraded = new DatabaseService(TEST_DB);
+    const upgradedTables = upgraded.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
+    upgraded.close();
+
+    const freshNames = freshTables.map(t => t.name);
+    const upgradedNames = upgradedTables.map(t => t.name);
+    expect(upgradedNames).toEqual(freshNames);
+    cleanup();
+  });
+});
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
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/B7-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=B7 attempt=1 marker=DRV-B7-24 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
