# [driver] F0b — THE COMMIT UNDER TEST IS `9e35ea852351f9285b549531e297439dfe77e225`

Analyse EXACTLY that commit: `git show 9e35ea852351f9285b549531e297439dfe77e225`, `git diff 9e35ea852351f9285b549531e297439dfe77e225^..9e35ea852351f9285b549531e297439dfe77e225`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=9e35ea852351f9285b549531e297439dfe77e225`.

## The change under test (produced by the driver, not reported by the implementer)
```
[F0b] H3 drives real Telegram theme fixture (route-stub SDK), J2 proves scrubber drag + tab switch


 e2e/command-center-window-fence.spec.ts | 161 +++++++++++++++++++++++++++++---
 1 file changed, 149 insertions(+), 12 deletions(-)
```
```diff
diff --git a/e2e/command-center-window-fence.spec.ts b/e2e/command-center-window-fence.spec.ts
index 1c3e398..43e0a89 100644
--- a/e2e/command-center-window-fence.spec.ts
+++ b/e2e/command-center-window-fence.spec.ts
@@ -12,6 +12,32 @@ const APP_ORIGIN = process.env.FENCE_ORIGIN || 'http://localhost:3210';
 const OWNER_TOKEN = process.env.OWNER_TOKEN || 'test-token';
 const AUTH_HEADERS = { authorization: `Bearer ${OWNER_TOKEN}` };
 
+// Literal Telegram WebApp themeParams fixtures for H3 — distinct, product-owned
+// inputs driven through the real applyTgTheme() path (src/web/public/app.js),
+// never inferred from the mechanism under test.
+const LIGHT_THEME_PARAMS = {
+  bg_color: '#ffffff',
+  text_color: '#111111',
+  hint_color: '#555555',
+  secondary_bg_color: '#f2f2f2',
+  section_bg_color: '#eeeeee',
+  section_separator_color: '#dddddd',
+  button_color: '#2481cc',
+  button_text_color: '#ffffff',
+  accent_text_color: '#2481cc',
+};
+const DARK_THEME_PARAMS = {
+  bg_color: '#0b0b0f',
+  text_color: '#f5f5f5',
+  hint_color: '#9a9a9a',
+  secondary_bg_color: '#17171c',
+  section_bg_color: '#141419',
+  section_separator_color: '#26262c',
+  button_color: '#5288c1',
+  button_text_color: '#ffffff',
+  accent_text_color: '#5288c1',
+};
+
 const CONTRIBUTOR_TESTS = [
   'test_f1_refresh_from_session_surface_visible',
   'test_f2_draft_and_switcher_surfaces_are_rendered',
@@ -93,6 +119,36 @@ function paneTargetFor(sessionName: string): string {
   return result.stdout.trim();
 }
 
+// Installs a fake window.Telegram.WebApp BEFORE the app's own theme-detection
+// script runs (addInitScript fires ahead of any page script on every future
+// navigation). Captures the themeChanged handler so a later evaluate() can
+// re-drive the SAME product path applyTgTheme() uses on a real device theme
+// flip, without a reload.
+// index.html also loads the REAL telegram-web-app.js SDK from telegram.org
+// after our addInitScript runs but before app.js — that script overwrites
+// window.Telegram.WebApp with its own (initData: '') object outside an actual
+// Telegram client, silently discarding our fixture. Stub the request so our
+// mock survives to app.js's isTgMiniApp check.
+async function installTelegramThemeFixture(page, themeParams: Record<string, string>) {
+  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => {
+    route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* fence-stubbed: real Telegram WebApp SDK intentionally not loaded */' });
+  });
+  await page.addInitScript((tp) => {
+    (window as any).Telegram = {
+      WebApp: {
+        initData: 'fence-theme-fixture',
+        themeParams: tp,
+        ready() {},
+        expand() {},
+        disableVerticalSwipes() {},
+        onEvent(name: string, cb: () => void) {
+          if (name === 'themeChanged') (window as any).__fenceApplyTheme = cb;
+        },
+      },
+    };
+  }, themeParams);
+}
+
 async function ensureTabsExpandedIfNeeded(page) {
   const switcher = page.locator('[data-testid="agent-group-switcher"]');
   const isHidden = await switcher.evaluate(el => el?.hasAttribute('hidden')).catch(() => true);
@@ -104,37 +160,49 @@ async function ensureTabsExpandedIfNeeded(page) {
   }
 }
 
-async function installOwnerSession(page, primaryName: string, secondaryName: string, primaryTarget: string, secondaryTarget: string) {
-  await page.addInitScript(({ ownerToken, primaryName, secondaryName, primaryTarget, secondaryTarget }) => {
+async function installOwnerSession(page, primaryName: string, secondaryName: string, primaryTarget: string, secondaryTarget: string, extraSiblingNames: string[] = []) {
+  await page.addInitScript(({ ownerToken, primaryName, secondaryName, primaryTarget, secondaryTarget, extraSiblingNames }) => {
     localStorage.setItem('agj_token', ownerToken);
     localStorage.setItem('agj_user', JSON.stringify({ id: 1000000001, name: 'jrom', role: 'owner' }));
     localStorage.setItem('agj_terminal_active_group', 'f7-window');
     localStorage.setItem('agj_terminal_groups', JSON.stringify([
-      { id: 'f7-window', name: 'F7 Window', sessions: [primaryName, secondaryName] },
+      { id: 'f7-window', name: 'F7 Window', sessions: [primaryName, secondaryName, ...extraSiblingNames] },
     ]));
     localStorage.setItem(`agj_terminal_draft:friendly-terminal:${encodeURIComponent(primaryTarget)}`, 'test draft');
     localStorage.setItem(`agj_terminal_draft:friendly-terminal:${encodeURIComponent(secondaryTarget)}`, 'other draft');
-  }, { ownerToken: OWNER_TOKEN, primaryName, secondaryName, primaryTarget, secondaryTarget });
+  }, { ownerToken: OWNER_TOKEN, primaryName, secondaryName, primaryTarget, secondaryTarget, extraSiblingNames });
 }
 
-async function openAgentWindow(page, testInfo, prefix: string, sessions: string[]) {
+// extraSiblingCount: extra idle tmux sessions added to the same group so the
+// wide header's tab strip actually overflows (J2 needs real scrollable
+// content — a single sibling tab never overflows the 1024px header).
+async function openAgentWindow(page, testInfo, prefix: string, sessions: string[], opts: { extraSiblingCount?: number } = {}) {
+  const extraSiblingCount = opts.extraSiblingCount || 0;
   const primaryName = uniqueSession(`${prefix}-a`, testInfo.workerIndex);
   const secondaryName = uniqueSession(`${prefix}-b`, testInfo.workerIndex);
   createSession(primaryName);
   sessions.push(primaryName);
   createSession(secondaryName);
   sessions.push(secondaryName);
+  const extraSiblingNames: string[] = [];
+  for (let i = 0; i < extraSiblingCount; i++) {
+    const extraName = uniqueSession(`${prefix}-x${i}`, testInfo.workerIndex);
+    createSession(extraName);
+    sessions.push(extraName);
+    extraSiblingNames.push(extraName);
+  }
   const primaryTarget = paneTargetFor(primaryName);
   const secondaryTarget = paneTargetFor(secondaryName);
 
+  const allNames = [primaryName, secondaryName, ...extraSiblingNames];
   await expect.poll(async () => {
     const resp = await page.request.get(`${APP_ORIGIN}/api/tmux/sessions`, { headers: AUTH_HEADERS });
     const json = await resp.json().catch(() => ({}));
     const names = new Set((json.sessions || []).map((s: any) => s.session_name));
-    return names.has(primaryName) && names.has(secondaryName);
+    return allNames.every((n) => names.has(n));
   }, { timeout: 10000 }).toBe(true);
 
-  await installOwnerSession(page, primaryName, secondaryName, primaryTarget, secondaryTarget);
+  await installOwnerSession(page, primaryName, secondaryName, primaryTarget, secondaryTarget, extraSiblingNames);
   await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'domcontentloaded' });
   await page.locator('[data-testid="terminal-group-tab"][data-group-id="all"]').click();
   const row = page.locator('.terminal-list-name').filter({ hasText: primaryName }).first();
@@ -298,7 +366,9 @@ test('test_f5_phone_dropdown_and_wide_switcher_are_available', async ({ page },
   const sessions: string[] = [];
   try {
     try {
-      await openAgentWindow(page, testInfo, 'f5', sessions);
+      // extraSiblingCount forces the wide tab strip to overflow — J2 needs a
+      // real draggable scrubber, which a single non-overflowing tab never has.
+      await openAgentWindow(page, testInfo, 'f5', sessions, { extraSiblingCount: 4 });
     } catch (e) {
       localFailed.push({ id: 'J1', kind: 'assert', message: e instanceof Error ? e.message : String(e) });
     }
@@ -318,6 +388,37 @@ test('test_f5_phone_dropdown_and_wide_switcher_are_available', async ({ page },
       const tabs = page.locator('[data-testid="terminal-header-tab"]');
       const count = await tabs.count();
       expect(count).toBeGreaterThan(0);
+
+      // Prove the scrubber is a real, working drag control: grab it and drag
+      // left, then assert the tab strip's scrollLeft actually moved off 0.
+      // (Dragging left increases clientX-to-startX delta positive per the
+      // product's onPointerDown handler in src/web/public/app.js.)
+      const scrubber = page.locator('[data-testid="agent-group-switcher-scrubber"]');
+      await expect(scrubber).toBeVisible();
+      const beforeScrollLeft = await switcher.evaluate((el) => el.scrollLeft);
+      expect(beforeScrollLeft).toBe(0);
+      const box = await scrubber.boundingBox();
+      if (!box) throw new Error('agent-group-switcher-scrubber has no bounding box');
+      const startX = box.x + box.width / 2;
+      const startY = box.y + box.height / 2;
+      await page.mouse.move(startX, startY);
+      await page.mouse.down();
+      await page.mouse.move(startX - 140, startY, { steps: 10 });
+      await page.mouse.up();
+      const afterScrollLeft = await switcher.evaluate((el) => el.scrollLeft);
+      expect(afterScrollLeft).toBeGreaterThan(beforeScrollLeft);
+
+      // Prove the wide path switches the active agent identically to the
+      // narrow dropdown path: click a non-active tab, assert the header's
+      // session-name target actually moves to that tab's literal session.
+      const nonActiveTab = tabs.first();
+      const clickedLabel = ((await nonActiveTab.textContent()) || '').replace(/\s*•\s*$/, '').trim();
+      expect(clickedLabel.length).toBeGreaterThan(0);
+      expect(clickedLabel).not.toBe(sessions[0]);
+      await nonActiveTab.click();
+      const sessionName = page.locator('[data-testid="terminal-session-name"]');
+      await expect(sessionName).toContainText(clickedLabel);
+      await expect(sessionName).not.toContainText(sessions[0]);
     });
   } finally {
     try {
@@ -334,17 +435,53 @@ test('test_f6_window_theme_attribute_is_applied', async ({ page }, testInfo) =>
   const sessions: string[] = [];
   try {
     try {
+      // Drive the real Telegram device-theme path (window.Telegram.WebApp),
+      // not a matchMedia/class-absence fallback — must be registered before
+      // openAgentWindow's page.goto so app.js's isTgMiniApp detection sees it.
+      await installTelegramThemeFixture(page, LIGHT_THEME_PARAMS);
       await openAgentWindow(page, testInfo, 'f6', sessions);
     } catch (e) {
       localFailed.push({ id: 'H3', kind: 'assert', message: e instanceof Error ? e.message : String(e) });
     }
 
     await check(localPassed, localFailed, 'H3', async () => {
-      const theme = await page.evaluate(() => {
-        const isLight = document.body.classList.contains('tg-light');
-        return isLight ? 'light' : 'dark';
+      // Literal input 1: light. Assert the product actually applied it —
+      // not synthesized from the absence of a class.
+      const lightState = await page.evaluate(() => ({
+        tgLight: document.body.classList.contains('tg-light'),
+        rootBg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
+        rootText: getComputedStyle(document.documentElement).getPropertyValue('--text').trim(),
+      }));
+      expect(lightState.tgLight).toBe(true);
+      expect(lightState.rootBg).toBe(LIGHT_THEME_PARAMS.bg_color);
+      expect(lightState.rootText).toBe(LIGHT_THEME_PARAMS.text_color);
+      expect(lightState.rootBg).not.toBe(lightState.rootText);
+
+      // Literal input 2: dark, driven through the SAME product mechanism —
+      // Telegram's themeChanged event handler (captured as __fenceApplyTheme)
+      // — not a page reload and not a second, test-invented code path.
+      await page.evaluate((tp) => {
+        (window as any).Telegram.WebApp.themeParams = tp;
+        (window as any).__fenceApplyTheme?.();
+      }, DARK_THEME_PARAMS);
+
+      const darkState = await page.evaluate(() => {
+        const shell = document.querySelector('.terminal-shell');
+        return {
+          tgLight: document.body.classList.contains('tg-light'),
+          tgThemeBg: getComputedStyle(document.documentElement).getPropertyValue('--tg-theme-bg-color').trim(),
+          shellBg: shell ? getComputedStyle(shell).getPropertyValue('--bg').trim() : null,
+          shellText: shell ? getComputedStyle(shell).getPropertyValue('--text').trim() : null,
+        };
       });
-      expect(theme).toMatch(/^(light|dark)$/);
+      expect(darkState.tgLight).toBe(false);
+      expect(darkState.tgThemeBg).toBe(DARK_THEME_PARAMS.bg_color);
+      // The terminal surface itself (not just :root) must carry the dark
+      // product tokens — this is the "remains readable" half of OG H3.
+      expect(darkState.shellBg).toBe(DARK_THEME_PARAMS.bg_color);
+      expect(darkState.shellText).toBe(DARK_THEME_PARAMS.text_color);
+      expect(darkState.shellBg).not.toBe(darkState.shellText);
+      expect(darkState.shellBg).not.toBe(lightState.rootBg);
     });
   } finally {
     try {
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
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/F0b-fix-a4.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=F0b attempt=4 marker=DRV-F0b-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
