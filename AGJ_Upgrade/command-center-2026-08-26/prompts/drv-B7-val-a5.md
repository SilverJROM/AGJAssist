# [driver] B7 — THE COMMIT UNDER TEST IS `78e8448e8dbf2da3570a37146e47c22d8c5d4709`

Analyse EXACTLY that commit: `git show 78e8448e8dbf2da3570a37146e47c22d8c5d4709`, `git diff 78e8448e8dbf2da3570a37146e47c22d8c5d4709^..78e8448e8dbf2da3570a37146e47c22d8c5d4709`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=78e8448e8dbf2da3570a37146e47c22d8c5d4709`.

## The change under test (produced by the driver, not reported by the implementer)
```
feat(B7): restore legacy notes migration


 AGJ_Upgrade/command-center-2026-08-26/plan.md |  2 +-
 src/db/database.ts                            |  4 +-
 tests/unit/command-center-migration.spec.ts   | 73 +++++++++++++++++++++++++--
 3 files changed, 72 insertions(+), 7 deletions(-)
```
```diff
diff --git a/AGJ_Upgrade/command-center-2026-08-26/plan.md b/AGJ_Upgrade/command-center-2026-08-26/plan.md
index cc76603..73e95d0 100644
--- a/AGJ_Upgrade/command-center-2026-08-26/plan.md
+++ b/AGJ_Upgrade/command-center-2026-08-26/plan.md
@@ -21,7 +21,7 @@ Each fence has its **own** journey spec. A0 authors all five plus the runner. `F
 | B4 | Bootstrap layer only: remove Overmind imports, construction, watcher startup, and server injection from `src/index.ts`; production bootstrap starts with no OVM wiring. | A2,A5 | `npx vitest run tests/overmind-removal-bootstrap.test.ts --minWorkers=1 --maxWorkers=4` | 25 | A0,B2,B3 | L3 | L3 | no | standard | 4 |
 | B5 | Bot layer only: remove `/overmind`, `/om_tasks`, `/om_pause`, `/om_resume`, `/om_drop`, `/ovm_start`, `/ovm_end` from `AssistantCore` and `TelegramAssistant`; they follow the normal unknown-command path. | A3 | `npx vitest run tests/overmind-command-removal.test.ts --minWorkers=1 --maxWorkers=4` | 25 | A0 | L2 | L2 | no | standard | 4 |
 | B6 | API layer: remove `registerGuardianRoutes` and `POST /api/guardian/escalate`; stop importing `isLoopbackAddress` / `buildGuardianEscalationNotification` (delete them here if unused, else leave a local copy for non-OVM loopback routes). Regression fixture: calendar-reminder Telegram paging still sends. Precedes B2/B3. | B1,B2 | `npx vitest run tests/guardian-removal.test.ts --minWorkers=1 --maxWorkers=4` | 25 | A0 | L2 | L3 | no | standard | 4 |
-| B7 | RELEASE-ATOMIC schema layer: bump `SCHEMA_VERSION`, remove OVM DDL, and on upgrade copy the DB being migrated to `<that-db-path>.pre-ovm-drop-<UTC>.bak` before dropping `overmind_projects`, `overmind_workflows`, `overmind_task_history`. Prove fresh-vs-upgrade parity only on temp copies. Live path `data/agjassist.db.pre-ovm-drop-<UTC>.bak` is G2 execute-only. Isolated runner tears down the temp DB. | A4 | `node scripts/cc-run-isolated.mjs --slice B7 -- npx vitest run tests/unit/command-center-migration.spec.ts --minWorkers=1 --maxWorkers=4` | 35 | A0 | L4 | L4 | no | standard | 5 |
+| B7 | RELEASE-ATOMIC schema layer: bump `SCHEMA_VERSION`, remove OVM DDL, and on upgrade copy the DB being migrated to `<that-db-path>.pre-ovm-drop-<UTC>-<PID>.bak` before dropping `overmind_projects`, `overmind_workflows`, `overmind_task_history`. Prove fresh-vs-upgrade parity only on temp copies. Live path `data/agjassist.db.pre-ovm-drop-<UTC>-<PID>.bak` is G2 execute-only. Isolated runner tears down the temp DB. | A4 | `node scripts/cc-run-isolated.mjs --slice B7 -- npx vitest run tests/unit/command-center-migration.spec.ts --minWorkers=1 --maxWorkers=4` | 35 | A0 | L4 | L4 | no | standard | 5 |
 | B8 | INTEGRATION: F-OVM OVM and guardian are gone while the app boots and core surfaces remain — composes B1,B2,B3,B4,B5,B6,B7 because teardown is one rollback domain and any survivor leaves OVM exposed, stale schema, or a broken bootstrap; load the built Mini App and real API on a temp `DB_PATH` copy; run unit plus terminal-ux e2e; never touch live DB or pm2. `--gate` requires the positive journey PASS and `FENCE_STUB=B2` FAIL on named A2 kind=assert. | A1,A2,A3,A4,A5,B1,B2 | `FENCE_ID=B8 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate` | 45 | B1,B2,B3,B4,B5,B6,B7 | L4 | L4 | no | elite | 5 |
 | C1 | Schema layer: additive `agent_solicit_reminders` plus recipient rows in `SCHEMA_SQL` and `DatabaseService` migrations (folder-group, cadence, repeat limit, include/skip, next-fire, fresh-vs-upgrade). Do not alter calendar `reminders`. | C1,C2,C3,C4,C6 | `node scripts/cc-run-isolated.mjs --slice C1 -- npx vitest run tests/unit/agent-reminder-schema.spec.ts --minWorkers=1 --maxWorkers=4` | 30 | B8 | L3 | L3 | no | standard | 4 |
 | C2 | Services layer: `AgentSolicitService` CRUD and due-state for preset/custom cadence, stop-after-N or unlimited, immediate include/skip, persisted active-reminder projections. | C2,C3,C4,C6 | `node scripts/cc-run-isolated.mjs --slice C2 -- npx vitest run tests/unit/agent-reminder-service.spec.ts --minWorkers=1 --maxWorkers=4` | 30 | A0,C1 | L2 | L2 | no | standard | 4 |
diff --git a/src/db/database.ts b/src/db/database.ts
index 6b9b8fd..6dde317 100644
--- a/src/db/database.ts
+++ b/src/db/database.ts
@@ -176,7 +176,7 @@ export class DatabaseService {
       }
 
       // Migration: v9 → v10: make notes.project_id nullable (recreate table)
-      if (current && current.version < 10 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
+      if (current && current.version < 10) {
         // Check if notes table has NOT NULL on project_id by trying an insert
         // Safer approach: recreate table without NOT NULL constraint
         this.db.exec("PRAGMA foreign_keys = OFF");
@@ -203,7 +203,7 @@ export class DatabaseService {
       }
 
       // Migration: v10 → v11: add overmind_workflows table
-      if (current && current.version < 11 && this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='overmind_workflows'").get()) {
+      if (current && current.version < 11) {
         this.db.exec(SCHEMA_SQL);
       }
 
diff --git a/tests/unit/command-center-migration.spec.ts b/tests/unit/command-center-migration.spec.ts
index 31c2f82..6b9889d 100644
--- a/tests/unit/command-center-migration.spec.ts
+++ b/tests/unit/command-center-migration.spec.ts
@@ -22,10 +22,7 @@ afterEach(() => {
 function normalizeSql(sql: string | null): string | null {
   if (sql === null) return null;
   return sql
-    .replace(
-      /^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[^\s(]+)/i,
-      "CREATE TABLE <table>"
-    )
+    .replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"([^"]+)"/i, "CREATE TABLE $1")
     .replace(/\s+/g, " ")
     .replace(/\s*([(),=])\s*/g, "$1")
     .trim();
@@ -93,6 +90,58 @@ function createLegacyV22Fixture(dbPath: string): void {
   raw.close();
 }
 
+function createLegacyV9Fixture(dbPath: string): void {
+  const raw = new Database(dbPath);
+  raw.exec(`
+    PRAGMA foreign_keys = ON;
+
+    CREATE TABLE schema_version (
+      version INTEGER NOT NULL
+    );
+    INSERT INTO schema_version (version) VALUES (9);
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
+    CREATE TABLE projects (
+      id INTEGER PRIMARY KEY,
+      directory_name TEXT UNIQUE NOT NULL,
+      display_name TEXT,
+      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
+      active INTEGER NOT NULL DEFAULT 1,
+      created_at TEXT NOT NULL DEFAULT (datetime('now')),
+      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
+    );
+
+    CREATE TABLE notes (
+      id INTEGER PRIMARY KEY,
+      project_id INTEGER NOT NULL REFERENCES projects(id),
+      title TEXT,
+      body TEXT NOT NULL,
+      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'promoted', 'archived')),
+      tags TEXT,
+      created_by INTEGER NOT NULL REFERENCES users(id),
+      created_at TEXT NOT NULL DEFAULT (datetime('now')),
+      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
+    );
+
+    INSERT INTO users (id, telegram_id, role) VALUES (1, 1001, 'owner');
+    INSERT INTO projects (id, directory_name) VALUES (1, 'legacy-project');
+    INSERT INTO notes (id, project_id, body, created_by) VALUES (1, 1, 'legacy note', 1);
+  `);
+  raw.close();
+}
+
 describe("command-center migration B7", () => {
   it("fresh DB has schema version 37 and no OVM tables", () => {
     const dbPath = tempDb("fresh.sqlite");
@@ -182,4 +231,20 @@ describe("command-center migration B7", () => {
 
     expect(upgradedFp).toEqual(freshFp);
   });
+
+  it("upgrade from v9 makes notes.project_id nullable", () => {
+    const dbPath = tempDb("v9.sqlite");
+    createLegacyV9Fixture(dbPath);
+
+    const upgraded = new DatabaseService(dbPath);
+    try {
+      const cols = upgraded.raw.pragma("table_info(notes)") as Array<{ name: string; notnull: number }>;
+      expect(cols.find(c => c.name === "project_id")!.notnull).toBe(0);
+      expect(() => upgraded.prepare(
+        "INSERT INTO notes (project_id, body, created_by) VALUES (NULL, 'x', 1)"
+      ).run()).not.toThrow();
+    } finally {
+      upgraded.close();
+    }
+  });
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
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/B7-fix-a5.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=B7 attempt=5 marker=DRV-B7-24 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
