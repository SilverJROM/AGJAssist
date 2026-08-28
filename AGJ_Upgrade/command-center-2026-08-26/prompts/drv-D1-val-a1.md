# [driver] D1 — THE COMMIT UNDER TEST IS `99dce4e5a38e54b7d2f6073063ec0ddf78cfd3be`

Analyse EXACTLY that commit: `git show 99dce4e5a38e54b7d2f6073063ec0ddf78cfd3be`, `git diff 99dce4e5a38e54b7d2f6073063ec0ddf78cfd3be^..99dce4e5a38e54b7d2f6073063ec0ddf78cfd3be`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=99dce4e5a38e54b7d2f6073063ec0ddf78cfd3be`.

## The change under test (produced by the driver, not reported by the implementer)
```
feat(D1): add summary_llm_endpoints and agent_summaries schema with provenance and timestamps


 src/db/schema.ts                  |  27 ++++++++-
 tests/unit/summary-schema.spec.ts | 124 ++++++++++++++++++++++++++++++++++++++
 2 files changed, 150 insertions(+), 1 deletion(-)
```
```diff
diff --git a/src/db/schema.ts b/src/db/schema.ts
index 2e4aa6b..44937fb 100644
--- a/src/db/schema.ts
+++ b/src/db/schema.ts
@@ -7,7 +7,7 @@
 
 import type Database from "better-sqlite3";
 
-export const SCHEMA_VERSION = 38;
+export const SCHEMA_VERSION = 39;
 
 export const SCHEMA_SQL = `
 CREATE TABLE IF NOT EXISTS schema_version (
@@ -468,6 +468,31 @@ CREATE TABLE IF NOT EXISTS agent_solicit_recipients (
 );
 CREATE INDEX IF NOT EXISTS idx_agent_solicit_recipients_reminder ON agent_solicit_recipients(reminder_id);
 CREATE INDEX IF NOT EXISTS idx_agent_solicit_recipients_agent ON agent_solicit_recipients(agent_name);
+
+CREATE TABLE IF NOT EXISTS summary_llm_endpoints (
+  id INTEGER PRIMARY KEY,
+  name TEXT NOT NULL UNIQUE,
+  base_url TEXT NOT NULL,
+  model TEXT NOT NULL,
+  is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)),
+  provenance TEXT NOT NULL DEFAULT 'user',
+  created_at TEXT NOT NULL DEFAULT (datetime('now')),
+  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
+);
+CREATE INDEX IF NOT EXISTS idx_summary_llm_endpoints_default ON summary_llm_endpoints(is_default);
+
+CREATE TABLE IF NOT EXISTS agent_summaries (
+  id INTEGER PRIMARY KEY,
+  agent_name TEXT NOT NULL,
+  endpoint_id INTEGER NOT NULL REFERENCES summary_llm_endpoints(id),
+  summary_text TEXT NOT NULL,
+  provenance TEXT NOT NULL DEFAULT 'system',
+  created_at TEXT NOT NULL DEFAULT (datetime('now')),
+  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
+);
+CREATE INDEX IF NOT EXISTS idx_agent_summaries_agent ON agent_summaries(agent_name);
+CREATE INDEX IF NOT EXISTS idx_agent_summaries_endpoint ON agent_summaries(endpoint_id);
+CREATE INDEX IF NOT EXISTS idx_agent_summaries_created ON agent_summaries(created_at);
 `;
 
 export const DEFAULT_SAFETY_PATTERNS = [
diff --git a/tests/unit/summary-schema.spec.ts b/tests/unit/summary-schema.spec.ts
new file mode 100644
index 0000000..641a83f
--- /dev/null
+++ b/tests/unit/summary-schema.spec.ts
@@ -0,0 +1,124 @@
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
+  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-summary-schema-"));
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
+function createLegacyV38Fixture(dbPath: string): void {
+  const raw = new Database(dbPath);
+  raw.exec(`
+    PRAGMA foreign_keys = ON;
+    CREATE TABLE schema_version (version INTEGER NOT NULL);
+    INSERT INTO schema_version (version) VALUES (38);
+    CREATE TABLE users (
+      id INTEGER PRIMARY KEY,
+      telegram_id INTEGER UNIQUE NOT NULL,
+      role TEXT NOT NULL DEFAULT 'viewer'
+    );
+  `);
+  raw.close();
+}
+
+describe("summary-schema D1", () => {
+  it("fresh DB has schema version 39 and summary tables", () => {
+    const dbPath = tempDb("fresh.sqlite");
+    const db = new DatabaseService(dbPath);
+    const version = db.prepare("SELECT version FROM schema_version").get() as { version: number };
+    expect(version.version).toBe(39);
+
+    const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
+    const names = tables.map(t => t.name);
+    expect(names).toContain("summary_llm_endpoints");
+    expect(names).toContain("agent_summaries");
+
+    const cols = db.raw.pragma("table_info(summary_llm_endpoints)") as Array<{ name: string }>;
+    const colNames = cols.map(c => c.name);
+    expect(colNames).toContain("name");
+    expect(colNames).toContain("base_url");
+    expect(colNames).toContain("model");
+    expect(colNames).toContain("is_default");
+    expect(colNames).toContain("provenance");
+    expect(colNames).toContain("created_at");
+    expect(colNames).toContain("updated_at");
+
+    const sumCols = db.raw.pragma("table_info(agent_summaries)") as Array<{ name: string }>;
+    const sumColNames = sumCols.map(c => c.name);
+    expect(sumColNames).toContain("agent_name");
+    expect(sumColNames).toContain("endpoint_id");
+    expect(sumColNames).toContain("summary_text");
+    expect(sumColNames).toContain("provenance");
+    expect(sumColNames).toContain("created_at");
+    expect(sumColNames).toContain("updated_at");
+
+    db.close();
+  });
+
+  it("upgrade from v38 creates summary tables", () => {
+    const upgradePath = tempDb("upgrade.sqlite");
+    createLegacyV38Fixture(upgradePath);
+    const upgraded = new DatabaseService(upgradePath);
+    const version = upgraded.prepare("SELECT version FROM schema_version").get() as { version: number };
+    expect(version.version).toBe(39);
+
+    const tables = upgraded.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
+    const names = tables.map(t => t.name);
+    expect(names).toContain("summary_llm_endpoints");
+    expect(names).toContain("agent_summaries");
+    upgraded.close();
+  });
+
+  it("summary_llm_endpoints supports default provenance timestamps and no secret columns", () => {
+    const dbPath = tempDb("test.sqlite");
+    const db = new DatabaseService(dbPath);
+
+    // Insert an endpoint with is_default = 1
+    db.prepare(`
+      INSERT INTO summary_llm_endpoints (name, base_url, model, is_default, provenance)
+      VALUES ('local-140', 'http://localhost:8080/v1', 'granite-3b', 1, 'seed')
+    `).run();
+
+    const ep = db.prepare("SELECT * FROM summary_llm_endpoints WHERE name = ?").get('local-140') as any;
+    expect(ep.name).toBe('local-140');
+    expect(ep.base_url).toBe('http://localhost:8080/v1');
+    expect(ep.model).toBe('granite-3b');
+    expect(ep.is_default).toBe(1);
+    expect(ep.provenance).toBe('seed');
+    expect(ep.created_at).toBeTruthy();
+    expect(ep.updated_at).toBeTruthy();
+
+    // Ensure no plaintext secret column exists
+    const cols = db.raw.pragma("table_info(summary_llm_endpoints)") as Array<{ name: string }>;
+    const colNames = cols.map(c => c.name);
+    expect(colNames).not.toContain("api_key");
+    expect(colNames).not.toContain("secret");
+
+    // Insert a summary referencing the endpoint
+    db.prepare(`
+      INSERT INTO agent_summaries (agent_name, endpoint_id, summary_text, provenance)
+      VALUES (?, ?, ?, ?)
+    `).run('agent-1', ep.id, 'short summary', 'system');
+
+    const sumRow = db.prepare("SELECT * FROM agent_summaries WHERE endpoint_id = ?").get(ep.id) as any;
+    expect(sumRow.agent_name).toBe('agent-1');
+    expect(sumRow.summary_text).toBe('short summary');
+    expect(sumRow.provenance).toBe('system');
+    expect(sumRow.created_at).toBeTruthy();
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

# THE SLICE — D1 (run command-center-2026-08-26)

## Scope (do ONLY this)
Schema layer: additive `summary_llm_endpoints` and `agent_summaries` with one default, provenance, timestamps, no plaintext secret columns, fresh-vs-upgrade parity.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **E1** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **E3** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **F2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **F3** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`node scripts/cc-run-isolated.mjs --slice D1 -- npx vitest run tests/unit/summary-schema.spec.ts --minWorkers=1 --maxWorkers=4`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=D1 attempt=1 role=validator
  marker=DRV-D1-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate D1 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator D1 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/D1-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=D1 attempt=1 marker=DRV-D1-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
