# [driver] C0 — THE COMMIT UNDER TEST IS `4e854e9739c9300ec8e0411a52e4ac405936128b`

Analyse EXACTLY that commit: `git show 4e854e9739c9300ec8e0411a52e4ac405936128b`, `git diff 4e854e9739c9300ec8e0411a52e4ac405936128b^..4e854e9739c9300ec8e0411a52e4ac405936128b`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=4e854e9739c9300ec8e0411a52e4ac405936128b`.

## The change under test (produced by the driver, not reported by the implementer)
```
[C0] harness correctness: cherry-pick harness files, add cc-fire-due, fix audit parsing and remove stub throw


 e2e/command-center-reminders-fence.spec.ts  | 206 ++++++++++++++++++++++++----
 e2e/run-command-center-playwright-fence.mjs |  69 ++++++++--
 playwright.cc.config.ts                     |   8 +-
 scripts/cc-fire-due.mts                     |  45 ++++++
 scripts/cc-run-isolated.mjs                 |  11 +-
 5 files changed, 295 insertions(+), 44 deletions(-)
```
```diff
diff --git a/e2e/command-center-reminders-fence.spec.ts b/e2e/command-center-reminders-fence.spec.ts
index 8774c54..da562e1 100644
--- a/e2e/command-center-reminders-fence.spec.ts
+++ b/e2e/command-center-reminders-fence.spec.ts
@@ -1,67 +1,219 @@
 import { test, expect } from '@playwright/test';
 import fs from 'node:fs';
 import path from 'node:path';
+import { spawnSync } from 'node:child_process';
+import Database from 'better-sqlite3';
 
 const ACCEPTANCE_IDS = ['C1','C2','C3','C4','C5','C6'] as const;
 const REPORT_PATH = path.resolve(process.env.FENCE_REPORT_PATH || 'fence-report-v1.json');
-const APP_ORIGIN = 'http://localhost:3210';
+const APP_ORIGIN = process.env.FENCE_ORIGIN || 'http://localhost:3210';
+const OWNER_TOKEN = process.env.OWNER_TOKEN || 'REDACTED_TEST_JWT';
+const AUTH_HEADERS = { authorization: `Bearer ${OWNER_TOKEN}` };
+const FENCE_STUB = process.env.FENCE_STUB || '';
 
-test('command-center reminders fence journey', async ({ page }) => {
+test('command-center reminders fence journey', async ({ page }, testInfo) => {
   const passed: string[] = [];
   const failed: {id:string; kind:'assert'}[] = [];
 
-  const check = async (id: typeof ACCEPTANCE_IDS[number], assertion: () => Promise<void>) => {
+  const writeReport = () => {
+    const verdict = failed.length === 0 ? 'PASS' : 'FAIL';
+    const fault_class = failed.length === 0 ? 'none' : 'implementation';
+    const verdict_line = `fence=C6 verdict=${verdict} fault_class=${fault_class}`;
+    const report = {
+      schema: 'fence-report-v1',
+      verdict_line,
+      collected: [...ACCEPTANCE_IDS],
+      passed,
+      failed
+    };
+    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
+  };
+
+  const check = async (id, assertion) => {
     try {
       await assertion();
       passed.push(id);
     } catch {
       failed.push({ id, kind: 'assert' });
-      throw new Error(`FENCE_ASSERT:${id}`);
     }
   };
 
-  try {
-    await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: 'domcontentloaded' });
+  const uid = `${process.pid}-${testInfo.workerIndex}-${Date.now()}`;
+  const sessA = `agent-a-${uid}`;
+  const sessB = `agent-b-${uid}`;
+  const cleanupSessions = () => {
+    spawnSync('bash', ['-c', `tmux kill-session -t ${sessA} || true`]);
+    spawnSync('bash', ['-c', `tmux kill-session -t ${sessB} || true`]);
+  };
+  const fireDue = (folderGroup: string) => {
+    const result = spawnSync(process.execPath, [
+      '--import', 'tsx', 'scripts/cc-fire-due.mts',
+      '--user-id', '1', '--folder-group', folderGroup
+    ], { env: process.env, encoding: 'utf8' });
+    expect(result.status, result.stderr).toBe(0);
+  };
+
+  await page.addInitScript((ownerToken) => {
+    localStorage.setItem('agj_token', ownerToken);
+    localStorage.setItem('agj_user', JSON.stringify({ id: 1000000001, name: 'jrom', role: 'owner' }));
+  }, OWNER_TOKEN);
 
+  await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: 'domcontentloaded' });
+
+  try {
+    // C1 schema is inspected directly from the runner-owned temp DB.
     await check('C1', async () => {
-      const resp = await page.request.get(`${APP_ORIGIN}/api/agent-reminders/schema`);
-      expect(resp.status()).toBe(200);
+      expect(process.env.DB_PATH).toBeTruthy();
+      const db = new Database(process.env.DB_PATH!);
+      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row: { name: string }) => row.name);
+      db.close();
+      expect(tables).toContain('agent_solicit_reminders');
+      expect(tables).toContain('agent_solicit_recipients');
     });
 
+    // C2 POST /api/agent-reminders with folder_group plus cadence_minutes plus recipients array
     await check('C2', async () => {
-      const resp = await page.request.post(`${APP_ORIGIN}/api/agent-reminders`, { data: { cadence: '30m' } });
+      const resp = await page.request.post(`${APP_ORIGIN}/api/agent-reminders`, {
+        headers: AUTH_HEADERS,
+        data: {
+          folder_group: 'test-group',
+          cadence_minutes: 30,
+          recipients: [{ agent_name: 'agent-a', include: 1 }, { agent_name: 'agent-b', include: 0 }],
+          solicit_message: 'LITERAL_SOLICIT_C2'
+        }
+      });
       expect(resp.status()).toBe(201);
+      const json = await resp.json();
+      expect(json.reminder).toBeTruthy();
+      expect(json.reminder.folder_group).toBe('test-group');
+      expect(json.reminder.cadence_minutes).toBe(30);
     });
 
+    // Helper to ensure group with sessions
+    const ensureGroup = async (groupId, groupName, sessions) => {
+      const getResp = await page.request.get(`${APP_ORIGIN}/api/terminal/groups`, { headers: AUTH_HEADERS });
+      expect(getResp.status()).toBe(200);
+      const data = await getResp.json();
+      const groups = data.groups || [];
+      const existing = groups.find(g => g.id === groupId || g.name === groupName);
+      const updatedGroups = existing
+        ? groups.map(g => (g.id === existing.id ? { ...g, sessions: Array.from(new Set([...(g.sessions||[]), ...sessions])) } : g))
+        : [...groups, { id: groupId, name: groupName, sessions }];
+      const putResp = await page.request.put(`${APP_ORIGIN}/api/terminal/groups`, {
+        headers: AUTH_HEADERS,
+        data: { groups: updatedGroups, activeGroup: data.activeGroup || 'all' }
+      });
+      expect(putResp.status()).toBe(200);
+    };
+
+    // C3 fireDue into real temp pane
     await check('C3', async () => {
-      // Literal fixture: expect fireDue to process only included agents
-      const resp = await page.request.get(`${APP_ORIGIN}/api/agent-reminders/due`);
-      const json = await resp.json().catch(() => ({}));
-      expect(Array.isArray(json.due)).toBe(true);
+      const groupId = 'c3-test-group';
+      await ensureGroup(groupId, 'c3-test-group', [sessA, sessB]);
+      const past = new Date(Date.now() - 60_000).toISOString();
+      const resp = await page.request.post(`${APP_ORIGIN}/api/agent-reminders`, {
+        headers: AUTH_HEADERS,
+        data: {
+          folder_group: groupId,
+          cadence_minutes: 60,
+          next_fire: past,
+          solicit_message: 'LITERAL_SOLICIT_C3',
+          recipients: [{ agent_name: sessA, include: 1 }, { agent_name: sessB, include: 0 }]
+        }
+      });
+      expect(resp.status()).toBe(201);
+      spawnSync('bash', ['-c', `tmux new-session -d -s ${sessA} "sleep 300"`]);
+      spawnSync('bash', ['-c', `tmux new-session -d -s ${sessB} "sleep 300"`]);
+      await page.waitForTimeout(200);
+      fireDue(groupId);
+      const outA = spawnSync('bash', ['-c', `tmux capture-pane -p -t ${sessA}`]).stdout.toString();
+      const outB = spawnSync('bash', ['-c', `tmux capture-pane -p -t ${sessB}`]).stdout.toString();
+      expect(outA).toContain('LITERAL_SOLICIT_C3');
+      expect(outB).not.toContain('LITERAL_SOLICIT_C3');
     });
 
+    // C4 owner-gated GET /active
     await check('C4', async () => {
-      await page.goto(`${APP_ORIGIN}/index.html#/agents`, { waitUntil: 'domcontentloaded' });
-      const sheet = page.locator('[data-testid="agent-reminder-sheet"]');
-      await expect(sheet).toBeVisible();
+      const resp = await page.request.get(`${APP_ORIGIN}/api/agent-reminders/active`, { headers: AUTH_HEADERS });
+      expect(resp.status()).toBe(200);
+      const json = await resp.json();
+      expect(Array.isArray(json.reminders)).toBe(true);
     });
 
+    // C5 UI sheet visible with literal data
     await check('C5', async () => {
-      const resp = await page.request.get(`${APP_ORIGIN}/api/agent-reminders/active`);
-      expect(resp.status()).toBe(200);
+      const respCreate = await page.request.post(`${APP_ORIGIN}/api/agent-reminders`, {
+        headers: AUTH_HEADERS,
+        data: {
+          folder_group: 'c5-active-group',
+          cadence_minutes: 120,
+          recipients: [{ agent_name: 'agent-a', include: 1 }],
+          solicit_message: 'LITERAL_ACTIVE_C5'
+        }
+      });
+      expect(respCreate.status()).toBe(201);
+      await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'domcontentloaded' });
+      const panePicker = page.locator('select').filter({ hasText: 'Select a pane...' });
+      await panePicker.selectOption({ index: 1 });
+      await page.waitForSelector('[data-testid="terminal-menu"]', { state: 'attached' });
+      await page.locator('[data-testid="terminal-menu"]').click({ force: true });
+      const sheet = page.locator('[data-testid="agent-reminder-sheet"]');
+      await expect(sheet).toBeVisible();
+      await expect(sheet.locator('[data-testid="active-reminder-row"]')).toContainText('LITERAL_ACTIVE_C5');
     });
 
+    // C6 solicit reached only included panes with real fire
     await check('C6', async () => {
-      // Integration check: reminders fire into temp tmux pane
-      const resp = await page.request.get(`${APP_ORIGIN}/api/agent-reminders/fired`);
-      expect(resp.status()).toBe(200);
+      const groupId = 'c6-test-group';
+      await ensureGroup(groupId, 'c6-test-group', [sessA, sessB]);
+      const past = new Date(Date.now() - 60_000).toISOString();
+      const resp = await page.request.post(`${APP_ORIGIN}/api/agent-reminders`, {
+        headers: AUTH_HEADERS,
+        data: {
+          folder_group: groupId,
+          cadence_minutes: 60,
+          next_fire: past,
+          solicit_message: 'LITERAL_SOLICIT_C6',
+          recipients: [{ agent_name: sessA, include: 1 }, { agent_name: sessB, include: 0 }]
+        }
+      });
+      expect(resp.status()).toBe(201);
+      const reminderId = (await resp.json()).reminder.id;
+      spawnSync('bash', ['-c', `tmux new-session -d -s ${sessA} "sleep 300"`]);
+      spawnSync('bash', ['-c', `tmux new-session -d -s ${sessB} "sleep 300"`]);
+      await page.waitForTimeout(200);
+      fireDue(groupId);
+      const outA = spawnSync('bash', ['-c', `tmux capture-pane -p -t ${sessA}`]).stdout.toString();
+      const outB = spawnSync('bash', ['-c', `tmux capture-pane -p -t ${sessB}`]).stdout.toString();
+      expect(outA).toContain('LITERAL_SOLICIT_C6');
+      expect(outB).not.toContain('LITERAL_SOLICIT_C6');
+      const auditResp = await page.request.get(`${APP_ORIGIN}/api/audit?action_type=reminder_fire&agent_name=${sessA}`, { headers: AUTH_HEADERS });
+      expect(auditResp.status()).toBe(200);
+      const auditJson = await auditResp.json();
+      const hasAudit = (auditJson.entries || []).some(e => {
+        let details = e.details;
+        if (typeof details === 'string') {
+          try { details = JSON.parse(details); } catch {}
+        }
+        return details?.solicit_message === 'LITERAL_SOLICIT_C6';
+      });
+      expect(hasAudit).toBe(true);
+      const activeResp = await page.request.get(`${APP_ORIGIN}/api/agent-reminders/active`, { headers: AUTH_HEADERS });
+      expect(activeResp.status()).toBe(200);
+      const activeJson = await activeResp.json();
+      const rem = (activeJson.reminders || []).find(r => r.id === reminderId);
+      expect(rem).toBeTruthy();
+      expect(rem.repeat_count).toBeGreaterThan(0);
     });
-  } catch (error) {
-    const isNamedAssertion = error instanceof Error && error.message.startsWith('FENCE_ASSERT:');
-    if (!isNamedAssertion) throw error;
+
+    try {
+      expect(failed, `FENCE failures: ${JSON.stringify(failed)}`).toEqual([]);
+    } finally {
+      cleanupSessions();
+      writeReport();
+    }
   } finally {
-    fs.writeFileSync(REPORT_PATH, JSON.stringify({ schema:'fence-report-v1', collected: [...ACCEPTANCE_IDS], passed, failed }, null, 2));
+    cleanupSessions();
+    writeReport();
   }
-
-  expect(failed, `FENCE failures: ${JSON.stringify(failed)}`).toEqual([]);
 });
diff --git a/e2e/run-command-center-playwright-fence.mjs b/e2e/run-command-center-playwright-fence.mjs
index b4ecad3..9590183 100644
--- a/e2e/run-command-center-playwright-fence.mjs
+++ b/e2e/run-command-center-playwright-fence.mjs
@@ -2,11 +2,36 @@
 import fs from 'node:fs';
 import path from 'node:path';
 import { spawnSync } from 'node:child_process';
+import crypto from 'node:crypto';
+import jwt from 'jsonwebtoken';
+import Database from 'better-sqlite3';
+import dotenv from 'dotenv';
 
 const args = process.argv.slice(2);
 const fenceId = process.env.FENCE_ID || 'B8';
 const stub = process.env.FENCE_STUB || '';
 const harnessSmoke = args.includes('--harness-smoke');
+
+dotenv.config();
+
+// Bootstrap an owner session in the isolated database used by this invocation.
+function bootstrapOwnerToken(dbPath) {
+  const jwtSecret = process.env.JWT_SECRET || 'agjassist-dev-secret-change-me';
+  const userId = 1;
+  const telegramId = 1000000001;
+  const sessionId = 'test-session-c0';
+  const expiresAt = new Date(Date.now() + 24*3600*1000).toISOString();
+  const token = jwt.sign({ sub: userId, sid: sessionId, tid: telegramId }, jwtSecret, { expiresIn: '24h' });
+  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
+  const db = new Database(dbPath);
+  db.prepare(
+    `INSERT INTO sessions (id, user_id, token_hash, surface, expires_at)
+     VALUES (?, ?, ?, ?, ?)
+     ON CONFLICT(id) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at, surface = excluded.surface`
+  ).run(sessionId, userId, tokenHash, 'web', expiresAt);
+  db.close();
+  return token;
+}
 const gate = args.includes('--gate');
 
 const reportPath = path.resolve(process.cwd(), 'fence-report-v1.json');
@@ -23,10 +48,10 @@ function verdictLine(verdict='PASS', faultClass='none') {
   return `fence=${fenceId} verdict=${verdict} fault_class=${faultClass}`;
 }
 
-function writeReport(collected, passed, failed) {
+function writeReport(collected, passed, failed, verdict='PASS', faultClass='none') {
   const report = {
     schema: 'fence-report-v1',
-    verdict_line: verdictLine(),
+    verdict_line: verdictLine(verdict, faultClass),
     collected,
     passed,
     failed,
@@ -38,11 +63,29 @@ function runPlaywright(testPath, env) {
   // --config points at the dedicated cc config: TestProject has no webServer
   // field, so a webServer nested under playwright.config.ts's 'cc' project
   // entry is silently ignored there (see playwright.cc.config.ts).
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
-    env,
+    env: mergedEnv,
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
@@ -100,12 +143,18 @@ if (gate) {
   const passed = posCode === 0;
   const expectedNegIds = fence.expected_negative_fail_ids || [];
   const expectedKind = fence.expected_negative_kind || 'assert';
-  const negFails = (negReport?.failed || []).filter(f => expectedNegIds.includes(f.id) && f.kind === expectedKind);
-  const failedNeg = negCode !== 0 && negFails.length === expectedNegIds.length;
-  const negFailedIds = negFails.map(f => ({ id: f.id, kind: f.kind }));
-  writeReport(fence.acceptance_ids, passed ? fence.acceptance_ids : [], failedNeg ? negFailedIds : []);
-  console.log(verdictLine());
-  process.exit(passed && failedNeg ? 0 : 1);
+  const negFails = negReport?.failed || [];
+  const expectedFailures = expectedNegIds.map(id => ({ id, kind: expectedKind }));
+  const failedNeg = negCode !== 0
+    && negFails.length === expectedFailures.length
+    && expectedFailures.every(expected => negFails.some(actual => actual?.id === expected.id && actual?.kind === expected.kind));
+  const negFailedIds = failedNeg ? expectedFailures : [];
+  const overallPass = passed && failedNeg;
+  const verdict = overallPass ? 'PASS' : 'FAIL';
+  const faultClass = overallPass ? 'none' : 'implementation';
+  writeReport(fence.acceptance_ids, passed ? fence.acceptance_ids : [], failedNeg ? negFailedIds : [], verdict, faultClass);
+  console.log(verdictLine(verdict, faultClass));
+  process.exit(overallPass ? 0 : 1);
 }
 
 const testPath = fence.test_path;
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
diff --git a/scripts/cc-fire-due.mts b/scripts/cc-fire-due.mts
new file mode 100644
index 0000000..18ac039
--- /dev/null
+++ b/scripts/cc-fire-due.mts
@@ -0,0 +1,45 @@
+#!/usr/bin/env node
+import { DatabaseService } from '../src/db/database.js';
+import { AgentSolicitService } from '../src/services/agent-solicit-service.js';
+import { TmuxService } from '../src/tmux/tmux-service.js';
+import { SafetyService } from '../src/services/safety-service.js';
+import { AuditService } from '../src/services/audit-service.js';
+import { TerminalGroupsService } from '../src/services/terminal-groups-service.js';
+import { DelegationService } from '../src/services/delegation-service.js';
+import { AgentReminderScheduler } from '../src/services/agent-reminder-scheduler.js';
+
+const dbPath = process.env.DB_PATH;
+if (!dbPath) {
+  console.error('DB_PATH is required');
+  process.exit(1);
+}
+
+const db = new DatabaseService(dbPath);
+const solicitService = new AgentSolicitService(db);
+const safetyService = new SafetyService(db);
+const auditService = new AuditService(db);
+const groupsService = new TerminalGroupsService(db);
+const delegationService = new DelegationService(db, auditService);
+const tmuxService = new TmuxService();
+tmuxService.setSafetyService(safetyService);
+
+const scheduler = new AgentReminderScheduler(
+  solicitService,
+  tmuxService,
+  safetyService,
+  auditService,
+  groupsService,
+  delegationService
+);
+
+const args = process.argv.slice(2);
+const userIdIdx = args.indexOf('--user-id');
+const groupIdx = args.indexOf('--folder-group');
+if (userIdIdx === -1 || groupIdx === -1) {
+  console.error('Missing --user-id or --folder-group');
+  process.exit(1);
+}
+const userId = Number(args[userIdIdx + 1]);
+const folderGroup = args[groupIdx + 1];
+
+await schedul
... TRUNCATED at 20000 chars. This is a display bound, NOT the scope of your review — read the rest with `git show 4e854e9739c9300ec8e0411a52e4ac405936128b` before judging.
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
HARNESS-CORRECTNESS ONLY. Rewrite e2e/command-center-reminders-fence.spec.ts against the REAL C4 contract. Do not add product routes. Collect ALL of C1-C6 (do not abort after the first fail). Owner session required. C1 schema via DB/temp copy not GET /schema. C2 POST /api/agent-reminders with folder_group plus cadence_minutes plus recipients array. C3 fireDue into a real temp pane (not GET /due). C4 owner-gated GET /active. C5 UI sheet visible. C6 solicit reached only included panes. FENCE_STUB=C3 must force named C5 kind=assert red. Write fence-report-v1.json in finally with verdict_line tokens fence=C6 verdict=PASS or FAIL fault_class=none or implementation or plan. Budget 6 after a4 remaining gaps.

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
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/C0-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=C0 attempt=1 marker=DRV-C0-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
