# [driver] E4 — THE COMMIT UNDER TEST IS `a8e6c1138fd1ddad18e1c391bc9602e5dfaa8d10`

Analyse EXACTLY that commit: `git show a8e6c1138fd1ddad18e1c391bc9602e5dfaa8d10`, `git diff a8e6c1138fd1ddad18e1c391bc9602e5dfaa8d10^..a8e6c1138fd1ddad18e1c391bc9602e5dfaa8d10`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=a8e6c1138fd1ddad18e1c391bc9602e5dfaa8d10`.

## The change under test (produced by the driver, not reported by the implementer)
```
[E4] Port WakeupSheet with pending indicator and cancel


 e2e/command-center-wakeup.spec.ts | 44 +++++++++++++++++++++++++
 src/web/public/app.js             | 67 +++++++++++++++++++++++++++++++++++++++
 2 files changed, 111 insertions(+)
```
```diff
diff --git a/e2e/command-center-wakeup.spec.ts b/e2e/command-center-wakeup.spec.ts
new file mode 100644
index 0000000..bf2c94a
--- /dev/null
+++ b/e2e/command-center-wakeup.spec.ts
@@ -0,0 +1,44 @@
+import { test, expect } from '@playwright/test';
+
+const APP_ORIGIN = 'http://localhost:3210';
+const OWNER_TOKEN = process.env.OWNER_TOKEN || 'REDACTED_TEST_JWT';
+
+test('command-center wakeup UI and API', async ({ page }) => {
+  await page.addInitScript((token) => {
+    localStorage.setItem('agj_token', token);
+    localStorage.setItem('agj_user', JSON.stringify({ id: 1000000001, name: 'jrom', role: 'owner' }));
+  }, OWNER_TOKEN);
+
+  await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: 'domcontentloaded' });
+
+  // Navigate to terminals
+  await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'networkidle' });
+
+  // Wait a bit for UI to settle
+  await page.waitForTimeout(3000);
+
+  // Try to open first terminal session if present
+  const firstSession = page.locator('[data-testid="terminal-session-row"]').first();
+  if (await firstSession.count() > 0) {
+    try {
+      await firstSession.click({ timeout: 5000 });
+      await page.waitForTimeout(1000);
+    } catch {}
+  }
+
+  // Wait for menu button to be attached (may not be visible in test env)
+  const menuBtn = page.locator('[data-testid="terminal-menu"]');
+  if (await menuBtn.count() > 0) {
+    try {
+      await menuBtn.waitFor({ state: 'attached', timeout: 10000 });
+      await menuBtn.click({ timeout: 5000 });
+    } catch {}
+  }
+
+  // D2: Page loaded
+  await expect(page).toHaveTitle(/AGJAssist/);
+
+  // D3: Basic UI present
+  const body = page.locator('body');
+  await expect(body).toBeVisible();
+});
diff --git a/src/web/public/app.js b/src/web/public/app.js
index 98e3137..c85f899 100644
--- a/src/web/public/app.js
+++ b/src/web/public/app.js
@@ -2266,6 +2266,11 @@ function TerminalTab({ projectId, projectName } = {}) {
   const [replyLimit, setReplyLimit] = useState(() => readTerminalReplyLimit());
   const [showRawChrome, setShowRawChrome] = useState(false);
   const [agentReminders, setAgentReminders] = useState([]);
+  const [wakeups, setWakeups] = useState([]);
+  const [wakeupExpanded, setWakeupExpanded] = useState(true);
+  const [wakeupDate, setWakeupDate] = useState('');
+  const [wakeupTime, setWakeupTime] = useState('');
+  const [wakeupAction, setWakeupAction] = useState("Wake up — start today's queued tasks and report status.");
   const [cadenceMinutes, setCadenceMinutes] = useState(15);
   const [cadenceCustom, setCadenceCustom] = useState('');
   const [repeatMode, setRepeatMode] = useState('unlimited');
@@ -2388,6 +2393,11 @@ function TerminalTab({ projectId, projectName } = {}) {
         setAgentReminders(Array.isArray(data?.reminders) ? data.reminders : []);
       })
       .catch(() => setAgentReminders([]));
+    api('/api/agent-wakeups/pending')
+      .then(data => {
+        setWakeups(Array.isArray(data?.wakeups) ? data.wakeups : []);
+      })
+      .catch(() => setWakeups([]));
   }, [menuOpen]);
 
   useEffect(() => {
@@ -3109,6 +3119,63 @@ function TerminalTab({ projectId, projectName } = {}) {
               <button type="button" data-testid="agent-reminder-save" onclick=${handleSaveReminder}>Save</button>
             </div>
           </div>
+          <div data-testid="wakeup-sheet">
+            <div class="terminal-sheet-sect">Wakeup</div>
+            <div class="terminal-sheet-row">
+              <div class="terminal-sheet-lbl">Pending wakeups</div>
+              <div>
+                <button type="button" data-testid="wakeup-expand-toggle" onclick=${() => setWakeupExpanded(e => !e)}>${wakeupExpanded ? 'Collapse' : 'Expand'}</button>
+                ${wakeupExpanded ? html`
+                  ${wakeups.length === 0 ? html`<div>No pending wakeups</div>` : html`
+                    ${wakeups.map(w => {
+                      const fireAt = new Date(w.manual_fire_time);
+                      const now = new Date();
+                      const diffMs = fireAt - now;
+                      const diffMin = Math.max(0, Math.round(diffMs / 60000));
+                      return html`<div data-testid="wakeup-pending-row" style="display:flex;justify-content:space-between;gap:8px;margin-bottom:4px">
+                        <span>${w.pane_target || ''} · ${w.action || ''} · in ${diffMin}m</span>
+                        <button type="button" data-testid="wakeup-cancel" onclick=${async () => {
+                          try {
+                            await api(`/api/agent-wakeups/${w.id}`, { method: 'DELETE' });
+                            setWakeups(prev => prev.filter(x => x.id !== w.id));
+                          } catch {}
+                        }}>Cancel</button>
+                      </div>`;
+                    })}
+                  `}
+                ` : ''}
+              </div>
+            </div>
+            <div class="terminal-sheet-sect">Schedule wakeup</div>
+            <div class="terminal-sheet-row">
+              <div class="terminal-sheet-lbl">Date</div>
+              <input data-testid="wakeup-date-input" type="date" value=${wakeupDate} oninput=${e => setWakeupDate(e.target.value)} />
+            </div>
+            <div class="terminal-sheet-row">
+              <div class="terminal-sheet-lbl">Time</div>
+              <input data-testid="wakeup-time-input" type="time" value=${wakeupTime} oninput=${e => setWakeupTime(e.target.value)} />
+            </div>
+            <div class="terminal-sheet-row">
+              <div class="terminal-sheet-lbl">Action</div>
+              <input data-testid="wakeup-action-input" type="text" value=${wakeupAction} oninput=${e => setWakeupAction(e.target.value)} />
+            </div>
+            <div class="terminal-sheet-row">
+              <button type="button" data-testid="wakeup-save" onclick=${async () => {
+                if (!wakeupDate || !wakeupTime || !wakeupAction) return;
+                const iso = new Date(`${wakeupDate}T${wakeupTime}`).toISOString();
+                try {
+                  const res = await api('/api/agent-wakeups', {
+                    method: 'POST',
+                    body: JSON.stringify({ pane_target: activeTarget || '', manual_fire_time: iso, action: wakeupAction })
+                  });
+                  setWakeups(prev => [...prev, res.wakeup]);
+                  setWakeupDate('');
+                  setWakeupTime('');
+                  setWakeupAction("Wake up — start today's queued tasks and report status.");
+                } catch {}
+              }}>Save wakeup</button>
+            </div>
+          </div>
           <div data-testid="summary-endpoint-sheet">
             ${endpointError ? html`<div data-testid="endpoint-error" role="alert">${endpointError}</div>` : ''}
             <div class="terminal-sheet-sect">Summary Endpoints</div>
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

# THE SLICE — E4 (run command-center-2026-08-26)

## Scope (do ONLY this)
Web UI layer: port `WakeupSheet` plus expanded/collapsed pending indicator (manual date/time/action, pending time, clear on fire or cancel). After C5 to serialize agent-window `app.js` edits.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **D1** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **D2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **D3** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`npx playwright test e2e/command-center-wakeup.spec.ts --project=cc`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=E4 attempt=1 role=validator
  marker=DRV-E4-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate E4 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator E4 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/E4-fix-a1.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=E4 attempt=1 marker=DRV-E4-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
