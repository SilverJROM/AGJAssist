# [driver] E1 — THE COMMIT UNDER TEST IS `599012e0be9ab62bf92b77f0125782201b4bed1d`

Analyse EXACTLY that commit: `git show 599012e0be9ab62bf92b77f0125782201b4bed1d`, `git diff 599012e0be9ab62bf92b77f0125782201b4bed1d^..599012e0be9ab62bf92b77f0125782201b4bed1d`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=599012e0be9ab62bf92b77f0125782201b4bed1d`.

## The change under test (produced by the driver, not reported by the implementer)
```
[E1] add agent_one_time_wakeups schema and tests


 src/db/schema.ts                       |  12 ++++
 tests/unit/agent-wakeup-schema.spec.ts | 105 +++++++++++++++++++++++++++++++++
 2 files changed, 117 insertions(+)
```
```diff
diff --git a/src/db/schema.ts b/src/db/schema.ts
index 9eb21bd..92dbb59 100644
--- a/src/db/schema.ts
+++ b/src/db/schema.ts
@@ -494,6 +494,18 @@ CREATE TABLE IF NOT EXISTS agent_summaries (
 CREATE INDEX IF NOT EXISTS idx_agent_summaries_agent ON agent_summaries(agent_name);
 CREATE INDEX IF NOT EXISTS idx_agent_summaries_endpoint ON agent_summaries(endpoint_id);
 CREATE INDEX IF NOT EXISTS idx_agent_summaries_created ON agent_summaries(created_at);
+
+CREATE TABLE IF NOT EXISTS agent_one_time_wakeups (
+  id INTEGER PRIMARY KEY,
+  pane_target TEXT NOT NULL,
+  manual_fire_time TEXT NOT NULL,
+  action TEXT NOT NULL,
+  status TEXT NOT NULL CHECK(status IN ('pending','fired','cancelled')) DEFAULT 'pending',
+  created_at TEXT NOT NULL DEFAULT (datetime('now')),
+  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
+);
+CREATE INDEX IF NOT EXISTS idx_agent_one_time_wakeups_status ON agent_one_time_wakeups(status);
+CREATE INDEX IF NOT EXISTS idx_agent_one_time_wakeups_fire_time ON agent_one_time_wakeups(manual_fire_time);
 `;
 
 export const DEFAULT_SAFETY_PATTERNS = [
diff --git a/tests/unit/agent-wakeup-schema.spec.ts b/tests/unit/agent-wakeup-schema.spec.ts
new file mode 100644
index 0000000..85504e9
--- /dev/null
+++ b/tests/unit/agent-wakeup-schema.spec.ts
@@ -0,0 +1,105 @@
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
+  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agjassist-agent-wakeup-"));
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
+describe("agent_one_time_wakeups schema E1", () => {
+  it("fresh DB has schema version 39 and agent_one_time_wakeups table", () => {
+    const dbPath = tempDb("fresh.sqlite");
+    const db = new DatabaseService(dbPath);
+    const version = db.prepare("SELECT version FROM schema_version").get() as { version: number };
+    expect(version.version).toBe(39);
+
+    const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
+    const names = tables.map(t => t.name);
+    expect(names).toContain("agent_one_time_wakeups");
+
+    const cols = db.raw.pragma("table_info(agent_one_time_wakeups)") as Array<{ name: string }>;
+    const colNames = cols.map(c => c.name);
+    expect(colNames).toContain("id");
+    expect(colNames).toContain("pane_target");
+    expect(colNames).toContain("manual_fire_time");
+    expect(colNames).toContain("action");
+    expect(colNames).toContain("status");
+    expect(colNames).toContain("created_at");
+    expect(colNames).toContain("updated_at");
+
+    db.close();
+  });
+
+  it("upgrade from v38 creates agent_one_time_wakeups table", () => {
+    const upgradePath = tempDb("upgrade.sqlite");
+    createLegacyV38Fixture(upgradePath);
+    const upgraded = new DatabaseService(upgradePath);
+    const version = upgraded.prepare("SELECT version FROM schema_version").get() as { version: number };
+    expect(version.version).toBe(39);
+
+    const tables = upgraded.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
+    const names = tables.map(t => t.name);
+    expect(names).toContain("agent_one_time_wakeups");
+
+    const cols = upgraded.raw.pragma("table_info(agent_one_time_wakeups)") as Array<{ name: string }>;
+    const colNames = cols.map(c => c.name);
+    expect(colNames).toContain("pane_target");
+    expect(colNames).toContain("manual_fire_time");
+    expect(colNames).toContain("action");
+    expect(colNames).toContain("status");
+
+    upgraded.close();
+  });
+
+  it("agent_one_time_wakeups supports pane, manual fire time, action, status", () => {
+    const dbPath = tempDb("test.sqlite");
+    const db = new DatabaseService(dbPath);
+
+    db.prepare(`
+      INSERT INTO agent_one_time_wakeups (pane_target, manual_fire_time, action, status)
+      VALUES (?, ?, ?, ?)
+    `).run("pane-123", "2026-01-01 00:00:00", "echo hello", "pending");
+
+    const id = db.prepare("SELECT last_insert_rowid() as id").get() as { id: number };
+    const row = db.prepare("SELECT * FROM agent_one_time_wakeups WHERE id = ?").get(id.id) as any;
+    expect(row.pane_target).toBe("pane-123");
+    expect(row.manual_fire_time).toBe("2026-01-01 00:00:00");
+    expect(row.action).toBe("echo hello");
+    expect(row.status).toBe("pending");
+
+    // Update status
+    db.prepare("UPDATE agent_one_time_wakeups SET status = ? WHERE id = ?").run("fired", id.id);
+    const updated = db.prepare("SELECT status FROM agent_one_time_wakeups WHERE id = ?").get(id.id) as { status: string };
+    expect(updated.status).toBe("fired");
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

# THE SLICE — E1 (run command-center-2026-08-26)

## Scope (do ONLY this)
Schema layer: additive `agent_one_time_wakeups` (pane, manual fire time, action, pending/fired/cancelled, fresh-vs-upgrade). Do not reuse OVM `agent_wake_schedule`. Capability-independent of summaries, but deps D1 so `SCHEMA_VERSION` / `schema.ts` edits serialize C1→D1→E1 (no parallel bump).

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **D1** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **D2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **D3** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`node scripts/cc-run-isolated.mjs --slice E1 -- npx vitest run tests/unit/agent-wakeup-schema.spec.ts --minWorkers=1 --maxWorkers=4`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=E1 attempt=1 role=validator
  marker=DRV-E1-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate E1 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator E1 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/E1-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=E1 attempt=1 marker=DRV-E1-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
