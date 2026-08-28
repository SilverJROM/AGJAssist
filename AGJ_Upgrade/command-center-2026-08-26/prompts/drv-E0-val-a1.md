# [driver] E0 — THE COMMIT UNDER TEST IS `5605eec54f77a3afb71c3485a6c7345ffe98bb6a`

Analyse EXACTLY that commit: `git show 5605eec54f77a3afb71c3485a6c7345ffe98bb6a`, `git diff 5605eec54f77a3afb71c3485a6c7345ffe98bb6a^..5605eec54f77a3afb71c3485a6c7345ffe98bb6a`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=5605eec54f77a3afb71c3485a6c7345ffe98bb6a`.

## The change under test (produced by the driver, not reported by the implementer)
```
[E0] rewrite wakeup fence harness for E3 pending and E2 fire-once


 e2e/command-center-wakeup-fence.spec.ts | 129 +++++++++++++++++++++++++-------
 1 file changed, 102 insertions(+), 27 deletions(-)
```
```diff
diff --git a/e2e/command-center-wakeup-fence.spec.ts b/e2e/command-center-wakeup-fence.spec.ts
index 4f2090a..db30cd7 100644
--- a/e2e/command-center-wakeup-fence.spec.ts
+++ b/e2e/command-center-wakeup-fence.spec.ts
@@ -1,50 +1,125 @@
 import { test, expect } from '@playwright/test';
 import fs from 'node:fs';
 import path from 'node:path';
+import { spawnSync } from 'node:child_process';
+import Database from 'better-sqlite3';
 
 const ACCEPTANCE_IDS = ['D1','D2','D3'] as const;
 const REPORT_PATH = path.resolve(process.env.FENCE_REPORT_PATH || 'fence-report-v1.json');
-const APP_ORIGIN = 'http://localhost:3210';
+const APP_ORIGIN = process.env.FENCE_ORIGIN || 'http://localhost:3210';
+const OWNER_TOKEN = process.env.OWNER_TOKEN || 'REDACTED_TEST_JWT';
+const AUTH_HEADERS = { authorization: `Bearer ${OWNER_TOKEN}` };
+const FENCE_STUB = process.env.FENCE_STUB || '';
 
-test('command-center wakeup fence journey', async ({ page }) => {
+test('command-center wakeup fence journey', async ({ page }, testInfo) => {
   const passed: string[] = [];
-  const failed: {id:string; kind:'assert'}[] = [];
+  const failed: {id:string; kind:'assert'; message?:string}[] = [];
 
   const check = async (id: typeof ACCEPTANCE_IDS[number], assertion: () => Promise<void>) => {
     try {
       await assertion();
       passed.push(id);
-    } catch {
-      failed.push({ id, kind: 'assert' });
-      throw new Error(`FENCE_ASSERT:${id}`);
+    } catch (e) {
+      failed.push({ id, kind: 'assert', message: e?.message || String(e) });
     }
   };
 
-  try {
-    await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: 'domcontentloaded' });
+  await page.addInitScript((ownerToken) => {
+    localStorage.setItem('agj_token', ownerToken);
+    localStorage.setItem('agj_user', JSON.stringify({ id: 1000000001, name: 'jrom', role: 'owner' }));
+  }, OWNER_TOKEN);
 
-    await check('D1', async () => {
-      const resp = await page.request.get(`${APP_ORIGIN}/api/agent-wakeups`);
-      expect(resp.status()).toBe(200);
-    });
+  await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: 'domcontentloaded' });
 
-    await check('D2', async () => {
-      await page.goto(`${APP_ORIGIN}/index.html#/agents`, { waitUntil: 'domcontentloaded' });
-      const sheet = page.locator('[data-testid="wakeup-sheet"]');
-      await expect(sheet).toBeVisible();
-    });
+  const uid = `${process.pid}-${testInfo.workerIndex}-${Date.now()}`;
+  const paneTarget = `wakeup-test-${uid}`;
+  const cleanup = () => {
+    spawnSync('bash', ['-c', `tmux kill-session -t ${paneTarget} || true`]);
+  };
 
-    await check('D3', async () => {
-      // Literal fixture: pending chip clears after fire
-      const resp = await page.request.post(`${APP_ORIGIN}/api/agent-wakeups/fire`, { data: { id: 'test' } });
-      expect(resp.status()).toBe(200);
+  // D1: schedule one-time wakeup on single agent (owner-only POST)
+  await check('D1', async () => {
+    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
+    const resp = await page.request.post(`${APP_ORIGIN}/api/agent-wakeups`, {
+      headers: AUTH_HEADERS,
+      data: {
+        pane_target: paneTarget,
+        manual_fire_time: future,
+        action: 'LITERAL_ACTION_D1'
+      }
     });
-  } catch (error) {
-    const isNamedAssertion = error instanceof Error && error.message.startsWith('FENCE_ASSERT:');
-    if (!isNamedAssertion) throw error;
+    expect(resp.status()).toBe(201);
+    const json = await resp.json();
+    expect(json.wakeup).toBeTruthy();
+    expect(json.wakeup.pane_target).toBe(paneTarget);
+  });
+
+  // D2: pending wakeup indicator via owner-only GET /api/agent-wakeups/pending
+  await check('D2', async () => {
+    const resp = await page.request.get(`${APP_ORIGIN}/api/agent-wakeups/pending`, { headers: AUTH_HEADERS });
+    expect(resp.status()).toBe(200);
+    const json = await resp.json();
+    expect(Array.isArray(json.wakeups)).toBe(true);
+    const found = json.wakeups.some((w: any) => w.pane_target === paneTarget);
+    expect(found).toBe(true);
+  });
+
+  // D3: fire-once into a temp pane; FENCE_STUB=E2 forces failure
+  await check('D3', async () => {
+    if (FENCE_STUB === 'E2') {
+      throw new Error('FENCE_STUB=E2 forces D3 failure');
+    }
+    const dbPath = process.env.DB_PATH;
+    if (!dbPath) throw new Error('DB_PATH missing');
+    const db = new Database(dbPath);
+    const past = new Date(Date.now() - 60_000).toISOString();
+    const action = 'LITERAL_ACTION_D3';
+    db.prepare(`INSERT INTO agent_one_time_wakeups (pane_target, manual_fire_time, action, status) VALUES (?, ?, ?, 'pending')`).run(paneTarget, past, action);
+    db.close();
+
+    // Create temp tmux session to receive the action
+    spawnSync('bash', ['-c', `tmux new-session -d -s ${paneTarget} "sleep 300"`]);
+    await page.waitForTimeout(200);
+
+    // Fire due wakeups via the service
+    const script = `
+import { AgentWakeupService } from './src/services/agent-wakeup-service.js';
+import { DatabaseService } from './src/db/database.js';
+const db = new DatabaseService(process.env.DB_PATH);
+const svc = new AgentWakeupService(db);
+await svc.fireDue();
+`;
+    const tmpScript = path.join(process.cwd(), `.wakeup-fire-${uid}.mjs`);
+    fs.writeFileSync(tmpScript, script);
+    try {
+      const result = spawnSync(process.execPath, ['--import', 'tsx', tmpScript], { env: process.env, encoding: 'utf8' });
+      expect(result.status).toBe(0);
+    } finally {
+      try { fs.unlinkSync(tmpScript); } catch {}
+    }
+
+    // Verify the wakeup was marked fired
+    const db2 = new Database(dbPath);
+    const row = db2.prepare(`SELECT status FROM agent_one_time_wakeups WHERE pane_target = ? AND action = ?`).get(paneTarget, action) as any;
+    db2.close();
+    expect(row).toBeTruthy();
+    expect(row.status).toBe('fired');
+  });
+
+  const writeReport = () => {
+    const report = {
+      schema: 'fence-report-v1',
+      collected: [...ACCEPTANCE_IDS],
+      passed,
+      failed
+    };
+    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
+  };
+
+  try {
+    expect(failed, `FENCE failures: ${JSON.stringify(failed)}`).toEqual([]);
   } finally {
-    fs.writeFileSync(REPORT_PATH, JSON.stringify({ schema:'fence-report-v1', collected: [...ACCEPTANCE_IDS], passed, failed }, null, 2));
+    cleanup();
+    writeReport();
   }
-
-  expect(failed, `FENCE failures: ${JSON.stringify(failed)}`).toEqual([]);
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

# THE SLICE — E0 (run command-center-2026-08-26)

## Scope (do ONLY this)
HARNESS-CORRECTNESS ONLY. Rewrite e2e/command-center-wakeup-fence.spec.ts against real E3 owner-only GET /api/agent-wakeups/pending and E2 fire-once into a temp pane. Do not invent GET /api/agent-wakeups 200 or POST /api/agent-wakeups/fire. Use FENCE_ORIGIN and OWNER_TOKEN. Collect ALL of D1,D2,D3 (do not abort after the first fail). FENCE_STUB=E2 named-red on D3 kind=assert. Write fence-report-v1.json in finally. Do not add product routes.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **HARNESS-SMOKE** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`FENCE_ID=E5 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=E0 attempt=1 role=validator
  marker=DRV-E0-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate E0 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator E0 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/E0-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=E0 attempt=1 marker=DRV-E0-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
