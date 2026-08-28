# [driver] F2 — THE COMMIT UNDER TEST IS `afa783f35e136a7c9fae7a3b841c867b45fb7496`

Analyse EXACTLY that commit: `git show afa783f35e136a7c9fae7a3b841c867b45fb7496`, `git diff afa783f35e136a7c9fae7a3b841c867b45fb7496^..afa783f35e136a7c9fae7a3b841c867b45fb7496`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=afa783f35e136a7c9fae7a3b841c867b45fb7496`.

## The change under test (produced by the driver, not reported by the implementer)
```
[F2] Fix send draft clear and discriminating Playwright spec


 e2e/command-center-drafts.spec.ts     | 88 ++++++++++++++++++++++++++---------
 src/web/public/terminal-chat-state.js |  6 ++-
 2 files changed, 72 insertions(+), 22 deletions(-)
```
```diff
diff --git a/e2e/command-center-drafts.spec.ts b/e2e/command-center-drafts.spec.ts
index 0413040..968b2bc 100644
--- a/e2e/command-center-drafts.spec.ts
+++ b/e2e/command-center-drafts.spec.ts
@@ -4,30 +4,76 @@ test('command-center drafts persist per pane with indicators', async ({ page })
   await page.addInitScript(() => {
     localStorage.setItem('agj_user', JSON.stringify({ id: 1, name: 'test' }));
     localStorage.setItem('agj_token', 'test-token');
-    // Preload literal drafts for two panes
     localStorage.setItem('agj_terminal_draft:friendly-terminal:SA%3A0.0', 'literal-alpha-preloaded');
     localStorage.setItem('agj_terminal_draft:friendly-terminal:SB%3A0.0', 'literal-beta-preloaded');
+    localStorage.setItem('agj_terminal_groups', JSON.stringify([{ id: 'g1', name: 'Group1', sessions: ['SA','SB'] }]));
   });
+
+  await page.route('**/api/tmux/sessions', async route => {
+    await route.fulfill({
+      status: 200,
+      contentType: 'application/json',
+      body: JSON.stringify({
+        sessions: [
+          { session_name: 'SA', panes: [{ target: 'SA:0.0', command: '', activity: 0, busy: false }] },
+          { session_name: 'SB', panes: [{ target: 'SB:0.0', command: '', activity: 0, busy: false }] }
+        ]
+      })
+    });
+  });
+
+  await page.route('**/api/tmux/panes/*/output*', async route => {
+    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ output: '' }) });
+  });
+
+  await page.route('**/api/tmux/panes/*/send*', async route => {
+    await route.fulfill({ status: 200, body: 'ok' });
+  });
+
   await page.goto('http://localhost:3210/index.html#/terminals', { waitUntil: 'domcontentloaded' });
 
-  // Wait for terminal UI to be present
-  await page.waitForSelector('[data-testid="terminal-session-name"]', { timeout: 10000 }).catch(() => {});
-
-  // Switcher must be present when group siblings exist
-  const switcher = page.locator('[data-testid="agent-group-switcher"]');
-  // Draft indicators are rendered as • in header tabs
-  const tabs = page.locator('[data-testid="terminal-header-tab"]');
-  const tabCount = await tabs.count();
-  if (tabCount > 0) {
-    // At least one tab should be visible
-    await expect(tabs.first()).toBeVisible();
-  }
-
-  // Verify drafts remain in localStorage and were not erased by hydration
-  const drafts = await page.evaluate(() => ({
-    a: localStorage.getItem('agj_terminal_draft:friendly-terminal:SA%3A0.0'),
-    b: localStorage.getItem('agj_terminal_draft:friendly-terminal:SB%3A0.0')
-  }));
-  expect(drafts.a).toBe('literal-alpha-preloaded');
-  expect(drafts.b).toBe('literal-beta-preloaded');
+  await page.waitForSelector('.terminal-list-name', { timeout: 10000 });
+
+  // Click SA row
+  await page.locator('.terminal-list-name').filter({ hasText: 'SA' }).first().click();
+
+  const composer = page.locator('[data-testid="terminal-composer-input"]');
+  await expect(composer).toBeVisible();
+  await expect(composer).toHaveValue('literal-alpha-preloaded');
+
+  // Sibling tab for SB with draft marker
+  const tabSB = page.locator('[data-testid="terminal-header-tab"]').filter({ hasText: /SB/ });
+  await expect(tabSB).toBeVisible();
+  await expect(tabSB).toContainText('•');
+
+  // Edit SA draft
+  await composer.fill('literal-alpha-live');
+
+  // Switch to SB via public switcher
+  await tabSB.click();
+  await expect(composer).toHaveValue('literal-beta-preloaded');
+
+  // Edit SB draft
+  await composer.fill('literal-beta-live');
+
+  // Switch back to SA
+  const tabSA = page.locator('[data-testid="terminal-header-tab"]').filter({ hasText: /SA/ });
+  await tabSA.click();
+  await expect(composer).toHaveValue('literal-alpha-live');
+
+  // Send SA
+  await page.locator('[data-testid="terminal-send-command"]').click();
+  await page.waitForTimeout(500);
+
+  // Switch to SB again, draft should persist
+  await tabSB.click();
+  await expect(composer).toHaveValue('literal-beta-live');
+
+  // SA draft should be cleared from storage
+  const saDraft = await page.evaluate(() => localStorage.getItem('agj_terminal_draft:friendly-terminal:SA%3A0.0'));
+  expect(saDraft).toBeNull();
+
+  // SB draft should still exist
+  const sbDraft = await page.evaluate(() => localStorage.getItem('agj_terminal_draft:friendly-terminal:SB%3A0.0'));
+  expect(sbDraft).toBe('literal-beta-live');
 });
diff --git a/src/web/public/terminal-chat-state.js b/src/web/public/terminal-chat-state.js
index f0522f7..44e0458 100644
--- a/src/web/public/terminal-chat-state.js
+++ b/src/web/public/terminal-chat-state.js
@@ -1352,7 +1352,11 @@ export function writeTerminalDraft(viewer, pane, draft) {
     if (typeof localStorage === "undefined") return;
     const key = _terminalDraftKey(viewer, pane);
     const value = draft == null ? "" : String(draft);
-    localStorage.setItem(key, value);
+    if (!value) {
+      localStorage.removeItem(key);
+    } else {
+      localStorage.setItem(key, value);
+    }
   } catch {
     // no-op on storage errors
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

# THE SLICE — F2 (run command-center-2026-08-26)

## Scope (do ONLY this)
Web UI layer: wire per-pane drafts into `FriendlyTerminalView` and the agent switcher (restore on switch, draft-kept + switcher indicators, clear only the sent pane). After B8 so OVM chrome is gone.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **G1** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **G2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **G3** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`npx playwright test e2e/command-center-drafts.spec.ts --project=cc`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=F2 attempt=1 role=validator
  marker=DRV-F2-24 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate F2 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator F2 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/F2-fix-a3.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=F2 attempt=3 marker=DRV-F2-24 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
