# [driver] F0b — THE COMMIT UNDER TEST IS `58ad5f391bc09af57328bcc49be9d9f416cd941f`

Analyse EXACTLY that commit: `git show 58ad5f391bc09af57328bcc49be9d9f416cd941f`, `git diff 58ad5f391bc09af57328bcc49be9d9f416cd941f^..58ad5f391bc09af57328bcc49be9d9f416cd941f`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=58ad5f391bc09af57328bcc49be9d9f416cd941f`.

## The change under test (produced by the driver, not reported by the implementer)
```
[F0b] harness non-discriminating fixes: H3 theme via tg-light, setup failures reported, cleanup guaranteed


 e2e/command-center-window-fence.spec.ts | 85 ++++++++++++++++++++++++---------
 1 file changed, 63 insertions(+), 22 deletions(-)
```
```diff
diff --git a/e2e/command-center-window-fence.spec.ts b/e2e/command-center-window-fence.spec.ts
index 9af62ab..1c3e398 100644
--- a/e2e/command-center-window-fence.spec.ts
+++ b/e2e/command-center-window-fence.spec.ts
@@ -164,15 +164,22 @@ test('test_f1_refresh_from_session_surface_visible', async ({ page }, testInfo)
   const localFailed: Failure[] = [];
   const sessions: string[] = [];
   try {
-    await openAgentWindow(page, testInfo, 'f1', sessions);
+    try {
+      await openAgentWindow(page, testInfo, 'f1', sessions);
+    } catch (e) {
+      localFailed.push({ id: 'G3', kind: 'assert', message: e instanceof Error ? e.message : String(e) });
+    }
 
     await check(localPassed, localFailed, 'G3', async () => {
       const refresh = page.locator('[data-testid="terminal-refresh"]');
       await expect(refresh).toBeVisible();
     });
   } finally {
-    await finishContributor(testInfo.title, localPassed, localFailed);
-    for (const sessionName of sessions) killSession(sessionName);
+    try {
+      await finishContributor(testInfo.title, localPassed, localFailed);
+    } finally {
+      for (const sessionName of sessions) killSession(sessionName);
+    }
   }
 });
 
@@ -181,7 +188,11 @@ test('test_f2_draft_and_switcher_surfaces_are_rendered', async ({ page }, testIn
   const localFailed: Failure[] = [];
   const sessions: string[] = [];
   try {
-    await openAgentWindow(page, testInfo, 'f2', sessions);
+    try {
+      await openAgentWindow(page, testInfo, 'f2', sessions);
+    } catch (e) {
+      localFailed.push({ id: 'G1', kind: 'assert', message: e instanceof Error ? e.message : String(e) });
+    }
 
     await check(localPassed, localFailed, 'G1', async () => {
       const draft = page.locator('[data-testid="terminal-draft"]');
@@ -194,8 +205,11 @@ test('test_f2_draft_and_switcher_surfaces_are_rendered', async ({ page }, testIn
       await expect(switcher).toBeVisible();
     });
   } finally {
-    await finishContributor(testInfo.title, localPassed, localFailed);
-    for (const sessionName of sessions) killSession(sessionName);
+    try {
+      await finishContributor(testInfo.title, localPassed, localFailed);
+    } finally {
+      for (const sessionName of sessions) killSession(sessionName);
+    }
   }
 });
 
@@ -204,7 +218,11 @@ test('test_f3_refresh_action_and_draft_reload_keep_composer_usable', async ({ pa
   const localFailed: Failure[] = [];
   const sessions: string[] = [];
   try {
-    await openAgentWindow(page, testInfo, 'f3', sessions);
+    try {
+      await openAgentWindow(page, testInfo, 'f3', sessions);
+    } catch (e) {
+      localFailed.push({ id: 'I1', kind: 'assert', message: e instanceof Error ? e.message : String(e) });
+    }
 
     await check(localPassed, localFailed, 'I1', async () => {
       const refreshBtn = page.locator('[data-testid="terminal-refresh"]');
@@ -230,8 +248,11 @@ test('test_f3_refresh_action_and_draft_reload_keep_composer_usable', async ({ pa
       await expect(draftInputAfter).toHaveValue('test draft');
     });
   } finally {
-    await finishContributor(testInfo.title, localPassed, localFailed);
-    for (const sessionName of sessions) killSession(sessionName);
+    try {
+      await finishContributor(testInfo.title, localPassed, localFailed);
+    } finally {
+      for (const sessionName of sessions) killSession(sessionName);
+    }
   }
 });
 
@@ -240,7 +261,11 @@ test('test_f4_header_v2_collapses_without_losing_command_center_chrome', async (
   const localFailed: Failure[] = [];
   const sessions: string[] = [];
   try {
-    await openAgentWindow(page, testInfo, 'f4', sessions);
+    try {
+      await openAgentWindow(page, testInfo, 'f4', sessions);
+    } catch (e) {
+      localFailed.push({ id: 'H1', kind: 'assert', message: e instanceof Error ? e.message : String(e) });
+    }
 
     await check(localPassed, localFailed, 'H1', async () => {
       const header = page.locator('[data-testid="terminal-header-v2"]');
@@ -259,8 +284,11 @@ test('test_f4_header_v2_collapses_without_losing_command_center_chrome', async (
       expect(box!.height).toBeGreaterThan(0);
     });
   } finally {
-    await finishContributor(testInfo.title, localPassed, localFailed);
-    for (const sessionName of sessions) killSession(sessionName);
+    try {
+      await finishContributor(testInfo.title, localPassed, localFailed);
+    } finally {
+      for (const sessionName of sessions) killSession(sessionName);
+    }
   }
 });
 
@@ -269,7 +297,11 @@ test('test_f5_phone_dropdown_and_wide_switcher_are_available', async ({ page },
   const localFailed: Failure[] = [];
   const sessions: string[] = [];
   try {
-    await openAgentWindow(page, testInfo, 'f5', sessions);
+    try {
+      await openAgentWindow(page, testInfo, 'f5', sessions);
+    } catch (e) {
+      localFailed.push({ id: 'J1', kind: 'assert', message: e instanceof Error ? e.message : String(e) });
+    }
 
     await ensureTabsExpandedIfNeeded(page);
     await check(localPassed, localFailed, 'J1', async () => {
@@ -288,8 +320,11 @@ test('test_f5_phone_dropdown_and_wide_switcher_are_available', async ({ page },
       expect(count).toBeGreaterThan(0);
     });
   } finally {
-    await finishContributor(testInfo.title, localPassed, localFailed);
-    for (const sessionName of sessions) killSession(sessionName);
+    try {
+      await finishContributor(testInfo.title, localPassed, localFailed);
+    } finally {
+      for (const sessionName of sessions) killSession(sessionName);
+    }
   }
 });
 
@@ -298,18 +333,24 @@ test('test_f6_window_theme_attribute_is_applied', async ({ page }, testInfo) =>
   const localFailed: Failure[] = [];
   const sessions: string[] = [];
   try {
-    await openAgentWindow(page, testInfo, 'f6', sessions);
+    try {
+      await openAgentWindow(page, testInfo, 'f6', sessions);
+    } catch (e) {
+      localFailed.push({ id: 'H3', kind: 'assert', message: e instanceof Error ? e.message : String(e) });
+    }
 
     await check(localPassed, localFailed, 'H3', async () => {
       const theme = await page.evaluate(() => {
-        const attr = document.documentElement.getAttribute('data-theme');
-        if (attr) return attr;
-        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
+        const isLight = document.body.classList.contains('tg-light');
+        return isLight ? 'light' : 'dark';
       });
-      expect(theme).toBeTruthy();
+      expect(theme).toMatch(/^(light|dark)$/);
     });
   } finally {
-    await finishContributor(testInfo.title, localPassed, localFailed);
-    for (const sessionName of sessions) killSession(sessionName);
+    try {
+      await finishContributor(testInfo.title, localPassed, localFailed);
+    } finally {
+      for (const sessionName of sessions) killSession(sessionName);
+    }
   }
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

# THE SLICE — F0b (run command-center-2026-08-26)

## Scope (do ONLY this)
HARNESS-CORRECTNESS ONLY. POSITIVE path of e2e/command-center-window-fence.spec.ts so G1-J2 match og-req on frozen F1-F6: restore check() await assertion; wait primary AND secondary in /api/tmux/sessions; H1 assert default tabs-collapsed without click; click tabs-collapse only to reveal switcher for G2/J1/J2; literal fixtures not expect(true); J2 uses data-testid=terminal-header-tab. Named-reds and fence-contract remap are F0c. Collect ALL G1-J2. Write fence-report-v1.json in finally. Do not implement product UI. Split from SLICE-TOO-BIG a4.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **HARNESS-SMOKE** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`FENCE_ID=F7 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=F0b attempt=1 role=validator
  marker=DRV-F0b-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate F0b independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator F0b STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/F0b-fix-a3.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=F0b attempt=3 marker=DRV-F0b-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
