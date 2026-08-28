# [driver] D5 — THE COMMIT UNDER TEST IS `f2858d323211c8ac7bfab62043a9b566935e047e`

Analyse EXACTLY that commit: `git show f2858d323211c8ac7bfab62043a9b566935e047e`, `git diff f2858d323211c8ac7bfab62043a9b566935e047e^..f2858d323211c8ac7bfab62043a9b566935e047e`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=f2858d323211c8ac7bfab62043a9b566935e047e`.

## The change under test (produced by the driver, not reported by the implementer)
```
[D5] port SummaryEndpointSettings UI sheet with add/edit/remove/default


 e2e/command-center-endpoints.spec.ts | 102 ++++++++++++++++++++++++++++++
 src/web/public/app.js                | 116 +++++++++++++++++++++++++++++++++++
 2 files changed, 218 insertions(+)
```
```diff
diff --git a/e2e/command-center-endpoints.spec.ts b/e2e/command-center-endpoints.spec.ts
new file mode 100644
index 0000000..3e25314
--- /dev/null
+++ b/e2e/command-center-endpoints.spec.ts
@@ -0,0 +1,102 @@
+import { test, expect } from '@playwright/test';
+
+test.beforeEach(async ({ page }) => {
+  await page.addInitScript(() => {
+    localStorage.setItem('agj_token', 'd5-e2e-token');
+    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'd5-e2e', role: 'owner' }));
+  });
+});
+
+test('D5 SummaryEndpointSettings renders seeded 140 endpoint', async ({ page }) => {
+  await page.route('**/api/auth/me', async route => {
+    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 1 } }) });
+  });
+  await page.route('**/api/summary-endpoints', async route => {
+    await route.fulfill({
+      status: 200,
+      contentType: 'application/json',
+      body: JSON.stringify({
+        endpoints: [
+          { id: 1, name: '140', base_url: 'http://192.168.254.140:1234/v1', model: 'llama3', is_default: true },
+          { id: 2, name: 'test-ep', base_url: 'https://api.test/v1', model: 'gpt-4', is_default: false }
+        ]
+      })
+    });
+  });
+  await page.route('**/api/tmux/sessions', async route => {
+    await route.fulfill({
+      status: 200,
+      contentType: 'application/json',
+      body: JSON.stringify({ sessions: [{ session_name: 'test', panes: [{ target: '1', command: 'bash', activity: 1, busy: false }] }] })
+    });
+  });
+
+  await page.goto('http://localhost:3210/index.html#/terminals');
+  const sessionRow = page.locator('[data-testid="terminal-session-row"]').first();
+  if (await sessionRow.count() > 0) {
+    await sessionRow.click();
+  }
+  await page.waitForSelector('[data-testid="terminal-menu"]', { state: 'attached' });
+  await page.locator('[data-testid="terminal-menu"]').click({ force: true });
+
+  await expect(page.locator('[data-testid="summary-endpoint-sheet"]')).toBeVisible();
+  const rows = page.locator('[data-testid="endpoint-row"]');
+  await expect(rows).toHaveCount(2);
+  await expect(rows.nth(0)).toContainText('140');
+  await expect(rows.nth(1)).toContainText('test-ep');
+  const radios = page.locator('[data-testid="endpoint-default-radio"]');
+  await expect(radios.nth(0)).toBeChecked();
+});
+
+test('D5 create endpoint posts literal payload and updates list', async ({ page }) => {
+  await page.route('**/api/auth/me', async route => {
+    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 1 } }) });
+  });
+  let postedBody = null;
+  await page.route('**/api/summary-endpoints', async route => {
+    if (route.request().method() === 'POST') {
+      postedBody = await route.request().postDataJSON();
+      await route.fulfill({
+        status: 201,
+        contentType: 'application/json',
+        body: JSON.stringify({ endpoint: { id: 3, name: postedBody.name, base_url: postedBody.base_url, model: postedBody.model } })
+      });
+    } else {
+      await route.fulfill({
+        status: 200,
+        contentType: 'application/json',
+        body: JSON.stringify({
+          endpoints: [
+            { id: 1, name: '140', base_url: 'http://192.168.254.140:1234/v1', model: 'llama3', is_default: true }
+          ]
+        })
+      });
+    }
+  });
+  await page.route('**/api/tmux/sessions', async route => {
+    await route.fulfill({
+      status: 200,
+      contentType: 'application/json',
+      body: JSON.stringify({ sessions: [{ session_name: 'test', panes: [{ target: '1', command: 'bash', activity: 1, busy: false }] }] })
+    });
+  });
+
+  await page.goto('http://localhost:3210/index.html#/terminals');
+  const sessionRow = page.locator('[data-testid="terminal-session-row"]').first();
+  if (await sessionRow.count() > 0) {
+    await sessionRow.click();
+  }
+  await page.waitForSelector('[data-testid="terminal-menu"]', { state: 'attached' });
+  await page.locator('[data-testid="terminal-menu"]').click({ force: true });
+
+  await expect(page.locator('[data-testid="summary-endpoint-sheet"]')).toBeVisible();
+  await page.locator('[data-testid="endpoint-name-input"]').fill('new-ep');
+  await page.locator('[data-testid="endpoint-baseurl-input"]').fill('https://api.new/v1');
+  await page.locator('[data-testid="endpoint-model-input"]').fill('model-x');
+  await page.locator('[data-testid="endpoint-save"]').click();
+
+  expect(postedBody).not.toBeNull();
+  expect(postedBody.name).toBe('new-ep');
+  expect(postedBody.base_url).toBe('https://api.new/v1');
+  expect(postedBody.model).toBe('model-x');
+});
diff --git a/src/web/public/app.js b/src/web/public/app.js
index e02fc16..e012bea 100644
--- a/src/web/public/app.js
+++ b/src/web/public/app.js
@@ -2272,6 +2272,12 @@ function TerminalTab({ projectId, projectName } = {}) {
   const [repeatLimit, setRepeatLimit] = useState('');
   const [recipientAgentName, setRecipientAgentName] = useState('agent-a');
   const [recipientInclude, setRecipientInclude] = useState(true);
+  const [summaryEndpoints, setSummaryEndpoints] = useState([]);
+  const [endpointName, setEndpointName] = useState('');
+  const [endpointBaseUrl, setEndpointBaseUrl] = useState('');
+  const [endpointModel, setEndpointModel] = useState('');
+  const [editingEndpointId, setEditingEndpointId] = useState(null);
+  const [defaultEndpointId, setDefaultEndpointId] = useState(null);
   const menuRef = useRef(null);
   const sectionNavRef = useRef(null);
   const terminalGroupsRef = useRef(terminalGroups);
@@ -2380,6 +2386,21 @@ function TerminalTab({ projectId, projectName } = {}) {
       .catch(() => setAgentReminders([]));
   }, [menuOpen]);
 
+  useEffect(() => {
+    if (!menuOpen) return;
+    api('/api/summary-endpoints')
+      .then(data => {
+        const eps = Array.isArray(data?.endpoints) ? data.endpoints : [];
+        setSummaryEndpoints(eps);
+        const def = eps.find(e => e.is_default);
+        setDefaultEndpointId(def ? def.id : null);
+      })
+      .catch(() => {
+        setSummaryEndpoints([]);
+        setDefaultEndpointId(null);
+      });
+  }, [menuOpen]);
+
   const handleSaveReminder = async () => {
     const folderGroup = resolvedActiveGroupTab === 'all' ? 'all' : (activeGroup?.id || resolvedActiveGroupTab);
     const minutes = cadenceCustom ? Number(cadenceCustom) : cadenceMinutes;
@@ -2399,6 +2420,66 @@ function TerminalTab({ projectId, projectName } = {}) {
     }
   };
 
+  const handleSaveEndpoint = async () => {
+    if (!endpointName || !endpointBaseUrl || !endpointModel) return;
+    try {
+      if (editingEndpointId) {
+        await api(`/api/summary-endpoints/${editingEndpointId}`, {
+          method: 'PATCH',
+          body: JSON.stringify({ name: endpointName, base_url: endpointBaseUrl, model: endpointModel })
+        });
+      } else {
+        await api('/api/summary-endpoints', {
+          method: 'POST',
+          body: JSON.stringify({ name: endpointName, base_url: endpointBaseUrl, model: endpointModel })
+        });
+      }
+      setEndpointName('');
+      setEndpointBaseUrl('');
+      setEndpointModel('');
+      setEditingEndpointId(null);
+      const data = await api('/api/summary-endpoints');
+      const eps = Array.isArray(data?.endpoints) ? data.endpoints : [];
+      setSummaryEndpoints(eps);
+      const def = eps.find(e => e.is_default);
+      setDefaultEndpointId(def ? def.id : null);
+    } catch (e) {
+      console.error(e);
+    }
+  };
+
+  const handleDeleteEndpoint = async (id) => {
+    try {
+      await api(`/api/summary-endpoints/${id}`, { method: 'DELETE' });
+      const data = await api('/api/summary-endpoints');
+      const eps = Array.isArray(data?.endpoints) ? data.endpoints : [];
+      setSummaryEndpoints(eps);
+      const def = eps.find(e => e.is_default);
+      setDefaultEndpointId(def ? def.id : null);
+    } catch (e) {
+      console.error(e);
+    }
+  };
+
+  const handleSetDefault = async (id) => {
+    try {
+      await api(`/api/summary-endpoints/${id}/default`, { method: 'POST' });
+      const data = await api('/api/summary-endpoints');
+      const eps = Array.isArray(data?.endpoints) ? data.endpoints : [];
+      setSummaryEndpoints(eps);
+      setDefaultEndpointId(id);
+    } catch (e) {
+      console.error(e);
+    }
+  };
+
+  const startEditEndpoint = (ep) => {
+    setEditingEndpointId(ep.id);
+    setEndpointName(ep.name || '');
+    setEndpointBaseUrl(ep.base_url || '');
+    setEndpointModel(ep.model || '');
+  };
+
   function cacheTerminalGroupsLocal(groups, active) {
     writeTerminalGroups(groups);
     writeActiveTerminalGroup(active);
@@ -2970,6 +3051,41 @@ function TerminalTab({ projectId, projectName } = {}) {
               <button type="button" data-testid="agent-reminder-save" onclick=${handleSaveReminder}>Save</button>
             </div>
           </div>
+          <div data-testid="summary-endpoint-sheet">
+            <div class="terminal-sheet-sect">Summary Endpoints</div>
+            <div class="terminal-sheet-row">
+              <div class="terminal-sheet-lbl">Existing endpoints</div>
+              <div>
+                ${summaryEndpoints.length === 0 ? html`<div>No endpoints</div>` : html`
+                  ${summaryEndpoints.map(ep => html`
+                    <div data-testid="endpoint-row" style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
+                      <input type="radio" name="default-endpoint" data-testid="endpoint-default-radio" checked=${defaultEndpointId === ep.id} onchange=${() => handleSetDefault(ep.id)} />
+                      <span>${ep.name || ''} ${ep.model || ''}</span>
+                      <button type="button" data-testid="endpoint-edit" onclick=${() => startEditEndpoint(ep)}>Edit</button>
+                      <button type="button" data-testid="endpoint-delete" onclick=${() => handleDeleteEndpoint(ep.id)}>Del</button>
+                    </div>
+                  `)}
+                `}
+              </div>
+            </div>
+            <div class="terminal-sheet-sect">${editingEndpointId ? 'Edit endpoint' : 'New endpoint'}</div>
+            <div class="terminal-sheet-row">
+              <div class="terminal-sheet-lbl">Name</div>
+              <input data-testid="endpoint-name-input" type="text" placeholder="Name" value=${endpointName} oninput=${e => setEndpointName(e.target.value)} />
+            </div>
+            <div class="terminal-sheet-row">
+              <div class="terminal-sheet-lbl">Base URL</div>
+              <input data-testid="endpoint-baseurl-input" type="text" placeholder="https://.../v1" value=${endpointBaseUrl} oninput=${e => setEndpointBaseUrl(e.target.value)} />
+            </div>
+            <div class="terminal-sheet-row">
+              <div class="terminal-sheet-lbl">Model</div>
+              <input data-testid="endpoint-model-input" type="text" placeholder="Model" value=${endpointModel} oninput=${e => setEndpointModel(e.target.value)} />
+            </div>
+            <div class="terminal-sheet-row">
+              <button type="button" data-testid="endpoint-save" onclick=${handleSaveEndpoint}>${editingEndpointId ? 'Update' : 'Add'}</button>
+              ${editingEndpointId ? html`<button type="button" onclick=${() => { setEditingEndpointId(null); setEndpointName(''); setEndpointBaseUrl(''); setEndpointModel(''); }}>Cancel</button>` : ''}
+            </div>
+          </div>
           <div class="terminal-sheet-topbar">
             <span class="terminal-sheet-title">Terminal settings</span>
             <button type="button" class="terminal-sheet-done" data-testid="terminal-menu-done"
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

# THE SLICE — D5 (run command-center-2026-08-26)

## Scope (do ONLY this)
Web UI layer: port `SummaryEndpointSettings` (add/edit/remove, radio default, seeded `140`, owner-only errors). After C5 to avoid a dual `app.js` merge.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **F1** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **F2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **F3** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`npx playwright test e2e/command-center-endpoints.spec.ts --project=cc`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=D5 attempt=1 role=validator
  marker=DRV-D5-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate D5 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator D5 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/D5-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=D5 attempt=1 marker=DRV-D5-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
