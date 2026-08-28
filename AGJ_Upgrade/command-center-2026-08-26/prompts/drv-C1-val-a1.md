# [driver] C1 — THE COMMIT UNDER TEST IS `87117c7ac3f9cf726d762ebd3823c1742f22abcb`

Analyse EXACTLY that commit: `git show 87117c7ac3f9cf726d762ebd3823c1742f22abcb`, `git diff 87117c7ac3f9cf726d762ebd3823c1742f22abcb^..87117c7ac3f9cf726d762ebd3823c1742f22abcb`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=87117c7ac3f9cf726d762ebd3823c1742f22abcb`.

## The change under test (produced by the driver, not reported by the implementer)
```
[C1] Add agent_solicit_reminders schema and migration


 src/db/database.ts                       |   6 ++
 src/db/schema.ts                         |  28 ++++++-
 tests/unit/agent-reminder-schema.spec.ts | 127 +++++++++++++++++++++++++++++++
 3 files changed, 160 insertions(+), 1 deletion(-)
```
```diff
diff --git a/src/db/database.ts b/src/db/database.ts
index 6dde317..67a5ca6 100644
--- a/src/db/database.ts
+++ b/src/db/database.ts
@@ -865,6 +865,12 @@ export class DatabaseService {
         this.db.exec("DROP TABLE IF EXISTS overmind_projects");
       }
 
+      // Migration: v37 → v38: agent solicit reminders schema
+      if (current && current.version < 38) {
+        // Tables agent_solicit_reminders and agent_solicit_recipients are created via SCHEMA_SQL
+        // after migrations; no data migration required for fresh-vs-upgrade parity.
+      }
+
       this.db
         .prepare("UPDATE schema_version SET version = ?")
         .run(SCHEMA_VERSION);
diff --git a/src/db/schema.ts b/src/db/schema.ts
index aa9f7e7..2e4aa6b 100644
--- a/src/db/schema.ts
+++ b/src/db/schema.ts
@@ -7,7 +7,7 @@
 
 import type Database from "better-sqlite3";
 
-export const SCHEMA_VERSION = 37;
+export const SCHEMA_VERSION = 38;
 
 export const SCHEMA_SQL = `
 CREATE TABLE IF NOT EXISTS schema_version (
@@ -442,6 +442,32 @@ CREATE TABLE IF NOT EXISTS mcp_authorization_codes (
 );
 CREATE INDEX IF NOT EXISTS idx_mcp_codes_grant ON mcp_authorization_codes(grant_id);
 CREATE INDEX IF NOT EXISTS idx_mcp_codes_expiry ON mcp_authorization_codes(expires_at);
+
+CREATE TABLE IF NOT EXISTS agent_solicit_reminders (
+  id INTEGER PRIMARY KEY,
+  user_id INTEGER NOT NULL REFERENCES users(id),
+  folder_group TEXT NOT NULL,
+  cadence_minutes INTEGER NOT NULL CHECK(cadence_minutes > 0),
+  repeat_limit INTEGER,
+  repeat_count INTEGER NOT NULL DEFAULT 0,
+  next_fire TEXT,
+  solicit_message TEXT NOT NULL DEFAULT 'give me a status update',
+  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
+  created_at TEXT NOT NULL DEFAULT (datetime('now')),
+  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
+);
+CREATE INDEX IF NOT EXISTS idx_agent_solicit_reminders_user_folder ON agent_solicit_reminders(user_id, folder_group);
+CREATE INDEX IF NOT EXISTS idx_agent_solicit_reminders_next_fire ON agent_solicit_reminders(next_fire);
+
+CREATE TABLE IF NOT EXISTS agent_solicit_recipients (
+  id INTEGER PRIMARY KEY,
+  reminder_id INTEGER NOT NULL REFERENCES agent_solicit_reminders(id) ON DELETE CASCADE,
+  agent_name TEXT NOT NULL,
+  include INTEGER NOT NULL DEFAULT 1 CHECK(include IN (0,1)),
+  created_at TEXT NOT NULL DEFAULT (datetime('now'))
+);
+CREATE INDEX IF NOT EXISTS idx_agent_solicit_recipients_reminder ON agent_solicit_recipients(reminder_id);
+CREATE INDEX IF NOT EXISTS idx_agent_solicit_recipients_agent ON agent_solicit_recipients(agent_name);
 `;
 
 export const DEFAULT_SAFETY_PATTERNS = [
diff --git a/tests/unit/agent-reminder-schema.spec.ts b/tests/unit/agent-reminder-schema.spec.ts
new file mode 100644
index 0000000..38b9cb8
--- /dev/null
+++ b/tests/unit/agent-reminder-schema.spec.ts
@@ -0,0 +1,127 @@
+import { describe, it, expect, afterEach } from "vitest";
+import { DatabaseService } from "../../src/db/database.js";
+import fs from "node:fs";
+import os from "node:os";
+import path from "node:path";
+import Database from "better-sqlite3";
+
+const tempDirs: string[] = [];
+
+function tempDb(name: string): string {
+  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-agent-reminder-"));
+  tempDirs.push(dir);
+  return path.join(dir, name);
+}
+
+afterEach(() => {
+  for (const dir of tempDirs.splice(0)) {
+    fs.rmSync(dir, { recursive: true, force: true });
+  }
+});
+
+function normalizeSql(sql: string | null): string | null {
+  if (sql === null) return null;
+  return sql
+    .replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"([^"]+)"/i, "CREATE TABLE $1")
+    .replace(/\s+/g, " ")
+    .replace(/\s*([(),=])\s*/g, "$1")
+    .trim();
+}
+
+function schemaFingerprint(db: Database.Database) {
+  const rows = db.prepare(
+    `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY type, name`
+  ).all() as Array<{ type: string; name: string; tbl_name: string | null; sql: string | null }>;
+  return rows.map(r => ({ ...r, sql: normalizeSql(r.sql) }));
+}
+
+function createLegacyV37Fixture(dbPath: string): void {
+  const raw = new Database(dbPath);
+  raw.exec(`
+    PRAGMA foreign_keys = ON;
+    CREATE TABLE schema_version (version INTEGER NOT NULL);
+    INSERT INTO schema_version (version) VALUES (37);
+    CREATE TABLE users (
+      id INTEGER PRIMARY KEY,
+      telegram_id INTEGER UNIQUE NOT NULL,
+      role TEXT NOT NULL DEFAULT 'viewer'
+    );
+  `);
+  raw.close();
+}
+
+describe("agent-reminder-schema C1", () => {
+  it("fresh DB has schema version 38 and agent solicit tables", () => {
+    const dbPath = tempDb("fresh.sqlite");
+    const db = new DatabaseService(dbPath);
+    const version = db.prepare("SELECT version FROM schema_version").get() as { version: number };
+    expect(version.version).toBe(38);
+
+    const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
+    const names = tables.map(t => t.name);
+    expect(names).toContain("agent_solicit_reminders");
+    expect(names).toContain("agent_solicit_recipients");
+
+    const cols = db.raw.pragma("table_info(agent_solicit_reminders)") as Array<{ name: string }>;
+    const colNames = cols.map(c => c.name);
+    expect(colNames).toContain("folder_group");
+    expect(colNames).toContain("cadence_minutes");
+    expect(colNames).toContain("repeat_limit");
+    expect(colNames).toContain("next_fire");
+    expect(colNames).toContain("solicit_message");
+
+    const recCols = db.raw.pragma("table_info(agent_solicit_recipients)") as Array<{ name: string }>;
+    const recColNames = recCols.map(c => c.name);
+    expect(recColNames).toContain("reminder_id");
+    expect(recColNames).toContain("agent_name");
+    expect(recColNames).toContain("include");
+
+    db.close();
+  });
+
+  it("upgrade from v37 creates agent solicit tables", () => {
+    const upgradePath = tempDb("upgrade.sqlite");
+    createLegacyV37Fixture(upgradePath);
+    const upgraded = new DatabaseService(upgradePath);
+    const version = upgraded.prepare("SELECT version FROM schema_version").get() as { version: number };
+    expect(version.version).toBe(38);
+
+    const tables = upgraded.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
+    const names = tables.map(t => t.name);
+    expect(names).toContain("agent_solicit_reminders");
+    expect(names).toContain("agent_solicit_recipients");
+    upgraded.close();
+  });
+
+  it("agent_solicit_reminders supports folder-group cadence repeat limit include skip next-fire", () => {
+    const dbPath = tempDb("test.sqlite");
+    const db = new DatabaseService(dbPath);
+    // Create a user for FK
+    db.prepare("INSERT INTO users (telegram_id, role) VALUES (12345, 'owner')").run();
+    const user = db.prepare("SELECT id FROM users WHERE telegram_id = 12345").get() as { id: number };
+    // Insert a reminder
+    db.prepare(`
+      INSERT INTO agent_solicit_reminders (user_id, folder_group, cadence_minutes, repeat_limit, next_fire, solicit_message, active)
+      VALUES (?, 'group-a', 30, NULL, '2026-01-01 00:00:00', 'give me a status update', 1)
+    `).run(user.id);
+    const id = db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
+    // Insert recipients with include/skip
+    db.prepare(`
+      INSERT INTO agent_solicit_recipients (reminder_id, agent_name, include)
+      VALUES (?, 'agent-1', 1), (?, 'agent-2', 0)
+    `).run(id.id, id.id);
+
+    const reminder = db.prepare("SELECT * FROM agent_solicit_reminders WHERE id = ?").get(id.id) as any;
+    expect(reminder.folder_group).toBe('group-a');
+    expect(reminder.cadence_minutes).toBe(30);
+    expect(reminder.repeat_limit).toBeNull();
+    expect(reminder.next_fire).toBe('2026-01-01 00:00:00');
+
+    const recs = db.prepare("SELECT agent_name, include FROM agent_solicit_recipients WHERE reminder_id = ?").all(id.id) as Array<{ agent_name: string; include: number }>;
+    expect(recs).toHaveLength(2);
+    expect(recs.find(r => r.agent_name === 'agent-1')!.include).toBe(1);
+    expect(recs.find(r => r.agent_name === 'agent-2')!.include).toBe(0);
+
+    db.close();
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

# THE SLICE — C1 (run command-center-2026-08-26)

## Scope (do ONLY this)
Schema layer: additive `agent_solicit_reminders` plus recipient rows in `SCHEMA_SQL` and `DatabaseService` migrations (folder-group, cadence, repeat limit, include/skip, next-fire, fresh-vs-upgrade). Do not alter calendar `reminders`.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **C1** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **C2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **C3** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **C4** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **C6** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`node scripts/cc-run-isolated.mjs --slice C1 -- npx vitest run tests/unit/agent-reminder-schema.spec.ts --minWorkers=1 --maxWorkers=4`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=C1 attempt=1 role=validator
  marker=DRV-C1-24 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate C1 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator C1 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/C1-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=C1 attempt=1 marker=DRV-C1-24 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
