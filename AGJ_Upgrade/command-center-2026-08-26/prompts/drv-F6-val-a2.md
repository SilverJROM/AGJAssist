# [driver] F6 — THE COMMIT UNDER TEST IS `6f2ae0f003b86e56ddd346b2e08dc511c04f496b`

Analyse EXACTLY that commit: `git show 6f2ae0f003b86e56ddd346b2e08dc511c04f496b`, `git diff 6f2ae0f003b86e56ddd346b2e08dc511c04f496b^..6f2ae0f003b86e56ddd346b2e08dc511c04f496b`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=6f2ae0f003b86e56ddd346b2e08dc511c04f496b`.

## The change under test (produced by the driver, not reported by the implementer)
```
[F6] extend agent-window-v2 responsive tokens and discriminating Playwright spec


 e2e/command-center-responsive.spec.ts | 118 +++++++++++++++++++++++++++++++++-
 src/web/public/style.css              |  36 +++++++++++
 2 files changed, 151 insertions(+), 3 deletions(-)
```
```diff
diff --git a/e2e/command-center-responsive.spec.ts b/e2e/command-center-responsive.spec.ts
index 92e77da..ffcad36 100644
--- a/e2e/command-center-responsive.spec.ts
+++ b/e2e/command-center-responsive.spec.ts
@@ -1,6 +1,118 @@
 import { test, expect } from '@playwright/test';
 
-test('responsive tokens present', async ({ page }) => {
-  // Minimal placeholder to allow F6 slice to run
-  expect(true).toBe(true);
+const APP_ORIGIN = process.env.AGJ_TERMINAL_BASE_URL || 'http://localhost:3210';
+const SESSION_NAMES = ['alpha','bravo','charlie','delta','echo','foxtrot','golf','hotel','india','juliet','kilo','lima'];
+
+const targetFor = (name: string) => `${name}:0.0`;
+
+async function stubCommandCenter(page) {
+  await page.addInitScript(({ sessions }) => {
+    (window as unknown as { Telegram: unknown }).Telegram = {
+      WebApp: {
+        initData: 'command-center-responsive',
+        ready() {}, expand() {}, disableVerticalSwipes() {},
+        themeParams: {}, onEvent() {}, offEvent() {},
+        BackButton: { show() {}, hide() {}, onClick() {}, offClick() {} },
+        HapticFeedback: { selectionChanged() {} },
+      },
+    };
+    localStorage.setItem('agj_token', 'command-center-responsive-token');
+    localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'e2e', username: 'e2e', role: 'owner' }));
+    localStorage.setItem('agj_terminal_groups', JSON.stringify([{ id: 'g1', name: 'Group1', sessions }]));
+    localStorage.setItem('agj_terminal_active_group', 'g1');
+  }, { sessions: SESSION_NAMES });
+
+  await page.route(/telegram-web-app\.js/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
+  await page.route(/\/api\/auth\/me(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 1, username: 'e2e', display_name: 'e2e', role: 'owner', totp_enabled: false }) }));
+  await page.route('**/api/auth/telegram', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'command-center-responsive-token', user: { id: 1, username: 'e2e', displayName: 'e2e', role: 'owner' } }) }));
+  await page.route(/\/api\/safety\/patterns(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"patterns":[]}' }));
+  await page.route(/\/api\/terminal\/groups(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ groups: [{ id: 'g1', name: 'Group1', sessions: SESSION_NAMES }], activeGroup: 'g1' }) }));
+  await page.route(/\/api\/tmux\/sessions(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: SESSION_NAMES.map((name, index) => ({ session_name: name, panes: [{ target: targetFor(name), command: 'claude', activity: 100 - index, busy: name === 'alpha' }] })) }) }));
+  await page.route(/\/api\/tmux\/panes\/[^/]+\/output(?:\?.*)?$/, (route) => {
+    const url = route.request().url();
+    const target = decodeURIComponent(url.split('/panes/')[1]?.split('/output')[0] || '');
+    const name = target.split(':')[0] || 'unknown';
+    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: `* ${name} ready`, target, lines: 200 }) });
+  });
+  await page.route('**/api/agent-reminders/active', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"reminders":[]}' }));
+  await page.route('**/api/agent-wakeups/pending', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"wakeups":[]}' }));
+}
+
+async function openTerminal(page, width: number) {
+  await page.setViewportSize({ width, height: 820 });
+  await page.goto(`${APP_ORIGIN}/index.html#/terminals`, { waitUntil: 'domcontentloaded' });
+  await page.waitForSelector('[data-testid="terminal-session-row"]', { state: 'visible' }).catch(() => {});
+  const firstRow = page.locator('[data-testid="terminal-session-row"]').first();
+  if (await firstRow.count()) {
+    await firstRow.click({ position: { x: 24, y: 18 } }).catch(() => {});
+  }
+  await page.waitForSelector('.terminal-shell', { state: 'visible' }).catch(() => {});
+  await page.waitForTimeout(500);
+}
+
+test.beforeEach(async ({ page }) => {
+  await stubCommandCenter(page);
+});
+
+test('390px transcript padding stays phone value', async ({ page }) => {
+  await openTerminal(page, 390);
+  const padLeft = await page.evaluate(() => {
+    const el = document.querySelector('.terminal-chat-transcript') as HTMLElement | null;
+    if (!el) throw new Error('transcript missing');
+    return getComputedStyle(el).paddingLeft;
+  });
+  expect(padLeft).toBe('12px');
+});
+
+test('768px transcript/composer padding is 24px and control bar centered', async ({ page }) => {
+  await openTerminal(page, 768);
+  const transcriptPad = await page.evaluate(() => {
+    const el = document.querySelector('.terminal-chat-transcript') as HTMLElement | null;
+    return getComputedStyle(el!).paddingLeft;
+  });
+  // At 768px the tablet column should expand beyond phone 12px
+  expect(transcriptPad).not.toBe('12px');
+  const composerPad = await page.evaluate(() => {
+    const el = document.querySelector('.terminal-chat-composer') as HTMLElement | null;
+    return getComputedStyle(el!).paddingLeft;
+  });
+  expect(composerPad).not.toBe('12px');
+  const justify = await page.evaluate(() => {
+    const el = document.querySelector('.terminal-control-bar') as HTMLElement | null;
+    return getComputedStyle(el!).justifyContent;
+  });
+  expect(justify).toBe('center');
 });
+
+test('1024px transcript/composer/control-bar padding matches 880px column and search offset moves', async ({ page }) => {
+  await openTerminal(page, 1024);
+  const transcriptPad = await page.evaluate(() => {
+    const el = document.querySelector('.terminal-chat-transcript') as HTMLElement | null;
+    return getComputedStyle(el!).paddingLeft;
+  });
+  // Desktop column should be wider than tablet/phone
+  expect(transcriptPad).not.toBe('12px');
+  const composerPad = await page.evaluate(() => {
+    const el = document.querySelector('.terminal-chat-composer') as HTMLElement | null;
+    return getComputedStyle(el!).paddingLeft;
+  });
+  expect(composerPad).not.toBe('12px');
+  const controlPad = await page.evaluate(() => {
+    const el = document.querySelector('.terminal-control-bar') as HTMLElement | null;
+    return getComputedStyle(el!).paddingLeft;
+  });
+  expect(controlPad).not.toBe('10px');
+  const searchRight = await page.evaluate(() => {
+    const el = document.querySelector('.terminal-search-toggle') as HTMLElement | null;
+    if (!el) return null;
+    return getComputedStyle(el).right;
+  });
+  expect(searchRight).not.toBe('12px');
+  const topbarMax = await page.evaluate(() => {
+    const el = document.querySelector('.terminal-topbar-target') as HTMLElement | null;
+    if (!el) return null;
+    return getComputedStyle(el).maxWidth;
+  });
+  expect(topbarMax).toBe('260px');
+});
+
diff --git a/src/web/public/style.css b/src/web/public/style.css
index 34a1d05..0320d03 100644
--- a/src/web/public/style.css
+++ b/src/web/public/style.css
@@ -4897,6 +4897,25 @@ body.tg-miniapp {
     width: min(520px, 100%);
     transform: translateX(-50%);
   }
+  .terminal-shell .terminal-topbar-target {
+    max-width: 220px;
+    flex: 0 1 220px;
+  }
+  .terminal-shell .terminal-header-tab {
+    max-width: 140px;
+  }
+  .terminal-shell .terminal-search-toggle {
+    right: max(12px, calc((100% - 720px) / 2));
+  }
+  .terminal-shell .terminal-search-bar {
+    margin-left: max(0px, calc((100% - 720px) / 2));
+    margin-right: max(0px, calc((100% - 720px) / 2));
+    border-radius: 0 0 10px 10px;
+  }
+  .terminal-shell .terminal-control-bar button {
+    flex: 0 1 72px;
+    max-width: 88px;
+  }
 }
 @media (min-width:1024px) {
   .terminal-shell .terminal-chat-transcript {
@@ -4918,6 +4937,23 @@ body.tg-miniapp {
   .terminal-shell .terminal-menu-sheet {
     width: min(560px, 100%);
   }
+  .terminal-shell .terminal-topbar-target {
+    max-width: 260px;
+    flex: 0 1 260px;
+  }
+  .terminal-shell .terminal-header-tab {
+    max-width: 160px;
+  }
+  .terminal-shell .terminal-search-toggle {
+    right: max(16px, calc((100% - 880px) / 2));
+  }
+  .terminal-shell .terminal-search-bar {
+    margin-left: max(0px, calc((100% - 880px) / 2));
+    margin-right: max(0px, calc((100% - 880px) / 2));
+  }
+  .terminal-shell .terminal-topbar-main {
+    gap: 8px;
+  }
 }
 
 /* Ensure system/light/dark theme adaptation follows device setting */
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

# THE SLICE — F6 (run command-center-2026-08-26)

## Scope (do ONLY this)
CSS layer: port locked `agent-window-v2` theme/responsive tokens in `style.css` (system/light/dark, 390px spacing, centered capped column on tablet/desktop) without regressing existing controls.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **H3** — The surface is **theme-adaptive** (light/dark follows the device setting) and **readable**; it holds up **mobile / tablet / desktop** — wide widths keep a centered readable column rather than edge-to-edge text.
- **J1** — At **phone / narrow widths** the group agent switcher is a **dropdown** (current agent + caret → tap → pick from the group list, with status + draft indicators); no drag control.
- **J2** — At **wide tablet / desktop widths** it is the horizontal strip **+ a working draggable scrubber**; the presentation swaps by width and both paths switch the active agent identically.

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`npx playwright test e2e/command-center-responsive.spec.ts --project=cc`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=F6 attempt=1 role=validator
  marker=DRV-F6-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate F6 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator F6 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/F6-fix-a2.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=F6 attempt=2 marker=DRV-F6-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
