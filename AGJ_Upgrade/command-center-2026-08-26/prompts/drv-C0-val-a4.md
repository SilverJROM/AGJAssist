# [driver] C0 — THE COMMIT UNDER TEST IS `6811b3fa6ed8750a5004a0268df055831dbcb21f`

Analyse EXACTLY that commit: `git show 6811b3fa6ed8750a5004a0268df055831dbcb21f`, `git diff 6811b3fa6ed8750a5004a0268df055831dbcb21f^..6811b3fa6ed8750a5004a0268df055831dbcb21f`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=6811b3fa6ed8750a5004a0268df055831dbcb21f`.

## The change under test (produced by the driver, not reported by the implementer)
```
[C0] fix C0 correction attempt 3 token bootstrap, real fireDue, unique tmux sessions, C5 UI negative control


 e2e/command-center-reminders-fence.spec.ts  | 53 ++++++++++++++++-------------
 e2e/run-command-center-playwright-fence.mjs | 46 +++++++++++++++++++------
 playwright.cc.config.ts                     |  8 +++--
 scripts/cc-run-isolated.mjs                 | 11 +++---
 src/api/server.ts                           |  2 +-
 src/web/public/app.js                       |  2 +-
 6 files changed, 79 insertions(+), 43 deletions(-)
```
```diff
diff --git a/e2e/command-center-reminders-fence.spec.ts b/e2e/command-center-reminders-fence.spec.ts
index ddcbd3f..bf39857 100644
--- a/e2e/command-center-reminders-fence.spec.ts
+++ b/e2e/command-center-reminders-fence.spec.ts
@@ -2,12 +2,14 @@ import { test, expect } from '@playwright/test';
 import fs from 'node:fs';
 import path from 'node:path';
 import { spawnSync } from 'node:child_process';
+import Database from 'better-sqlite3';
 
 const ACCEPTANCE_IDS = ['C1','C2','C3','C4','C5','C6'] as const;
 const REPORT_PATH = path.resolve(process.env.FENCE_REPORT_PATH || 'fence-report-v1.json');
-const APP_ORIGIN = 'http://localhost:3210';
+const APP_ORIGIN = process.env.FENCE_ORIGIN || 'http://localhost:3210';
 const OWNER_TOKEN = process.env.OWNER_TOKEN || 'REDACTED_TEST_JWT';
 const AUTH_HEADERS = { authorization: `Bearer ${OWNER_TOKEN}` };
+const FENCE_STUB = process.env.FENCE_STUB || '';
 
 test('command-center reminders fence journey', async ({ page }, testInfo) => {
   const passed: string[] = [];
@@ -43,22 +45,30 @@ test('command-center reminders fence journey', async ({ page }, testInfo) => {
     spawnSync('bash', ['-c', `tmux kill-session -t ${sessA} || true`]);
     spawnSync('bash', ['-c', `tmux kill-session -t ${sessB} || true`]);
   };
+  const fireDue = (folderGroup: string) => {
+    const result = spawnSync(process.execPath, [
+      '--import', 'tsx', 'scripts/cc-fire-due.mts',
+      '--user-id', '1', '--folder-group', folderGroup
+    ], { env: process.env, encoding: 'utf8' });
+    expect(result.status, result.stderr).toBe(0);
+  };
 
-  await page.addInitScript(() => {
-    localStorage.setItem('agj_token', OWNER_TOKEN);
+  await page.addInitScript((ownerToken) => {
+    localStorage.setItem('agj_token', ownerToken);
     localStorage.setItem('agj_user', JSON.stringify({ id: 1000000001, name: 'jrom', role: 'owner' }));
-  });
+  }, OWNER_TOKEN);
 
   await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: 'domcontentloaded' });
 
   try {
-    // C1 schema via DB/temp copy not GET /schema
+    // C1 schema is inspected directly from the runner-owned temp DB.
     await check('C1', async () => {
-      const resp = await page.request.get(`${APP_ORIGIN}/api/db/tables`, { headers: AUTH_HEADERS });
-      expect(resp.status()).toBe(200);
-      const json = await resp.json();
-      expect(Array.isArray(json.tables)).toBe(true);
-      expect(json.tables).toContain('agent_reminders');
+      expect(process.env.DB_PATH).toBeTruthy();
+      const db = new Database(process.env.DB_PATH!);
+      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row: { name: string }) => row.name);
+      db.close();
+      expect(tables).toContain('agent_solicit_reminders');
+      expect(tables).toContain('agent_solicit_recipients');
     });
 
     // C2 POST /api/agent-reminders with folder_group plus cadence_minutes plus recipients array
@@ -115,11 +125,7 @@ test('command-center reminders fence journey', async ({ page }, testInfo) => {
       spawnSync('bash', ['-c', `tmux new-session -d -s ${sessA} "sleep 300"`]);
       spawnSync('bash', ['-c', `tmux new-session -d -s ${sessB} "sleep 300"`]);
       await page.waitForTimeout(200);
-      const fireResp = await page.request.post(`${APP_ORIGIN}/api/test/fire-due`, {
-        headers: AUTH_HEADERS,
-        data: { userId: 1, folderGroup: groupId }
-      });
-      expect(fireResp.status()).toBe(200);
+      fireDue(groupId);
       const outA = spawnSync('bash', ['-c', `tmux capture-pane -p -t ${sessA}`]).stdout.toString();
       const outB = spawnSync('bash', ['-c', `tmux capture-pane -p -t ${sessB}`]).stdout.toString();
       expect(outA).toContain('LITERAL_SOLICIT_C3');
@@ -147,11 +153,16 @@ test('command-center reminders fence journey', async ({ page }, testInfo) => {
       });
       expect(respCreate.status()).toBe(201);
       await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'domcontentloaded' });
-      await page.waitForSelector('[data-testid="terminal-menu"]', { state: 'attached' }).catch(() => {});
+      const panePicker = page.locator('select').filter({ hasText: 'Select a pane...' });
+      await panePicker.selectOption({ index: 1 });
+      await page.waitForSelector('[data-testid="terminal-menu"]', { state: 'attached' });
+      await page.locator('[data-testid="terminal-menu"]').click({ force: true });
       const sheet = page.locator('[data-testid="agent-reminder-sheet"]');
       await expect(sheet).toBeVisible();
-      const rowText = await sheet.locator('text=LITERAL_ACTIVE_C5').count();
-      expect(rowText).toBeGreaterThan(0);
+      await expect(sheet.locator('[data-testid="active-reminder-row"]')).toContainText('LITERAL_ACTIVE_C5');
+      if (FENCE_STUB === 'C3') {
+        throw new Error('C3 negative control hides the C5 active-reminder UI assertion');
+      }
     });
 
     // C6 solicit reached only included panes with real fire
@@ -174,11 +185,7 @@ test('command-center reminders fence journey', async ({ page }, testInfo) => {
       spawnSync('bash', ['-c', `tmux new-session -d -s ${sessA} "sleep 300"`]);
       spawnSync('bash', ['-c', `tmux new-session -d -s ${sessB} "sleep 300"`]);
       await page.waitForTimeout(200);
-      const fireResp = await page.request.post(`${APP_ORIGIN}/api/test/fire-due`, {
-        headers: AUTH_HEADERS,
-        data: { userId: 1, folderGroup: groupId }
-      });
-      expect(fireResp.status()).toBe(200);
+      fireDue(groupId);
       const outA = spawnSync('bash', ['-c', `tmux capture-pane -p -t ${sessA}`]).stdout.toString();
       const outB = spawnSync('bash', ['-c', `tmux capture-pane -p -t ${sessB}`]).stdout.toString();
       expect(outA).toContain('LITERAL_SOLICIT_C6');
diff --git a/e2e/run-command-center-playwright-fence.mjs b/e2e/run-command-center-playwright-fence.mjs
index a9ac40b..9590183 100644
--- a/e2e/run-command-center-playwright-fence.mjs
+++ b/e2e/run-command-center-playwright-fence.mjs
@@ -5,14 +5,17 @@ import { spawnSync } from 'node:child_process';
 import crypto from 'node:crypto';
 import jwt from 'jsonwebtoken';
 import Database from 'better-sqlite3';
+import dotenv from 'dotenv';
 
 const args = process.argv.slice(2);
 const fenceId = process.env.FENCE_ID || 'B8';
 const stub = process.env.FENCE_STUB || '';
 const harnessSmoke = args.includes('--harness-smoke');
 
-// Bootstrap owner token for fence tests
-function bootstrapOwnerToken() {
+dotenv.config();
+
+// Bootstrap an owner session in the isolated database used by this invocation.
+function bootstrapOwnerToken(dbPath) {
   const jwtSecret = process.env.JWT_SECRET || 'agjassist-dev-secret-change-me';
   const userId = 1;
   const telegramId = 1000000001;
@@ -20,14 +23,15 @@ function bootstrapOwnerToken() {
   const expiresAt = new Date(Date.now() + 24*3600*1000).toISOString();
   const token = jwt.sign({ sub: userId, sid: sessionId, tid: telegramId }, jwtSecret, { expiresIn: '24h' });
   const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
-  const dbPath = 'data/agjassist.db';
   const db = new Database(dbPath);
-  // Update existing session token hash
-  db.prepare('UPDATE sessions SET token_hash = ?, expires_at = ?, surface = ? WHERE id = ?').run(tokenHash, expiresAt, 'web', sessionId);
+  db.prepare(
+    `INSERT INTO sessions (id, user_id, token_hash, surface, expires_at)
+     VALUES (?, ?, ?, ?, ?)
+     ON CONFLICT(id) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at, surface = excluded.surface`
+  ).run(sessionId, userId, tokenHash, 'web', expiresAt);
   db.close();
   return token;
 }
-const OWNER_TOKEN = bootstrapOwnerToken();
 const gate = args.includes('--gate');
 
 const reportPath = path.resolve(process.cwd(), 'fence-report-v1.json');
@@ -59,12 +63,29 @@ function runPlaywright(testPath, env) {
   // --config points at the dedicated cc config: TestProject has no webServer
   // field, so a webServer nested under playwright.config.ts's 'cc' project
   // entry is silently ignored there (see playwright.cc.config.ts).
-  const mergedEnv = { ...env, OWNER_TOKEN };
+  const tmpDir = fs.mkdtempSync(path.join(process.cwd(), '.cc-fence-'));
+  const dbPath = path.join(tmpDir, 'agjassist.db');
+  fs.copyFileSync(path.resolve(process.env.DB_PATH_SOURCE || 'data/agjassist.db'), dbPath);
+  const ownerToken = bootstrapOwnerToken(dbPath);
+  const portProbe = spawnSync('bash', ['-c', 'ss -ltn "( sport = :3210 )" | grep -q LISTEN']);
+  const fencePort = portProbe.status === 0 ? '3211' : '3210';
+  const mergedEnv = {
+    ...env,
+    DB_PATH: dbPath,
+    OWNER_TOKEN: ownerToken,
+    AGJASSIST_FENCE_DB_MODE: 'temp-copy',
+    FENCE_PORT: fencePort,
+    FENCE_ORIGIN: `http://localhost:${fencePort}`
+  };
   const result = spawnSync('npx', ['playwright', 'test', testPath, '--project=cc', '--config=playwright.cc.config.ts', '--reporter=line'], {
     env: mergedEnv,
     stdio: 'inherit',
   });
-  return result.status ?? 1;
+  try {
+    return result.status ?? 1;
+  } finally {
+    fs.rmSync(tmpDir, { recursive: true, force: true });
+  }
 }
 
 function readReport(reportFilePath) {
@@ -122,9 +143,12 @@ if (gate) {
   const passed = posCode === 0;
   const expectedNegIds = fence.expected_negative_fail_ids || [];
   const expectedKind = fence.expected_negative_kind || 'assert';
-  const negFails = (negReport?.failed || []).filter(f => expectedNegIds.includes(f.id) && f.kind === expectedKind);
-  const failedNeg = negCode !== 0 && negFails.length === expectedNegIds.length;
-  const negFailedIds = negFails.map(f => ({ id: f.id, kind: f.kind }));
+  const negFails = negReport?.failed || [];
+  const expectedFailures = expectedNegIds.map(id => ({ id, kind: expectedKind }));
+  const failedNeg = negCode !== 0
+    && negFails.length === expectedFailures.length
+    && expectedFailures.every(expected => negFails.some(actual => actual?.id === expected.id && actual?.kind === expected.kind));
+  const negFailedIds = failedNeg ? expectedFailures : [];
   const overallPass = passed && failedNeg;
   const verdict = overallPass ? 'PASS' : 'FAIL';
   const faultClass = overallPass ? 'none' : 'implementation';
diff --git a/playwright.cc.config.ts b/playwright.cc.config.ts
index 0dc926d..ddab610 100644
--- a/playwright.cc.config.ts
+++ b/playwright.cc.config.ts
@@ -1,5 +1,7 @@
 import { defineConfig, devices } from '@playwright/test';
 
+const port = Number(process.env.FENCE_PORT || 3210);
+
 // Dedicated config for the command-center fence journeys' 'cc' project.
 // Split out from playwright.config.ts because TestProject has no webServer
 // field (only TestConfig does) — a webServer nested inside a `projects[]`
@@ -7,13 +9,13 @@ import { defineConfig, devices } from '@playwright/test';
 // actually boot the real Fastify server on an isolated temp-copy DB.
 export default defineConfig({
   testDir: 'e2e',
-  timeout: 30000,
+  timeout: 60000,
   projects: [
-    { name: 'cc', use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:3210' } },
+    { name: 'cc', use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${port}` } },
   ],
   webServer: {
     command: 'node scripts/cc-run-isolated.mjs --serve',
-    url: 'http://localhost:3210/index.html',
+    url: `http://localhost:${port}/index.html`,
     reuseExistingServer: false,
     timeout: 60000,
   },
diff --git a/scripts/cc-run-isolated.mjs b/scripts/cc-run-isolated.mjs
index 9b15a18..8d10a1b 100644
--- a/scripts/cc-run-isolated.mjs
+++ b/scripts/cc-run-isolated.mjs
@@ -9,7 +9,7 @@ const serve = args.includes('--serve');
 
 const SRC_DB = process.env.DB_PATH_SOURCE || 'data/agjassist.db';
 const srcDbPath = path.resolve(SRC_DB);
-const PUBLIC_PORT = 3210;
+const PUBLIC_PORT = Number(process.env.FENCE_PORT || 3210);
 
 function ensureTmpDb(tmpDir) {
   fs.mkdirSync(tmpDir, { recursive: true });
@@ -23,8 +23,9 @@ function ensureTmpDb(tmpDir) {
 }
 
 if (serve) {
-  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-'));
-  const tmpDb = ensureTmpDb(tmpDir);
+  const suppliedDb = process.env.DB_PATH;
+  const tmpDir = suppliedDb ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'cc-'));
+  const tmpDb = suppliedDb || ensureTmpDb(tmpDir);
   const startSize = fs.statSync(tmpDb).size;
   const env = {
     ...process.env,
@@ -38,7 +39,9 @@ if (serve) {
   // serves the shipped app through Fastify's own static registration, not a stand-in.
   const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], { stdio: 'inherit', env });
   const cleanup = () => {
-    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
+    if (tmpDir) {
+      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
+    }
     console.log(`reclaimed_bytes=${startSize}`);
     server.kill();
   };
diff --git a/src/api/server.ts b/src/api/server.ts
index 4fefdd4..a95f8ed 100644
--- a/src/api/server.ts
+++ b/src/api/server.ts
@@ -256,7 +256,7 @@ export async function createApiServer(
   });
 
   // Test-only scheduler tick under TEST_MODE
-  if (config.testMode) {
+  if (config.telegram.testMode) {
     app.post('/api/test/fire-due', async (request, reply) => {
       const { userId, folderGroup } = request.body as { userId?: number; folderGroup?: string };
       if (!userId) {
diff --git a/src/web/public/app.js b/src/web/public/app.js
index e512fb2..1e7da33 100644
--- a/src/web/public/app.js
+++ b/src/web/public/app.js
@@ -2919,7 +2919,7 @@ function TerminalTab({ projectId, projectName } = {}) {
               <div class="terminal-sheet-lbl">Active reminders</div>
               <div>
                 ${agentReminders.length === 0 ? html`<div>No active reminders</div>` : html`
-                  ${agentReminders.map(r => html`<div data-testid="active-reminder-row">${r.id || ''} ${r.cadence_minutes || ''} min</div>`)}
+                  ${agentReminders.map(r => html`<div data-testid="active-reminder-row">${r.solicit_message || r.id || ''} ${r.cadence_minutes || ''} min</div>`)}
                 `}
               </div>
             </div>
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

# THE SLICE — C0 (run command-center-2026-08-26)

## Scope (do ONLY this)
HARNESS-CORRECTNESS ONLY. Rewrite e2e/command-center-reminders-fence.spec.ts against the REAL C4 contract. Do not add product routes. Collect ALL of C1-C6 (do not abort after the first fail). Owner session required. C1 schema via DB/temp copy not GET /schema. C2 POST /api/agent-reminders with folder_group plus cadence_minutes plus recipients array. C3 fireDue into a real temp pane (not GET /due). C4 owner-gated GET /active. C5 UI sheet visible. C6 solicit reached only included panes. FENCE_STUB=C3 must force named C5 kind=assert red. Write fence-report-v1.json in finally with verdict_line tokens fence=C6 verdict=PASS or FAIL fault_class=none or implementation or plan.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **HARNESS-SMOKE** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`FENCE_ID=C6 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=C0 attempt=1 role=validator
  marker=DRV-C0-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate C0 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator C0 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/C0-fix-a4.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=C0 attempt=4 marker=DRV-C0-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
