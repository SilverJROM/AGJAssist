# [driver] E4 — THE COMMIT UNDER TEST IS `b1d8258c5d4d4121a63f3231df70e434143ee638`

Analyse EXACTLY that commit: `git show b1d8258c5d4d4121a63f3231df70e434143ee638`, `git diff b1d8258c5d4d4121a63f3231df70e434143ee638^..b1d8258c5d4d4121a63f3231df70e434143ee638`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=b1d8258c5d4d4121a63f3231df70e434143ee638`.

## The change under test (produced by the driver, not reported by the implementer)
```
[E4] Drive wakeup test through active terminal chat


 e2e/command-center-wakeup.spec.ts | 28 +++++++++++++++++++---------
 1 file changed, 19 insertions(+), 9 deletions(-)
```
```diff
diff --git a/e2e/command-center-wakeup.spec.ts b/e2e/command-center-wakeup.spec.ts
index 0049dbd..34ab094 100644
--- a/e2e/command-center-wakeup.spec.ts
+++ b/e2e/command-center-wakeup.spec.ts
@@ -54,7 +54,7 @@ test('command-center wakeup UI and API', async ({ page }) => {
     }
   });
 
-  await page.route('**/api/agent-wakeups/*', async route => {
+  await page.route('**/api/agent-wakeups/w1', async route => {
     if (route.request().method() === 'DELETE') {
       deleteId = route.request().url().split('/').pop();
       await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
@@ -63,11 +63,13 @@ test('command-center wakeup UI and API', async ({ page }) => {
     }
   });
 
-  await page.goto(`${APP_ORIGIN}/index.html`, { waitUntil: 'domcontentloaded' });
   await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'networkidle' });
   await page.waitForTimeout(10000);
 
-  // Open terminal menu
+  // Select the active chat through the public list navigation before opening its menu.
+  await page.locator('[data-testid="terminal-session-row"][data-session-target="pane-1"]').click();
+
+  // Open terminal menu from the active chat
   const menuBtn = page.locator('[data-testid="terminal-menu"]');
   await menuBtn.waitFor({ state: 'attached', timeout: 30000 });
   await menuBtn.click();
@@ -87,16 +89,22 @@ test('command-center wakeup UI and API', async ({ page }) => {
   await expect(collapsed).toContainText('1 wakeup');
   await expect(collapsed).toContainText('in');
 
-  // Expand
-  await page.locator('[data-testid="wakeup-expand-toggle"]').click();
-
-  // Only active pane row should appear
+  // The expanded sheet shows only the active pane's pending row.
   const rows = page.locator('[data-testid="wakeup-pending-row"]');
   await expect(rows).toHaveCount(1);
   await expect(rows.first()).toContainText(pane1);
   await expect(rows.first()).toContainText(action1);
   await expect(rows.first()).not.toContainText(action2);
 
+  // The indicator remains visible while the details can be collapsed and restored.
+  const expandToggle = page.locator('[data-testid="wakeup-expand-toggle"]');
+  await expect(expandToggle).toHaveText('Collapse');
+  await expandToggle.click();
+  await expect(rows).toHaveCount(0);
+  await expect(collapsed).toContainText('1 wakeup');
+  await expandToggle.click();
+  await expect(rows).toHaveCount(1);
+
   // Fill non-default schedule
   const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
   const dateStr = tomorrow.toISOString().slice(0, 10);
@@ -120,6 +128,8 @@ test('command-center wakeup UI and API', async ({ page }) => {
   await page.locator('[data-testid="wakeup-cancel"]').first().click();
   expect(deleteId).toBe('w1');
 
-  // Row removed
-  await expect(page.locator('[data-testid="wakeup-pending-row"]')).toHaveCount(0);
+  // The cancelled fixture row is removed while the newly saved wakeup remains.
+  await expect(rows).toHaveCount(1);
+  await expect(rows.first()).toContainText(nonDefaultAction);
+  await expect(rows.first()).not.toContainText(action1);
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
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/E4-fix-a4.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=E4 attempt=4 marker=DRV-E4-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
