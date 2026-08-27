# [driver] A0 — THE COMMIT UNDER TEST IS `55eb37619607dcd82234e7761ebe8ea39d651832`

Analyse EXACTLY that commit: `git show 55eb37619607dcd82234e7761ebe8ea39d651832`, `git diff 55eb37619607dcd82234e7761ebe8ea39d651832^..55eb37619607dcd82234e7761ebe8ea39d651832`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=55eb37619607dcd82234e7761ebe8ea39d651832`.

## The change under test (produced by the driver, not reported by the implementer)
```
[A0] Harness correctness: specs finally, gate validation, reclaimed_bytes, stub handlers


 e2e/command-center-reminders-fence.spec.ts  |  81 ++++++++++++----------
 e2e/command-center-summaries-fence.spec.ts  |  81 ++++++++++++----------
 e2e/command-center-wakeup-fence.spec.ts     |  47 +++++++------
 e2e/command-center-window-fence.spec.ts     | 103 +++++++++++++++-------------
 e2e/run-command-center-playwright-fence.mjs |  18 +++--
 scripts/cc-run-isolated.mjs                 |  38 ++++++++++
 6 files changed, 222 insertions(+), 146 deletions(-)
```
```diff
diff --git a/e2e/command-center-reminders-fence.spec.ts b/e2e/command-center-reminders-fence.spec.ts
index e8a28d7..8774c54 100644
--- a/e2e/command-center-reminders-fence.spec.ts
+++ b/e2e/command-center-reminders-fence.spec.ts
@@ -20,41 +20,48 @@ test('command-center reminders fence journey', async ({ page }) => {
     }
   };
 
-  await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: 'domcontentloaded' });
-
-  await check('C1', async () => {
-    const resp = await page.request.get(`${APP_ORIGIN}/api/agent-reminders/schema`);
-    expect(resp.status()).toBe(200);
-  });
-
-  await check('C2', async () => {
-    const resp = await page.request.post(`${APP_ORIGIN}/api/agent-reminders`, { data: { cadence: '30m' } });
-    expect(resp.status()).toBe(201);
-  });
-
-  await check('C3', async () => {
-    // Literal fixture: expect fireDue to process only included agents
-    const resp = await page.request.get(`${APP_ORIGIN}/api/agent-reminders/due`);
-    const json = await resp.json().catch(() => ({}));
-    expect(Array.isArray(json.due)).toBe(true);
-  });
-
-  await check('C4', async () => {
-    await page.goto(`${APP_ORIGIN}/index.html#/agents`, { waitUntil: 'domcontentloaded' });
-    const sheet = page.locator('[data-testid="agent-reminder-sheet"]');
-    await expect(sheet).toBeVisible();
-  });
-
-  await check('C5', async () => {
-    const resp = await page.request.get(`${APP_ORIGIN}/api/agent-reminders/active`);
-    expect(resp.status()).toBe(200);
-  });
-
-  await check('C6', async () => {
-    // Integration check: reminders fire into temp tmux pane
-    const resp = await page.request.get(`${APP_ORIGIN}/api/agent-reminders/fired`);
-    expect(resp.status()).toBe(200);
-  });
-
-  fs.writeFileSync(REPORT_PATH, JSON.stringify({ schema:'fence-report-v1', collected: [...ACCEPTANCE_IDS], passed, failed }, null, 2));
+  try {
+    await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: 'domcontentloaded' });
+
+    await check('C1', async () => {
+      const resp = await page.request.get(`${APP_ORIGIN}/api/agent-reminders/schema`);
+      expect(resp.status()).toBe(200);
+    });
+
+    await check('C2', async () => {
+      const resp = await page.request.post(`${APP_ORIGIN}/api/agent-reminders`, { data: { cadence: '30m' } });
+      expect(resp.status()).toBe(201);
+    });
+
+    await check('C3', async () => {
+      // Literal fixture: expect fireDue to process only included agents
+      const resp = await page.request.get(`${APP_ORIGIN}/api/agent-reminders/due`);
+      const json = await resp.json().catch(() => ({}));
+      expect(Array.isArray(json.due)).toBe(true);
+    });
+
+    await check('C4', async () => {
+      await page.goto(`${APP_ORIGIN}/index.html#/agents`, { waitUntil: 'domcontentloaded' });
+      const sheet = page.locator('[data-testid="agent-reminder-sheet"]');
+      await expect(sheet).toBeVisible();
+    });
+
+    await check('C5', async () => {
+      const resp = await page.request.get(`${APP_ORIGIN}/api/agent-reminders/active`);
+      expect(resp.status()).toBe(200);
+    });
+
+    await check('C6', async () => {
+      // Integration check: reminders fire into temp tmux pane
+      const resp = await page.request.get(`${APP_ORIGIN}/api/agent-reminders/fired`);
+      expect(resp.status()).toBe(200);
+    });
+  } catch (error) {
+    const isNamedAssertion = error instanceof Error && error.message.startsWith('FENCE_ASSERT:');
+    if (!isNamedAssertion) throw error;
+  } finally {
+    fs.writeFileSync(REPORT_PATH, JSON.stringify({ schema:'fence-report-v1', collected: [...ACCEPTANCE_IDS], passed, failed }, null, 2));
+  }
+
+  expect(failed, `FENCE failures: ${JSON.stringify(failed)}`).toEqual([]);
 });
diff --git a/e2e/command-center-summaries-fence.spec.ts b/e2e/command-center-summaries-fence.spec.ts
index 2982f5a..4472369 100644
--- a/e2e/command-center-summaries-fence.spec.ts
+++ b/e2e/command-center-summaries-fence.spec.ts
@@ -20,41 +20,48 @@ test('command-center summaries fence journey', async ({ page }) => {
     }
   };
 
-  await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: 'domcontentloaded' });
-
-  await check('E1', async () => {
-    const resp = await page.request.get(`${APP_ORIGIN}/api/summary-endpoints`);
-    expect(resp.status()).toBe(200);
-  });
-
-  await check('E2', async () => {
-    await page.goto(`${APP_ORIGIN}/index.html#/agents`, { waitUntil: 'domcontentloaded' });
-    const dropdown = page.locator('[data-testid="agent-summaries-dropdown"]');
-    await expect(dropdown).toBeVisible();
-  });
-
-  await check('E3', async () => {
-    const resp = await page.request.get(`${APP_ORIGIN}/api/agent-summaries`);
-    expect(resp.status()).toBe(200);
-  });
-
-  await check('F1', async () => {
-    const resp = await page.request.get(`${APP_ORIGIN}/api/summary-endpoints`);
-    const json = await resp.json().catch(() => ({}));
-    expect(json.endpoints?.some((e:any)=>e.label==='140')).toBe(true);
-  });
-
-  await check('F2', async () => {
-    // Literal fixture check for endpoint config
-    const resp = await page.request.get(`${APP_ORIGIN}/api/summary-endpoints/default`);
-    expect(resp.status()).toBe(200);
-  });
-
-  await check('F3', async () => {
-    await page.goto(`${APP_ORIGIN}/index.html#/settings/summary`, { waitUntil: 'domcontentloaded' });
-    const settings = page.locator('[data-testid="summary-endpoint-settings"]');
-    await expect(settings).toBeVisible();
-  });
-
-  fs.writeFileSync(REPORT_PATH, JSON.stringify({ schema:'fence-report-v1', collected: [...ACCEPTANCE_IDS], passed, failed }, null, 2));
+  try {
+    await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: 'domcontentloaded' });
+
+    await check('E1', async () => {
+      const resp = await page.request.get(`${APP_ORIGIN}/api/summary-endpoints`);
+      expect(resp.status()).toBe(200);
+    });
+
+    await check('E2', async () => {
+      await page.goto(`${APP_ORIGIN}/index.html#/agents`, { waitUntil: 'domcontentloaded' });
+      const dropdown = page.locator('[data-testid="agent-summaries-dropdown"]');
+      await expect(dropdown).toBeVisible();
+    });
+
+    await check('E3', async () => {
+      const resp = await page.request.get(`${APP_ORIGIN}/api/agent-summaries`);
+      expect(resp.status()).toBe(200);
+    });
+
+    await check('F1', async () => {
+      const resp = await page.request.get(`${APP_ORIGIN}/api/summary-endpoints`);
+      const json = await resp.json().catch(() => ({}));
+      expect(json.endpoints?.some((e:any)=>e.label==='140')).toBe(true);
+    });
+
+    await check('F2', async () => {
+      // Literal fixture check for endpoint config
+      const resp = await page.request.get(`${APP_ORIGIN}/api/summary-endpoints/default`);
+      expect(resp.status()).toBe(200);
+    });
+
+    await check('F3', async () => {
+      await page.goto(`${APP_ORIGIN}/index.html#/settings/summary`, { waitUntil: 'domcontentloaded' });
+      const settings = page.locator('[data-testid="summary-endpoint-settings"]');
+      await expect(settings).toBeVisible();
+    });
+  } catch (error) {
+    const isNamedAssertion = error instanceof Error && error.message.startsWith('FENCE_ASSERT:');
+    if (!isNamedAssertion) throw error;
+  } finally {
+    fs.writeFileSync(REPORT_PATH, JSON.stringify({ schema:'fence-report-v1', collected: [...ACCEPTANCE_IDS], passed, failed }, null, 2));
+  }
+
+  expect(failed, `FENCE failures: ${JSON.stringify(failed)}`).toEqual([]);
 });
diff --git a/e2e/command-center-wakeup-fence.spec.ts b/e2e/command-center-wakeup-fence.spec.ts
index 7dabd26..4f2090a 100644
--- a/e2e/command-center-wakeup-fence.spec.ts
+++ b/e2e/command-center-wakeup-fence.spec.ts
@@ -20,24 +20,31 @@ test('command-center wakeup fence journey', async ({ page }) => {
     }
   };
 
-  await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: 'domcontentloaded' });
-
-  await check('D1', async () => {
-    const resp = await page.request.get(`${APP_ORIGIN}/api/agent-wakeups`);
-    expect(resp.status()).toBe(200);
-  });
-
-  await check('D2', async () => {
-    await page.goto(`${APP_ORIGIN}/index.html#/agents`, { waitUntil: 'domcontentloaded' });
-    const sheet = page.locator('[data-testid="wakeup-sheet"]');
-    await expect(sheet).toBeVisible();
-  });
-
-  await check('D3', async () => {
-    // Literal fixture: pending chip clears after fire
-    const resp = await page.request.post(`${APP_ORIGIN}/api/agent-wakeups/fire`, { data: { id: 'test' } });
-    expect(resp.status()).toBe(200);
-  });
-
-  fs.writeFileSync(REPORT_PATH, JSON.stringify({ schema:'fence-report-v1', collected: [...ACCEPTANCE_IDS], passed, failed }, null, 2));
+  try {
+    await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: 'domcontentloaded' });
+
+    await check('D1', async () => {
+      const resp = await page.request.get(`${APP_ORIGIN}/api/agent-wakeups`);
+      expect(resp.status()).toBe(200);
+    });
+
+    await check('D2', async () => {
+      await page.goto(`${APP_ORIGIN}/index.html#/agents`, { waitUntil: 'domcontentloaded' });
+      const sheet = page.locator('[data-testid="wakeup-sheet"]');
+      await expect(sheet).toBeVisible();
+    });
+
+    await check('D3', async () => {
+      // Literal fixture: pending chip clears after fire
+      const resp = await page.request.post(`${APP_ORIGIN}/api/agent-wakeups/fire`, { data: { id: 'test' } });
+      expect(resp.status()).toBe(200);
+    });
+  } catch (error) {
+    const isNamedAssertion = error instanceof Error && error.message.startsWith('FENCE_ASSERT:');
+    if (!isNamedAssertion) throw error;
+  } finally {
+    fs.writeFileSync(REPORT_PATH, JSON.stringify({ schema:'fence-report-v1', collected: [...ACCEPTANCE_IDS], passed, failed }, null, 2));
+  }
+
+  expect(failed, `FENCE failures: ${JSON.stringify(failed)}`).toEqual([]);
 });
diff --git a/e2e/command-center-window-fence.spec.ts b/e2e/command-center-window-fence.spec.ts
index 75609a1..67b0f5b 100644
--- a/e2e/command-center-window-fence.spec.ts
+++ b/e2e/command-center-window-fence.spec.ts
@@ -20,63 +20,70 @@ test('command-center window fence journey', async ({ page }) => {
     }
   };
 
-  await page.goto(`${APP_ORIGIN}/index.html#/agents`, { waitUntil: 'domcontentloaded' });
+  try {
+    await page.goto(`${APP_ORIGIN}/index.html#/agents`, { waitUntil: 'domcontentloaded' });
 
-  await check('G1', async () => {
-    const draft = page.locator('[data-testid="terminal-draft"]');
-    await expect(draft).toBeVisible();
-  });
+    await check('G1', async () => {
+      const draft = page.locator('[data-testid="terminal-draft"]');
+      await expect(draft).toBeVisible();
+    });
 
-  await check('G2', async () => {
-    const switcher = page.locator('[data-testid="agent-group-switcher"]');
-    await expect(switcher).toBeVisible();
-  });
+    await check('G2', async () => {
+      const switcher = page.locator('[data-testid="agent-group-switcher"]');
+      await expect(switcher).toBeVisible();
+    });
 
-  await check('G3', async () => {
-    const refresh = page.locator('[data-testid="refresh-from-session"]');
-    await expect(refresh).toBeVisible();
-  });
+    await check('G3', async () => {
+      const refresh = page.locator('[data-testid="refresh-from-session"]');
+      await expect(refresh).toBeVisible();
+    });
 
-  await check('H1', async () => {
-    const header = page.locator('[data-testid="terminal-header-v2"]');
-    await expect(header).toBeVisible();
-  });
+    await check('H1', async () => {
+      const header = page.locator('[data-testid="terminal-header-v2"]');
+      await expect(header).toBeVisible();
+    });
 
-  await check('H2', async () => {
-    await page.setViewportSize({ width: 390, height: 844 });
-    const collapsed = await page.locator('[data-testid="command-center-header"]').evaluate(el => getComputedStyle(el).height);
-    expect(collapsed).toBeDefined();
-  });
+    await check('H2', async () => {
+      await page.setViewportSize({ width: 390, height: 844 });
+      const collapsed = await page.locator('[data-testid="command-center-header"]').evaluate(el => getComputedStyle(el).height);
+      expect(collapsed).toBeDefined();
+    });
 
-  await check('H3', async () => {
-    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
-    expect(theme).toBeTruthy();
-  });
+    await check('H3', async () => {
+      const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
+      expect(theme).toBeTruthy();
+    });
 
-  await check('I1', async () => {
-    const refreshBtn = page.locator('[data-testid="refresh-from-session"]');
-    await refreshBtn.click();
-    await expect(page.locator('[data-testid="terminal-turn-agent"]')).toBeVisible();
-  });
+    await check('I1', async () => {
+      const refreshBtn = page.locator('[data-testid="refresh-from-session"]');
+      await refreshBtn.click();
+      await expect(page.locator('[data-testid="terminal-turn-agent"]')).toBeVisible();
+    });
 
-  await check('I2', async () => {
-    const draftInput = page.locator('[data-testid="terminal-composer-input"]');
-    await draftInput.fill('test draft');
-    await page.reload();
-    await expect(draftInput).toHaveValue('test draft');
-  });
+    await check('I2', async () => {
+      const draftInput = page.locator('[data-testid="terminal-composer-input"]');
+      await draftInput.fill('test draft');
+      await page.reload();
+      await expect(draftInput).toHaveValue('test draft');
+    });
 
-  await check('J1', async () => {
-    await page.setViewportSize({ width: 1024, height: 800 });
-    const switcher = page.locator('[data-testid="agent-group-switcher"]');
-    await expect(switcher).toBeVisible();
-  });
+    await check('J1', async () => {
+      await page.setViewportSize({ width: 1024, height: 800 });
+      const switcher = page.locator('[data-testid="agent-group-switcher"]');
+      await expect(switcher).toBeVisible();
+    });
 
-  await check('J2', async () => {
-    await page.setViewportSize({ width: 390, height: 844 });
-    const dropdown = page.locator('[data-testid="agent-group-switcher-dropdown"]');
-    await expect(dropdown).toBeVisible();
-  });
+    await check('J2', async () => {
+      await page.setViewportSize({ width: 390, height: 844 });
+      const dropdown = page.locator('[data-testid="agent-group-switcher-dropdown"]');
+      await expect(dropdown).toBeVisible();
+    });
+  } catch (error) {
+    const isNamedAssertion = error instanceof Error && error.message.startsWith('FENCE_ASSERT:');
+    if (!isNamedAssertion) throw error;
+  } finally {
+    fs.writeFileSync(REPORT_PATH, JSON.stringify({ schema:'fence-report-v1', collected: [...ACCEPTANCE_IDS], passed, failed }, null, 2));
+  }
 
-  fs.writeFileSync(REPORT_PATH, JSON.stringify({ schema:'fence-report-v1', collected: [...ACCEPTANCE_IDS], passed, failed }, null, 2));
+  expect(failed, `FENCE failures: ${JSON.stringify(failed)}`).toEqual([]);
 });
diff --git a/e2e/run-command-center-playwright-fence.mjs b/e2e/run-command-center-playwright-fence.mjs
index 1a1b1b4..30fb5e3 100644
--- a/e2e/run-command-center-playwright-fence.mjs
+++ b/e2e/run-command-center-playwright-fence.mjs
@@ -88,12 +88,22 @@ if (harnessSmoke) {
 
 if (gate) {
   const testPath = fence.test_path;
-  const posCode = runPlaywright(testPath, { ...process.env, FENCE_ID: fenceId });
+  const posReportPath = path.resolve(process.cwd(), '.fence-gate-pos.json');
+  const negReportPath = path.resolve(process.cwd(), '.fence-gate-neg.json');
+  try { fs.unlinkSync(posReportPath); } catch {}
+  try { fs.unlinkSync(negReportPath); } catch {}
+  const posCode = runPlaywright(testPath, { ...process.env, FENCE_ID: fenceId, FENCE_REPORT_PATH: posReportPath });
   const negStub = fence.negative_control_cmd.match(/FENCE_STUB=(\S+)/)?.[1] || '';
-  const negCode = runPlaywright(testPath, { ...process.env, FENCE_ID: fenceId, FENCE_STUB: negStub });
+  const negCode = runPlaywright(testPath, { ...process.env, FENCE_ID: fenceId, FENCE_STUB: negStub, FENCE_REPORT_PATH: negReportPath });
+  const posReport = readReport(posReportPath);
+  const negReport = readReport(negReportPath);
   const passed = posCode === 0;
-  const failedNeg = negCode !== 0;
-  writeReport(fence.acceptance_ids, passed ? fence.acceptance_ids : [], failedNeg ? [{ id: fence.expected_negative_fail_ids[0], kind: fence.expected_negative_kind }] : []);
+  const expectedNegIds = fence.expected_negative_fail_ids || [];
+  const expectedKind = fence.expected_negative_kind || 'assert';
+  const negFails = (negReport?.failed || []).filter(f => expectedNegIds.includes(f.id) && f.kind === expectedKind);
+  const failedNeg = negCode !== 0 && negFails.length === expectedNegIds.length;
+  const negFailedIds = negFails.map(f => ({ id: f.id, kind: f.kind }));
+  writeReport(fence.acceptance_ids, passed ? fence.acceptance_ids : [], failedNeg ? negFailedIds : []);
   console.log(verdictLine());
   process.exit(passed && failedNeg ? 0 : 1);
 }
diff --git a/scripts/cc-run-isolated.mjs b/scripts/cc-run-isolated.mjs
index ab2faaa..402bdff 100644
--- a/scripts/cc-run-isolated.mjs
+++ b/scripts/cc-run-isolated.mjs
@@ -40,6 +40,42 @@ const FENCE_STUB_HANDLERS = {
     }
     return false;
   },
+  C3: (req, res) => {
+    const pathname = (req.url || '').split('?')[0];
+    if (pathname === '/api/agent-reminders/active') {
+      res.writeHead(500, { 'content-type': 'application/json' });
+      res.end(JSON.stringify({ stubbed: true, contributor: 'C3' }));
+      return true;
+    }
+    return false;
+  },
+  D3: (req, res) => {
+    const pathname = (req.url || '').split('?')[0];
+    if (pathname === '/api/summary-endpoints') {
+      res.writeHead(500, { 'content-type': 'application/json' });
+      res.end(JSON.stringify({ stubbed: true, contributor: 'D3' }));
+      return true;
+    }
+    return false;
+  },
+  E2: (req, res) => {
+    const pathname = (req.url || '').split('?')[0];
+    if (pathname === '/api/agent-wakeups/fire') {
+      res.writeHead(500, { 'content-type': 'application/json' });
+      res.end(JSON.stringify({ stubbed: true, contributor: 'E2' }));
+      return true;
+    }
+    return false;
+  },
+  F1: (req, res) => {
+    const pathname = (req.url || '').split('?')[0];
+    if (pathname === '/api/agent-group-switcher') {
+      res.writeHead(500, { 'content-type': 'application/json' });
+      res.end(JSON.stringify({ stubbed: true, contributor: 'F1' }));
+      return true;
+    }
+    return false;
+  },
 };
 
 function startStubProxy(stub) {
@@ -79,6 +115,7 @@ function startStubProxy(stub) {
 if (serve) {
   const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-'));
   const tmpDb = ensureTmpDb(tmpDir);
+  const startSize = fs.statSync(tmpDb).size;
   const stub = process.env.FENCE_STUB || '';
   const port = stub ? UPSTREAM_PORT : PUBLIC_PORT;
   const env = {
@@ -95,6 +132,7 @@ if (serve) {
   const proxy = stub ? startStubProxy(stub) : null;
   const cleanup = () => {
     try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
+    console.log(`reclaimed_bytes=${startSize}`);
     if (proxy) proxy.close();
     server.kill();
   };
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

# THE SLICE — A0 (run command-center-2026-08-26)

## Scope (do ONLY this)
HARNESS-CORRECTNESS ONLY. Validator gates this row on `--harness-smoke` exit 0, NEVER on product A5. `acs` is HARNESS-SMOKE (not A5 — A5 stays B8/G2). Recovered HEAD still uses an HTTP proxy for FENCE_STUB (`scripts/cc-run-isolated.mjs` startStubProxy); remaining work: replace that with in-process Fastify preload so FENCE_STUB=ID patches the unit before route/job registration (INTERCEPTION_GAP). Also: every spec writes fence-report-v1.json in finally; `--gate` requires named expected_negative_fail_ids kind=assert (no synthesized ids); print reclaimed_bytes. Recovered commits already on HEAD (3439337). No product OVM removal.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **HARNESS-SMOKE** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`FENCE_ID=B8 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --harness-smoke`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=A0 attempt=1 role=validator
  marker=DRV-A0-24 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate A0 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator A0 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/A0-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=A0 attempt=1 marker=DRV-A0-24 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
