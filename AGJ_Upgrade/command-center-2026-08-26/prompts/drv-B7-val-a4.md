# [driver] B7 — THE COMMIT UNDER TEST IS `7340cff4bebd137060e2a34368f5e58ba678e976`

Analyse EXACTLY that commit: `git show 7340cff4bebd137060e2a34368f5e58ba678e976`, `git diff 7340cff4bebd137060e2a34368f5e58ba678e976^..7340cff4bebd137060e2a34368f5e58ba678e976`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=7340cff4bebd137060e2a34368f5e58ba678e976`.

## The change under test (produced by the driver, not reported by the implementer)
```
feat(B7): guard legacy OVM migrations


 AGJ_Upgrade/command-center-2026-08-26/plan.md |  2 +-
 src/db/database.ts                            | 38 +++++------
 tests/unit/command-center-migration.spec.ts   | 94 ++++++++++++++++++---------
 3 files changed, 85 insertions(+), 49 deletions(-)
```
```diff
diff --git a/AGJ_Upgrade/command-center-2026-08-26/plan.md b/AGJ_Upgrade/command-center-2026-08-26/plan.md
index ce49466..cc76603 100644
--- a/AGJ_Upgrade/command-center-2026-08-26/plan.md
+++ b/AGJ_Upgrade/command-center-2026-08-26/plan.md
@@ -96,7 +96,7 @@ Rubric: `loop-escalation.md` §3. `token_budget: null`; `new_class_rounds_to_sta
 
 ## Release boundary
 
-F-OVM is fence-before-deploy: no live `pm2 restart agjassist` or live OVM-table drop before B8 is green, and G2 additionally requires every capability fence. On a live execute the pre-drop backup is `data/agjassist.db.pre-ovm-drop-<UTC>.bak`. Tests derive the backup as a sibling of the `DB_PATH` file under test. Rollback is attended: restore that backup and reset to the recorded pre-release commit.
+F-OVM is fence-before-deploy: no live `pm2 restart agjassist` or live OVM-table drop before B8 is green, and G2 additionally requires every capability fence. On a live execute the pre-drop backup is `data/agjassist.db.pre-ovm-drop-<UTC>-<PID>.bak`. Tests derive the backup as a sibling of the `DB_PATH` file under test. Rollback is attended: restore that backup and reset to the recorded pre-release commit.
 
 `--execute` is not a prose instruction. It is a guard in `scripts/release-command-center.mjs`: TTY + typed confirmation + absence of tiller/agent env. A tiller seat that passes `--execute` must be refused by that guard; G2's test proves it.
 
diff --git a/src/db/database.ts b/src/db/database.ts
index 3d48c78..6b9b8fd 100644
--- a/src/db/database.ts
+++ b/src/db/database.ts
@@ -176,7 +176,7 @@ export class DatabaseService {
       }
 
       // Migration: v9 → v10: make notes.project_id nullable (recreate table)
-      if (current && current.version < 10) {
+      if (current && current.version < 10 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
         // Check if notes table has NOT NULL on project_id by trying an insert
         // Safer approach: recreate table without NOT NULL constraint
         this.db.exec("PRAGMA foreign_keys = OFF");
@@ -203,12 +203,12 @@ export class DatabaseService {
       }
 
       // Migration: v10 → v11: add overmind_workflows table
-      if (current && current.version < 11) {
+      if (current && current.version < 11 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
         this.db.exec(SCHEMA_SQL);
       }
 
       // Migration: v11 → v12: add active-session attribution to overmind_workflows
-      if (current && current.version < 12) {
+      if (current && current.version < 12 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
         const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
         const colNames = new Set(cols.map((c) => c.name));
         if (!colNames.has("active_session")) {
@@ -220,7 +220,7 @@ export class DatabaseService {
       }
 
       // Migration: v12 → v13: add workflow completion timestamp and task history log
-      if (current && current.version < 13) {
+      if (current && current.version < 13 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
         const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
         const colNames = new Set(cols.map((c) => c.name));
         if (!colNames.has("ended_at")) {
@@ -232,7 +232,7 @@ export class DatabaseService {
       }
 
       // Migration: v13 → v14: persist once-per-transition overmind notifications
-      if (current && current.version < 14) {
+      if (current && current.version < 14 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
         const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
         const colNames = new Set(cols.map((c) => c.name));
         if (!colNames.has("last_notified_transition")) {
@@ -241,7 +241,7 @@ export class DatabaseService {
       }
 
       // Migration: v14 → v15: track current overmind run start and accumulated elapsed time
-      if (current && current.version < 15) {
+      if (current && current.version < 15 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
         const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
         const colNames = new Set(cols.map((c) => c.name));
         if (!colNames.has("run_started_at")) {
@@ -254,7 +254,7 @@ export class DatabaseService {
       }
 
       // Migration: v15 → v16: add user-controlled overmind workflow display name
-      if (current && current.version < 16) {
+      if (current && current.version < 16 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
         const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
         const colNames = new Set(cols.map((c) => c.name));
         if (!colNames.has("display_name")) {
@@ -268,7 +268,7 @@ export class DatabaseService {
       }
 
       // Migration: v17 → v18: gate Sonnet completion-edge check once per all-done state
-      if (current && current.version < 18) {
+      if (current && current.version < 18 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
         const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
         const colNames = new Set(cols.map((c) => c.name));
         if (!colNames.has("completion_check")) {
@@ -277,7 +277,7 @@ export class DatabaseService {
       }
 
       // Migration: v18 → v19: persist independent parent/child session statuses
-      if (current && current.version < 19) {
+      if (current && current.version < 19 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
         const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
         const colNames = new Set(cols.map((c) => c.name));
         if (!colNames.has("parent_status")) {
@@ -289,7 +289,7 @@ export class DatabaseService {
       }
 
       // Migration: v19 → v20: per-child role labels (e.g. coder/tester) for multi-agent workflows
-      if (current && current.version < 20) {
+      if (current && current.version < 20 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
         const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
         const colNames = new Set(cols.map((c) => c.name));
         if (!colNames.has("child_roles")) {
@@ -298,7 +298,7 @@ export class DatabaseService {
       }
 
       // Migration: v20 → v21: registration completeness badge (info_request) + dedupe signature (info_check)
-      if (current && current.version < 21) {
+      if (current && current.version < 21 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
         const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
         const colNames = new Set(cols.map((c) => c.name));
         if (!colNames.has("info_request")) {
@@ -311,7 +311,7 @@ export class DatabaseService {
 
       // Migration: v21 → v22: JROM-initiated monitoring pause (suppresses all interrupts
       // while he talks to a coordinator) — flag is separate from status so the card stays visible.
-      if (current && current.version < 22) {
+      if (current && current.version < 22 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
         const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
         const colNames = new Set(cols.map((c) => c.name));
         if (!colNames.has("monitoring_paused")) {
@@ -373,7 +373,7 @@ export class DatabaseService {
       }
 
       // Migration: v23 → v24: parent update timestamp + per-workflow ask-update cooldown override
-      if (current && current.version < 24) {
+      if (current && current.version < 24 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
         const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
         const colNames = new Set(cols.map((c) => c.name));
         if (!colNames.has("last_parent_update_at")) {
@@ -390,7 +390,7 @@ export class DatabaseService {
       // the migration safely and downstream code can read from either column
       // during a deploy window. The OLD column is left in place (NOT dropped)
       // — preserves rollback safety + avoids a table rebuild.
-      if (current && current.version < 25) {
+      if (current && current.version < 25 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
         const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
         const colNames = new Set(cols.map((c) => c.name));
         if (!colNames.has("evidence_idle_threshold_override_minutes")) {
@@ -418,7 +418,7 @@ export class DatabaseService {
       }
 
       // Migration: v26 → v27: project source-of-truth table and nullable workflow FK
-      if (current && current.version < 27) {
+      if (current && current.version < 27 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
         this.db.exec(`
           CREATE TABLE IF NOT EXISTS overmind_projects (
             id INTEGER PRIMARY KEY,
@@ -446,7 +446,7 @@ export class DatabaseService {
       // Migration: v27 → v28: workflow identity no longer depends on session.
       // SQLite cannot relax NOT NULL/drop UNIQUE in place, so rebuild with an
       // explicit column copy. Only label/coordinator_session constraints change.
-      if (current && current.version < 28) {
+      if (current && current.version < 28 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
         const workflowColumns = [
           "id",
           "project_id",
@@ -568,7 +568,7 @@ export class DatabaseService {
       // Migration: v28 → v29: mark OVM runs whose parent coordinator and child
       // sessions are all gone. Kept as a flag so the future ERROR tab can own
       // display without changing the owner's completion path.
-      if (current && current.version < 29) {
+      if (current && current.version < 29 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
         const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
         const colNames = new Set(cols.map((c) => c.name));
         if (!colNames.has("orphaned")) {
@@ -580,7 +580,7 @@ export class DatabaseService {
       // ladder (R3). Separate from nudge_count (which is the generic stuck/idle
       // ladder) so the two paths don't interfere and the counter survives across
       // ticks without being reset by unrelated code.
-      if (current && current.version < 30) {
+      if (current && current.version < 30 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
         const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
         const colNames = new Set(cols.map((c) => c.name));
         if (!colNames.has("completion_nudge_count")) {
@@ -593,7 +593,7 @@ export class DatabaseService {
       // completion_nudge_last_at (persisted cooldown anchor so restarts don't spam).
       // Cleans up the old sign-convention hack where completion_nudge_count < 0 was
       // used as a working-accepts counter — reset any negative values to 0 on upgrade.
-      if (current && current.version < 31) {
+      if (current && current.version < 31 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
         const cols = this.db.pragma("table_info(overmind_workflows)") as { name: string }[];
         const colNames = new Set(cols.map((c) => c.name));
         if (!colNames.has("working_accepts")) {
diff --git a/tests/unit/command-center-migration.spec.ts b/tests/unit/command-center-migration.spec.ts
index 3688998..31c2f82 100644
--- a/tests/unit/command-center-migration.spec.ts
+++ b/tests/unit/command-center-migration.spec.ts
@@ -21,7 +21,14 @@ afterEach(() => {
 
 function normalizeSql(sql: string | null): string | null {
   if (sql === null) return null;
-  return sql.replace(/\s+/g, " ").replace(/\s*([(),=])\s*/g, "$1").trim();
+  return sql
+    .replace(
+      /^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[^\s(]+)/i,
+      "CREATE TABLE <table>"
+    )
+    .replace(/\s+/g, " ")
+    .replace(/\s*([(),=])\s*/g, "$1")
+    .trim();
 }
 
 function schemaFingerprint(db: Database.Database) {
@@ -31,6 +38,61 @@ function schemaFingerprint(db: Database.Database) {
   return rows.map(r => ({ ...r, sql: normalizeSql(r.sql) }));
 }
 
+function createLegacyV22Fixture(dbPath: string): void {
+  const raw = new Database(dbPath);
+  raw.exec(`
+    PRAGMA foreign_keys = ON;
+
+    CREATE TABLE schema_version (
+      version INTEGER NOT NULL
+    );
+    INSERT INTO schema_version (version) VALUES (22);
+
+    CREATE TABLE users (
+      id INTEGER PRIMARY KEY,
+      telegram_id INTEGER UNIQUE NOT NULL,
+      username TEXT,
+      display_name TEXT,
+      role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('owner', 'viewer')),
+      totp_secret TEXT,
+      totp_enabled INTEGER NOT NULL DEFAULT 0,
+      active INTEGER NOT NULL DEFAULT 1,
+      created_at TEXT NOT NULL DEFAULT (datetime('now')),
+      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
+    );
+
+    CREATE TABLE sessions (
+      id TEXT PRIMARY KEY,
+      user_id INTEGER NOT NULL REFERENCES users(id),
+      token_hash TEXT NOT NULL,
+      surface TEXT NOT NULL CHECK(surface IN ('bot', 'miniapp', 'web')),
+      expires_at TEXT NOT NULL,
+      last_activity TEXT NOT NULL DEFAULT (datetime('now')),
+      created_at TEXT NOT NULL DEFAULT (datetime('now'))
+    );
+    CREATE INDEX idx_sessions_user ON sessions(user_id);
+    CREATE INDEX idx_sessions_expires ON sessions(expires_at);
+
+    CREATE TABLE audit_log (
+      id INTEGER PRIMARY KEY,
+      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
+      user_id INTEGER REFERENCES users(id),
+      agent_name TEXT,
+      action_type TEXT NOT NULL,
+      resource_type TEXT,
+      resource_id TEXT,
+      details TEXT,
+      tmux_target TEXT,
+      surface TEXT CHECK(surface IN ('bot', 'miniapp', 'web', 'agent'))
+    );
+    CREATE INDEX idx_audit_time ON audit_log(timestamp);
+    CREATE INDEX idx_audit_user ON audit_log(user_id);
+    CREATE INDEX idx_audit_agent ON audit_log(agent_name);
+    CREATE INDEX idx_audit_type ON audit_log(action_type);
+  `);
+  raw.close();
+}
+
 describe("command-center migration B7", () => {
   it("fresh DB has schema version 37 and no OVM tables", () => {
     const dbPath = tempDb("fresh.sqlite");
@@ -106,43 +168,17 @@ describe("command-center migration B7", () => {
     db.close();
   });
 
-  it("fresh and upgraded DB converge to same schema fingerprint", () => {
+  it("fresh and genuine v22 DB without OVM tables converge to the same schema fingerprint", () => {
     const freshPath = tempDb("fresh.sqlite");
     const fresh = new DatabaseService(freshPath);
     const freshFp = schemaFingerprint(fresh.raw);
     fresh.close();
 
     const upgradePath = tempDb("upgrade.sqlite");
-    // Build a realistic v36 DB by creating a fresh DB then downgrading version and adding OVM tables
-    const tmp = new DatabaseService(upgradePath);
-    tmp.close();
-    const raw = new Database(upgradePath);
-    raw.pragma("journal_mode = WAL");
-    raw.exec("UPDATE schema_version SET version = 36");
-    raw.exec(`
-      CREATE TABLE IF NOT EXISTS overmind_projects (
-        id INTEGER PRIMARY KEY,
-        slug TEXT UNIQUE NOT NULL,
-        app_path TEXT UNIQUE NOT NULL,
-        parent_session TEXT NOT NULL
-      );
-      CREATE TABLE IF NOT EXISTS overmind_workflows (
-        id INTEGER PRIMARY KEY,
-        project_id INTEGER
-      );
-      CREATE TABLE IF NOT EXISTS overmind_task_history (
-        id INTEGER PRIMARY KEY,
-        coordinator_session TEXT NOT NULL
-      );
-    `);
-    raw.exec(`INSERT INTO overmind_projects VALUES (1, 'p1', '/a', 's1');`);
-    raw.exec(`INSERT INTO overmind_workflows VALUES (1, 1);`);
-    raw.exec(`INSERT INTO overmind_task_history VALUES (1, 's1');`);
-    // keep raw open for WAL realism, but we will close after upgrade
+    createLegacyV22Fixture(upgradePath);
     const upgraded = new DatabaseService(upgradePath);
     const upgradedFp = schemaFingerprint(upgraded.raw);
     upgraded.close();
-    raw.close();
 
     expect(upgradedFp).toEqual(freshFp);
   });
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
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/B7-fix-a4.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=B7 attempt=4 marker=DRV-B7-24 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
