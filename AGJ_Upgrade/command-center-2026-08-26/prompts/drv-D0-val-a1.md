# [driver] D0 — THE COMMIT UNDER TEST IS `2459e938fd50d5888656ba6f33ca2426db2b12fb`

Analyse EXACTLY that commit: `git show 2459e938fd50d5888656ba6f33ca2426db2b12fb`, `git diff 2459e938fd50d5888656ba6f33ca2426db2b12fb^..2459e938fd50d5888656ba6f33ca2426db2b12fb`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=2459e938fd50d5888656ba6f33ca2426db2b12fb`.

## The change under test (produced by the driver, not reported by the implementer)
```
[D0] Reduce E1 poll budget and set Playwright test timeout for D7 fence


 e2e/command-center-summaries-fence.spec.ts | 241 +++++++++++++++++++++++++++--
 1 file changed, 224 insertions(+), 17 deletions(-)
```
```diff
diff --git a/e2e/command-center-summaries-fence.spec.ts b/e2e/command-center-summaries-fence.spec.ts
index 4472369..73d1b49 100644
--- a/e2e/command-center-summaries-fence.spec.ts
+++ b/e2e/command-center-summaries-fence.spec.ts
@@ -1,10 +1,16 @@
 import { test, expect } from '@playwright/test';
 import fs from 'node:fs';
 import path from 'node:path';
+import { spawnSync } from 'node:child_process';
+import http from 'node:http';
 
 const ACCEPTANCE_IDS = ['E1','E2','E3','F1','F2','F3'] as const;
 const REPORT_PATH = path.resolve(process.env.FENCE_REPORT_PATH || 'fence-report-v1.json');
-const APP_ORIGIN = 'http://localhost:3210';
+const APP_ORIGIN = process.env.FENCE_ORIGIN || 'http://localhost:3210';
+const OWNER_TOKEN = process.env.OWNER_TOKEN || '';
+const AUTH_HEADERS = { authorization: `Bearer ${OWNER_TOKEN}` };
+
+test.setTimeout(120000);
 
 test('command-center summaries fence journey', async ({ page }) => {
   const passed: string[] = [];
@@ -20,46 +26,247 @@ test('command-center summaries fence journey', async ({ page }) => {
     }
   };
 
+  await page.addInitScript((token) => {
+    localStorage.setItem('agj_token', token);
+    localStorage.setItem('agj_user', JSON.stringify({ id: 1000000001, name: 'jrom', role: 'owner' }));
+  }, OWNER_TOKEN);
+
+  let agentName: string | null = null;
+  let sessionName: string | null = null;
+  let folderGroup: string | null = null;
+  let defaultEndpointId: string | null = null;
+  let defaultEndpointName: string | null = null;
+  let fixtureServer: http.Server | null = null;
+  let fixturePort: number | null = null;
+
+  const cleanupSessions = () => {
+    if (sessionName) {
+      spawnSync('bash', ['-c', `tmux kill-session -t ${sessionName} || true`]);
+    }
+    if (fixtureServer) {
+      fixtureServer.close();
+    }
+  };
+
   try {
     await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: 'domcontentloaded' });
 
     await check('E1', async () => {
-      const resp = await page.request.get(`${APP_ORIGIN}/api/summary-endpoints`);
-      expect(resp.status()).toBe(200);
+      const pid = process.pid;
+      const ts = Date.now();
+      agentName = `fence-agent-${pid}-${ts}`;
+      sessionName = agentName;
+      folderGroup = `fence-group-${pid}-${ts}`;
+
+      spawnSync('bash', ['-c', `tmux new-session -d -s ${sessionName} bash`]);
+
+      const getGroupsResp = await page.request.get(`${APP_ORIGIN}/api/terminal/groups`, { headers: AUTH_HEADERS });
+      expect(getGroupsResp.status()).toBe(200);
+      const groupsData = await getGroupsResp.json();
+      const groups = groupsData.groups || [];
+      const updatedGroups = [...groups];
+      const existingIdx = updatedGroups.findIndex((g:any) => g.id === folderGroup || g.name === folderGroup);
+      if (existingIdx >= 0) {
+        const existing = updatedGroups[existingIdx];
+        updatedGroups[existingIdx] = { ...existing, sessions: Array.from(new Set([...(existing.sessions||[]), sessionName])) };
+      } else {
+        updatedGroups.push({ id: folderGroup, name: folderGroup, sessions: [sessionName] });
+      }
+      const putResp = await page.request.put(`${APP_ORIGIN}/api/terminal/groups`, {
+        headers: AUTH_HEADERS,
+        data: { groups: updatedGroups, activeGroup: groupsData.activeGroup || 'all' }
+      });
+      expect(putResp.status()).toBe(200);
+
+      const past = new Date(Date.now() - 60_000).toISOString();
+      const reminderResp = await page.request.post(`${APP_ORIGIN}/api/agent-reminders`, {
+        headers: AUTH_HEADERS,
+        data: {
+          folder_group: folderGroup!,
+          cadence_minutes: 60,
+          next_fire: past,
+          solicit_message: 'LITERAL_SOLICIT_SUMMARY',
+          recipients: [{ agent_name: sessionName!, include: 1 }]
+        }
+      });
+      expect(reminderResp.status()).toBe(201);
+
+      // Start local OpenAI-compatible fixture server
+      fixtureServer = http.createServer((req, res) => {
+        if (req.method === 'POST' && req.url === '/v1/chat/completions') {
+          res.writeHead(200, { 'Content-Type': 'application/json' });
+          res.end(JSON.stringify({ choices: [{ message: { content: 'LITERAL_SUMMARY_FOR_TEST' } }] }));
+        } else {
+          res.writeHead(404);
+          res.end();
+        }
+      });
+      await new Promise<void>((resolve) => {
+        fixtureServer!.listen(0, '127.0.0.1', () => {
+          const addr = fixtureServer!.address() as any;
+          fixturePort = addr.port;
+          resolve();
+        });
+      });
+
+      // Patch existing default endpoint base_url to fixture server (preserve default 140)
+      const epListResp = await page.request.get(`${APP_ORIGIN}/api/summary-endpoints`, { headers: AUTH_HEADERS });
+      expect(epListResp.status()).toBe(200);
+      const epListJson = await epListResp.json();
+      const defaultEp = epListJson.endpoints?.find((e:any)=>e.is_default);
+      expect(defaultEp).toBeTruthy();
+      defaultEndpointId = defaultEp.id;
+      defaultEndpointName = defaultEp.name;
+      const patchResp = await page.request.patch(`${APP_ORIGIN}/api/summary-endpoints/${defaultEp.id}`, {
+        headers: AUTH_HEADERS,
+        data: { base_url: `http://127.0.0.1:${fixturePort}/v1` }
+      });
+      expect(patchResp.status()).toBe(200);
+
+      const fireResult = spawnSync(process.execPath, [
+        '--import', 'tsx', 'scripts/cc-fire-due.mts',
+        '--user-id', '1', '--folder-group', folderGroup!
+      ], { env: process.env, encoding: 'utf8' });
+      expect(fireResult.status).toBe(0);
+
+      await page.waitForTimeout(500);
+
+      spawnSync('bash', ['-c', `tmux send-keys -t ${sessionName} "echo 'Reply: literal reply text'" Enter`]);
+
+      // Navigate to terminals to trigger production capture path
+      await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'networkidle' });
+      await page.waitForTimeout(2000);
+      const select = page.locator('select');
+      if (await select.count()) {
+        await page.evaluate((sess) => {
+          const sel = document.querySelector('select');
+          if (!sel) return;
+          for (const opt of Array.from(sel.options)) {
+            if (opt.textContent.includes(sess)) {
+              sel.value = opt.value;
+              sel.dispatchEvent(new Event('change', { bubbles: true }));
+              break;
+            }
+          }
+        }, sessionName!);
+        await page.waitForTimeout(1000);
+      }
+      // Open summaries dropdown to trigger UI-driven summary generation
+      const toggle = page.locator('[data-testid="summaries-toggle"]');
+      if (await toggle.count()) {
+        await toggle.click({ force: true });
+        await page.waitForTimeout(1000);
+      }
+
+      // Give production capture path time to process the pane reply
+      await page.waitForTimeout(10000);
+
+      // Verify endpoint is default
+      const epResp = await page.request.get(`${APP_ORIGIN}/api/summary-endpoints`, { headers: AUTH_HEADERS });
+      expect(epResp.status()).toBe(200);
+      const epJson2 = await epResp.json();
+      const defaultEp2 = epJson2.endpoints?.find((e:any)=>e.is_default);
+      expect(defaultEp2).toBeTruthy();
+      defaultEndpointId = defaultEp2.id;
+      defaultEndpointName = defaultEp2.name;
+
+      // Poll for summary via public API
+      let summary: any = null;
+      for (let i = 0; i < 40; i++) {
+        const sumResp = await page.request.get(`${APP_ORIGIN}/api/summary-agents/${agentName}/summaries`);
+        expect(sumResp.status()).toBe(200);
+        const sumJson = await sumResp.json();
+        const found = (sumJson.summaries || []).find((s:any) => s.summary_text === 'LITERAL_SUMMARY_FOR_TEST');
+        if (found) { summary = found; break; }
+        await page.waitForTimeout(500);
+      }
+      expect(summary).toBeTruthy();
+      expect(summary.summary_text).toBe('LITERAL_SUMMARY_FOR_TEST');
+      expect(summary.endpoint_id).toBe(defaultEndpointId);
     });
 
     await check('E2', async () => {
-      await page.goto(`${APP_ORIGIN}/index.html#/agents`, { waitUntil: 'domcontentloaded' });
-      const dropdown = page.locator('[data-testid="agent-summaries-dropdown"]');
-      await expect(dropdown).toBeVisible();
+      expect(agentName).toBeTruthy();
+      await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'networkidle' });
+      await page.waitForTimeout(1000);
+      const select = page.locator('select');
+      if (await select.count()) {
+        await page.evaluate((sess) => {
+          const sel = document.querySelector('select');
+          if (!sel) return;
+          for (const opt of Array.from(sel.options)) {
+            if (opt.textContent.includes(sess)) {
+              sel.value = opt.value;
+              sel.dispatchEvent(new Event('change', { bubbles: true }));
+              break;
+            }
+          }
+        }, sessionName!);
+        await page.waitForTimeout(500);
+      }
+      const toggle = page.locator('[data-testid="summaries-toggle"]');
+      if (await toggle.count()) {
+        await toggle.click({ force: true });
+        await page.waitForTimeout(500);
+      }
+      await expect(page.locator('[data-testid="agent-summaries-dropdown"]')).toBeVisible();
+      const card = page.locator('[data-testid="summary-card"]').first();
+      await expect(card).toBeVisible();
+      await expect(card).toContainText('LITERAL_SUMMARY_FOR_TEST');
+      // Endpoint name is preserved default 140
+      await expect(card).toContainText('140');
     });
 
     await check('E3', async () => {
-      const resp = await page.request.get(`${APP_ORIGIN}/api/agent-summaries`);
-      expect(resp.status()).toBe(200);
+      expect(agentName).toBeTruthy();
+      expect(defaultEndpointId).toBeTruthy();
+      const sumResp = await page.request.get(`${APP_ORIGIN}/api/summary-agents/${agentName}/summaries`, { headers: AUTH_HEADERS });
+      expect(sumResp.status()).toBe(200);
+      const sumJson = await sumResp.json();
+      const s = (sumJson.summaries || []).find((x:any) => x.summary_text === 'LITERAL_SUMMARY_FOR_TEST');
+      expect(s).toBeTruthy();
+      expect(s).toHaveProperty('endpoint_id');
+      expect(s).toHaveProperty('summary_text');
+      expect(s.summary_text).toBe('LITERAL_SUMMARY_FOR_TEST');
+      expect(s.endpoint_id).toBe(defaultEndpointId);
     });
 
     await check('F1', async () => {
-      const resp = await page.request.get(`${APP_ORIGIN}/api/summary-endpoints`);
-      const json = await resp.json().catch(() => ({}));
-      expect(json.endpoints?.some((e:any)=>e.label==='140')).toBe(true);
+      const epResp = await page.request.get(`${APP_ORIGIN}/api/summary-endpoints`, { headers: AUTH_HEADERS });
+      expect(epResp.status()).toBe(200);
+      const epJson = await epResp.json();
+      const ep = epJson.endpoints?.find((e:any)=>e.name==='140');
+      expect(ep).toBeTruthy();
+      expect(ep).toHaveProperty('base_url');
+      expect(ep).toHaveProperty('model');
     });
 
     await check('F2', async () => {
-      // Literal fixture check for endpoint config
-      const resp = await page.request.get(`${APP_ORIGIN}/api/summary-endpoints/default`);
-      expect(resp.status()).toBe(200);
+      const epResp = await page.request.get(`${APP_ORIGIN}/api/summary-endpoints`, { headers: AUTH_HEADERS });
+      const epJson = await epResp.json();
+      const ep = epJson.endpoints?.find((e:any)=>e.name==='140');
+      expect(ep).toBeTruthy();
+      expect(ep.is_default).toBeTruthy();
     });
 
     await check('F3', async () => {
-      await page.goto(`${APP_ORIGIN}/index.html#/settings/summary`, { waitUntil: 'domcontentloaded' });
-      const settings = page.locator('[data-testid="summary-endpoint-settings"]');
-      await expect(settings).toBeVisible();
+      const unauthResp = await page.request.get(`${APP_ORIGIN}/api/summary-endpoints`);
+      expect([401,403]).toContain(unauthResp.status());
+      const epResp = await page.request.get(`${APP_ORIGIN}/api/summary-endpoints`, { headers: AUTH_HEADERS });
+      const epJson = await epResp.json();
+      const endpoints = epJson.endpoints || [];
+      for (const e of endpoints) {
+        if (e.base_url) {
+          expect(e.base_url).not.toMatch(/:\/\/.+:.+@/);
+          expect(e.base_url).not.toContain('?api_key=');
+        }
+      }
     });
   } catch (error) {
     const isNamedAssertion = error instanceof Error && error.message.startsWith('FENCE_ASSERT:');
     if (!isNamedAssertion) throw error;
   } finally {
+    cleanupSessions();
     fs.writeFileSync(REPORT_PATH, JSON.stringify({ schema:'fence-report-v1', collected: [...ACCEPTANCE_IDS], passed, failed }, null, 2));
   }
 
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

# THE SLICE — D0 (run command-center-2026-08-26)

## Scope (do ONLY this)
HARNESS-CORRECTNESS ONLY. Rewrite e2e/command-center-summaries-fence.spec.ts against the real D4 owner-gated contract plus the closed-C6 solicit-reply arrival fixture. Do not invent unauth GET /api/summary-endpoints 200, GET /api/agent-summaries, or GET /api/summary-endpoints/default. Use FENCE_ORIGIN and OWNER_TOKEN. Collect ALL of E1,E2,E3,F1,F2,F3. FENCE_STUB=D3 named-red on E1 kind=assert. Write fence-report-v1.json in finally. Do not add product routes. North 2026-08-28 PLAN_SOUND: carry validation/D0-fix-a3.md (real C6 create-path + E1 timeout).

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **HARNESS-SMOKE** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`FENCE_ID=D7 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=D0 attempt=1 role=validator
  marker=DRV-D0-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate D0 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator D0 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/D0-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=D0 attempt=1 marker=DRV-D0-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
