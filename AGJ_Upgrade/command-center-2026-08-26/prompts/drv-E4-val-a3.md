# [driver] E4 — THE COMMIT UNDER TEST IS `6854ec2277d5f7fe77ef117d3ff9d9c0250d31d3`

Analyse EXACTLY that commit: `git show 6854ec2277d5f7fe77ef117d3ff9d9c0250d31d3`, `git diff 6854ec2277d5f7fe77ef117d3ff9d9c0250d31d3^..6854ec2277d5f7fe77ef117d3ff9d9c0250d31d3`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=6854ec2277d5f7fe77ef117d3ff9d9c0250d31d3`.

## The change under test (produced by the driver, not reported by the implementer)
```
[E4] Filter wakeups by activeTarget and auto-select first pane


 e2e/command-center-wakeup.spec.ts | 82 ++++++++++++++++++++++++++-------------
 src/web/public/app.js             |  9 ++++-
 2 files changed, 62 insertions(+), 29 deletions(-)
```
```diff
diff --git a/e2e/command-center-wakeup.spec.ts b/e2e/command-center-wakeup.spec.ts
index 2742f34..0049dbd 100644
--- a/e2e/command-center-wakeup.spec.ts
+++ b/e2e/command-center-wakeup.spec.ts
@@ -9,8 +9,10 @@ test('command-center wakeup UI and API', async ({ page }) => {
     localStorage.setItem('agj_user', JSON.stringify({ id: 1000000001, name: 'jrom', role: 'owner' }));
   }, OWNER_TOKEN);
 
-  const paneTarget = 'test-pane-42';
-  const literalAction = 'Test wakeup action';
+  const pane1 = 'pane-1';
+  const pane2 = 'pane-2';
+  const action1 = 'Active pane wakeup';
+  const action2 = 'Other pane wakeup';
   const futureMs = Date.now() + 70 * 60 * 1000;
   const futureIso = new Date(futureMs).toISOString();
 
@@ -21,7 +23,10 @@ test('command-center wakeup UI and API', async ({ page }) => {
     await route.fulfill({
       status: 200,
       contentType: 'application/json',
-      body: JSON.stringify({ sessions: [{ session_name: 's1', panes: [{ target: paneTarget, command: 'bash', activity: '', busy: false }] }] })
+      body: JSON.stringify({ sessions: [{ session_name: 's1', panes: [
+        { target: pane1, command: 'bash', activity: '', busy: false },
+        { target: pane2, command: 'bash', activity: '', busy: false }
+      ]}] })
     });
   });
 
@@ -29,7 +34,10 @@ test('command-center wakeup UI and API', async ({ page }) => {
     await route.fulfill({
       status: 200,
       contentType: 'application/json',
-      body: JSON.stringify({ wakeups: [{ id: 'w1', pane_target: paneTarget, action: literalAction, manual_fire_time: futureIso }] })
+      body: JSON.stringify({ wakeups: [
+        { id: 'w1', pane_target: pane1, action: action1, manual_fire_time: futureIso },
+        { id: 'w2', pane_target: pane2, action: action2, manual_fire_time: futureIso }
+      ]})
     });
   });
 
@@ -39,7 +47,7 @@ test('command-center wakeup UI and API', async ({ page }) => {
       await route.fulfill({
         status: 200,
         contentType: 'application/json',
-        body: JSON.stringify({ wakeup: { id: 'w2', pane_target: postPayload.pane_target, action: postPayload.action, manual_fire_time: postPayload.manual_fire_time } })
+        body: JSON.stringify({ wakeup: { id: 'w3', pane_target: postPayload.pane_target, action: postPayload.action, manual_fire_time: postPayload.manual_fire_time } })
       });
     } else {
       await route.continue();
@@ -57,41 +65,61 @@ test('command-center wakeup UI and API', async ({ page }) => {
 
   await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: 'domcontentloaded' });
   await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'networkidle' });
+  await page.waitForTimeout(10000);
 
-  // Trigger menu open via JS to ensure wakeup sheet renders
-  await page.evaluate(() => {
-    const btn = document.querySelector('[data-testid="terminal-menu"]');
-    if (btn) btn.click();
-  });
-  await page.waitForTimeout(2000);
+  // Open terminal menu
+  const menuBtn = page.locator('[data-testid="terminal-menu"]');
+  await menuBtn.waitFor({ state: 'attached', timeout: 30000 });
+  await menuBtn.click();
+
+  // Wait for sheet
+  await page.locator('[data-testid="wakeup-sheet"]').waitFor({ state: 'visible', timeout: 10000 });
+
+  // Assert sheet and inputs visible
+  await expect(page.locator('[data-testid="wakeup-sheet"]')).toBeVisible();
+  await expect(page.locator('[data-testid="wakeup-date-input"]')).toBeVisible();
+  await expect(page.locator('[data-testid="wakeup-time-input"]')).toBeVisible();
+  await expect(page.locator('[data-testid="wakeup-action-input"]')).toBeVisible();
+
+  // Collapsed summary should reflect only active pane
+  const collapsed = page.locator('[data-testid="wakeup-collapsed-summary"]');
+  await expect(collapsed).toBeVisible();
+  await expect(collapsed).toContainText('1 wakeup');
+  await expect(collapsed).toContainText('in');
+
+  // Expand
+  await page.locator('[data-testid="wakeup-expand-toggle"]').click();
 
-  // Verify app loaded
-  await expect(page).toHaveTitle(/AGJAssist/);
+  // Only active pane row should appear
+  const rows = page.locator('[data-testid="wakeup-pending-row"]');
+  await expect(rows).toHaveCount(1);
+  await expect(rows.first()).toContainText(pane1);
+  await expect(rows.first()).toContainText(action1);
+  await expect(rows.first()).not.toContainText(action2);
 
-  // Simulate UI interactions via direct API calls to verify behavior
-  // POST a new wakeup with non-default values
+  // Fill non-default schedule
   const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
   const dateStr = tomorrow.toISOString().slice(0, 10);
   const timeStr = '12:00';
   const nonDefaultAction = 'Deliberate non-default action';
   const expectedIso = new Date(`${dateStr}T${timeStr}`).toISOString();
 
-  await page.evaluate(async ({paneTarget, expectedIso, nonDefaultAction}) => {
-    await fetch('/api/agent-wakeups', {
-      method: 'POST',
-      headers: {'Content-Type':'application/json'},
-      body: JSON.stringify({ pane_target: paneTarget, manual_fire_time: expectedIso, action: nonDefaultAction })
-    });
-  }, {paneTarget, expectedIso, nonDefaultAction});
+  await page.locator('[data-testid="wakeup-date-input"]').fill(dateStr);
+  await page.locator('[data-testid="wakeup-time-input"]').fill(timeStr);
+  await page.locator('[data-testid="wakeup-action-input"]').fill(nonDefaultAction);
+
+  await page.locator('[data-testid="wakeup-save"]').click();
 
+  // Assert POST payload
   expect(postPayload).not.toBeNull();
-  expect(postPayload.pane_target).toBe(paneTarget);
+  expect(postPayload.pane_target).toBe(pane1);
   expect(postPayload.action).toBe(nonDefaultAction);
   expect(postPayload.manual_fire_time).toBe(expectedIso);
 
-  // Simulate cancel
-  await page.evaluate(async () => {
-    await fetch('/api/agent-wakeups/w1', { method: 'DELETE' });
-  });
+  // Cancel active wakeup
+  await page.locator('[data-testid="wakeup-cancel"]').first().click();
   expect(deleteId).toBe('w1');
+
+  // Row removed
+  await expect(page.locator('[data-testid="wakeup-pending-row"]')).toHaveCount(0);
 });
diff --git a/src/web/public/app.js b/src/web/public/app.js
index 0c5e6dc..db4d996 100644
--- a/src/web/public/app.js
+++ b/src/web/public/app.js
@@ -2313,7 +2313,12 @@ function TerminalTab({ projectId, projectName } = {}) {
           const sig = (arr) => JSON.stringify(
             (arr || []).map(s => [s.session_name, (s.panes || []).map(p => [p.target, p.command, p.activity, p.busy].join(':')).join(',')])
           );
-          return sig(prev) === sig(next) ? prev : next;
+          if (sig(prev) === sig(next)) return prev;
+          // auto-select first pane if none active
+          if (!activeTarget && next.length > 0 && next[0].panes && next[0].panes.length > 0) {
+            setActiveTarget(next[0].panes[0].target);
+          }
+          return next;
         });
       })
       .catch(e => setSessionsError(e.message || 'Failed to load sessions'));
@@ -3142,7 +3147,7 @@ function TerminalTab({ projectId, projectName } = {}) {
               <div>
                 ${(() => {
                   const now = new Date();
-                  const pending = wakeups.filter(w => new Date(w.manual_fire_time) > now);
+                  const pending = wakeups.filter(w => w.pane_target === activeTarget && new Date(w.manual_fire_time) > now);
                   const count = pending.length;
                   const nearest = pending.reduce((min,w) => {
                     const diff = new Date(w.manual_fire_time) - now;
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
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/E4-fix-a3.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=E4 attempt=3 marker=DRV-E4-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
