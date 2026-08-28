# [driver] D6 — THE COMMIT UNDER TEST IS `7576c422c1b16725855df859cd93b06268896a2e`

Analyse EXACTLY that commit: `git show 7576c422c1b16725855df859cd93b06268896a2e`, `git diff 7576c422c1b16725855df859cd93b06268896a2e^..7576c422c1b16725855df859cd93b06268896a2e`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=7576c422c1b16725855df859cd93b06268896a2e`.

## The change under test (produced by the driver, not reported by the implementer)
```
[D6] port AgentSummariesDropdown with per-agent cards, endpoint tags, scroll and empty state


 e2e/command-center-summaries.spec.ts | 90 ++++++++++++++++++++++++++++++++++++
 src/web/public/app.js                | 51 ++++++++++++++++++++
 2 files changed, 141 insertions(+)
```
```diff
diff --git a/e2e/command-center-summaries.spec.ts b/e2e/command-center-summaries.spec.ts
new file mode 100644
index 0000000..94b4ec2
--- /dev/null
+++ b/e2e/command-center-summaries.spec.ts
@@ -0,0 +1,90 @@
+import { test, expect } from '@playwright/test';
+
+test.beforeEach(async ({ page }) => {
+  await page.addInitScript(() => {
+    localStorage.setItem('agj_token', 'd6-e2e-token');
+    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'd6-e2e', role: 'owner' }));
+  });
+});
+
+test('D6 AgentSummariesDropdown renders newest-first cards with endpoint tags', async ({ page }) => {
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
+  await page.route('**/api/summary-agents/*/summaries', async route => {
+    await route.fulfill({
+      status: 200,
+      contentType: 'application/json',
+      body: JSON.stringify({
+        summaries: [
+          { id: 2, agent_name: 'agent-a', endpoint_id: 2, summary_text: 'Second summary', created_at: '2026-08-27T10:00:00Z' },
+          { id: 1, agent_name: 'agent-a', endpoint_id: 1, summary_text: 'First summary', created_at: '2026-08-27T09:00:00Z' }
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
+  await page.waitForSelector('[data-testid="terminal-session-name"]', { state: 'attached' });
+
+  await page.locator('[data-testid="summaries-toggle"]').click();
+  await expect(page.locator('[data-testid="agent-summaries-dropdown"]')).toBeVisible();
+
+  const cards = page.locator('[data-testid="summary-card"]');
+  await expect(cards).toHaveCount(2);
+  await expect(cards.nth(0)).toContainText('Second summary');
+  await expect(cards.nth(0)).toContainText('via test-ep');
+  await expect(cards.nth(1)).toContainText('First summary');
+  await expect(cards.nth(1)).toContainText('via 140');
+});
+
+test('D6 AgentSummariesDropdown shows empty state when no summaries', async ({ page }) => {
+  await page.route('**/api/auth/me', async route => {
+    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 1 } }) });
+  });
+  await page.route('**/api/summary-endpoints', async route => {
+    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ endpoints: [] }) });
+  });
+  await page.route('**/api/summary-agents/*/summaries', async route => {
+    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ summaries: [] }) });
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
+  if (await sessionRow.count() > 0) await sessionRow.click();
+  await page.waitForSelector('[data-testid="terminal-session-name"]', { state: 'attached' });
+
+  await page.locator('[data-testid="summaries-toggle"]').click();
+  await expect(page.locator('[data-testid="agent-summaries-dropdown"]')).toBeVisible();
+  await expect(page.locator('[data-testid="summaries-empty"]')).toContainText('No summaries yet');
+});
diff --git a/src/web/public/app.js b/src/web/public/app.js
index 2322605..3bc72e0 100644
--- a/src/web/public/app.js
+++ b/src/web/public/app.js
@@ -2279,6 +2279,9 @@ function TerminalTab({ projectId, projectName } = {}) {
   const [editingEndpointId, setEditingEndpointId] = useState(null);
   const [defaultEndpointId, setDefaultEndpointId] = useState(null);
   const [endpointError, setEndpointError] = useState('');
+  const [summariesOpen, setSummariesOpen] = useState(false);
+  const [summaries, setSummaries] = useState([]);
+  const [summariesLoading, setSummariesLoading] = useState(false);
   const menuRef = useRef(null);
   const sectionNavRef = useRef(null);
   const terminalGroupsRef = useRef(terminalGroups);
@@ -2402,6 +2405,27 @@ function TerminalTab({ projectId, projectName } = {}) {
       });
   }, [menuOpen]);
 
+  useEffect(() => {
+    if (!summariesOpen) return;
+    if (!activeTarget) {
+      setSummaries([]);
+      return;
+    }
+    setSummariesLoading(true);
+    Promise.all([
+      api(`/api/summary-agents/${encodeURIComponent(activeTarget)}/summaries`),
+      api('/api/summary-endpoints').catch(() => ({ endpoints: [] }))
+    ]).then(([summData, epData]) => {
+      const rows = Array.isArray(summData?.summaries) ? summData.summaries : [];
+      setSummaries(rows);
+      const eps = Array.isArray(epData?.endpoints) ? epData.endpoints : [];
+      setSummaryEndpoints(eps);
+      const def = eps.find(e => e.is_default);
+      setDefaultEndpointId(def ? def.id : null);
+    }).catch(() => setSummaries([]))
+      .finally(() => setSummariesLoading(false));
+  }, [summariesOpen, activeTarget]);
+
   const handleSaveReminder = async () => {
     const folderGroup = resolvedActiveGroupTab === 'all' ? 'all' : (activeGroup?.id || resolvedActiveGroupTab);
     const minutes = cadenceCustom ? Number(cadenceCustom) : cadenceMinutes;
@@ -2987,6 +3011,9 @@ function TerminalTab({ projectId, projectName } = {}) {
               <button type="button" class="terminal-mynav-hbtn" data-testid="terminal-mynav-down"
                       aria-label="Jump to my next message" onclick=${() => jumpToMyMessage(1)}>▼</button>
             </div>
+            <button type="button" class="terminal-topbar-icon-btn" data-testid="summaries-toggle" aria-label="Agent summaries" onclick=${() => setSummariesOpen(s => !s)}>
+              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v13H8l-4 4V4z"/><path d="M8 9h8M8 13h5"/></svg>
+            </button>
             <button type="button" class="terminal-topbar-icon-btn terminal-settings-trigger"
                     data-term-menu data-testid="terminal-menu" aria-label="Terminal settings" aria-expanded=${menuOpen}
                     onclick=${() => { setSectionNavOpen(false); setMenuOpen((current) => !current); }}>
@@ -2998,6 +3025,30 @@ function TerminalTab({ projectId, projectName } = {}) {
           `}
         </div>
       </div>
+      ${summariesOpen && html`
+        <div key="summaries-dropdown" data-testid="agent-summaries-dropdown" style="position:absolute;top:60px;right:12px;z-index:250;width:320px;max-height:400px;overflow:auto;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px;box-shadow:0 8px 24px rgba(0,0,0,0.3)">
+          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
+            <strong>Summaries</strong>
+            <button type="button" onclick=${() => setSummariesOpen(false)}>✕</button>
+          </div>
+          ${summariesLoading ? html`<div>Loading…</div>` : summaries.length === 0 ? html`<div data-testid="summaries-empty">No summaries yet</div>` : html`
+            ${summaries.map(s => {
+              const ep = summaryEndpoints.find(e => e.id === s.endpoint_id);
+              const epName = ep ? ep.name : `id ${s.endpoint_id}`;
+              const time = s.created_at ? new Date(s.created_at).toLocaleString() : '';
+              return html`
+                <div data-testid="summary-card" style="border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:8px">
+                  <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-secondary)">
+                    <span>${time}</span>
+                    <span style="background:var(--accent-soft);color:var(--accent);padding:1px 6px;border-radius:4px">via ${epName}</span>
+                  </div>
+                  <div style="margin-top:4px;font-size:13px">${s.summary_text || ''}</div>
+                </div>
+              `;
+            })}
+          `}
+        </div>
+      `}
       <div key="sectionnav-overlay" class="terminal-sectionnav-overlay"
            hidden=${!sectionNavOpen} onclick=${() => setSectionNavOpen(false)}></div>
       ${(isTgMiniAppContext && sectionNavOpen) ? html`
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

# THE SLICE — D6 (run command-center-2026-08-26)

## Scope (do ONLY this)
Web UI layer: port `AgentSummariesDropdown` (per-agent newest-first cards, endpoint tags, scroll, empty state). After D5 as the other new agent-window sheet.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **E2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **E3** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`npx playwright test e2e/command-center-summaries.spec.ts --project=cc`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=D6 attempt=1 role=validator
  marker=DRV-D6-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate D6 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator D6 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/D6-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=D6 attempt=1 marker=DRV-D6-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
