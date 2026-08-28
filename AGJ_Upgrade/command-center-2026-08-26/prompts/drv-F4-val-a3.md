# [driver] F4 — THE COMMIT UNDER TEST IS `bb82a579400cc546ab44f26f24f78278197bdfa0`

Analyse EXACTLY that commit: `git show bb82a579400cc546ab44f26f24f78278197bdfa0`, `git diff bb82a579400cc546ab44f26f24f78278197bdfa0^..bb82a579400cc546ab44f26f24f78278197bdfa0`.
**Do NOT use `git rev-parse HEAD`** — HEAD moves when anyone commits, including the coordinator writing its own artifacts, and judging the wrong commit has already FAILed a slice whose work was correct. Report `commit=bb82a579400cc546ab44f26f24f78278197bdfa0`.

## The change under test (produced by the driver, not reported by the implementer)
```
feat(F4): port header v2 collapse chrome with bell hints, controls tuck, row split, and spec hardening


 .../prompts/drv-F4-impl-a3.md                      | 172 +++++++++++++++++++++
 e2e/command-center-header.spec.ts                  |  54 +++++--
 src/web/public/app.js                              |   6 +-
 src/web/public/style.css                           |  20 ++-
 4 files changed, 238 insertions(+), 14 deletions(-)
```
```diff
diff --git a/AGJ_Upgrade/command-center-2026-08-26/prompts/drv-F4-impl-a3.md b/AGJ_Upgrade/command-center-2026-08-26/prompts/drv-F4-impl-a3.md
new file mode 100644
index 0000000..673509f
--- /dev/null
+++ b/AGJ_Upgrade/command-center-2026-08-26/prompts/drv-F4-impl-a3.md
@@ -0,0 +1,172 @@
+# tiller implementer — standing contract
+(This section is identical in every implementer brief. Your specific work is in THE SLICE below.)
+- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
+- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
+- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
+  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
+- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
+- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.
+
+You are the IMPLEMENTER. You write product code and tests, then commit.
+
+---
+
+# [driver] F4 CORRECTION (attempt 3) — fix EVERY finding the validator listed
+
+
+## ⚠ STANDING DIRECTION FROM THE COORDINATOR — applies to THIS attempt too
+
+[north] PLAN_SOUND H1/H2. Carry validation/F4-fix-a3.md at sol after L1. Cherry-pick 4d32468. Fix: (1) header htm children valid array, no i.push; (2) collapsed utilities = bell-only; (3) port header-v2 CSS one-row; (4) click actual session row not parent; (5) collapsed tabs = visibility not DOM count. Playwright 180s. Callback immediately after commit. Budget 8. Split F4a/F4b only if this still fails.
+
+**This is a constraint, not background.** It was written after a previous attempt and it still binds: if it forbids something, the fix that does it is wrong even when the tests go green.
+The independent validator FAILed F4: defect_class=IMPL_INCOMPLETE gate=None.
+**Validator's callback summary:** [projcore callback] validator F4 STATUS: DONE — FAIL deps fixed; H2 untouched: bell on row 2, no hint, no ⋯ tuck
+
+## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)
+
+```
+# F4 prescription — validator attempt=2, marker DRV-F4-21, commit 282a84f87e3aa4ca0e21348858f21b0726d2c988
+Read this WITH validation/F4-redteam-v2.md — every number below is a measurement in it.
+
+## ALREADY DONE — DO NOT REDO
+a1 findings 7 and 8 (the effect-dependency freshness regressions) are FIXED and verified:
+  summariesFreshness {beforeOpen:1, afterOpen:2, refetchedOnOpen:true}   (F4-dom-aria-v2.json)
+  menu open -> reminders 1->2, wakeups 1->2, aria-expanded "true"        (F4-menu-probe-v2.json)
+The 2-line diff in 282a84f is correct. What follows is everything it did not touch — this commit
+changed ONLY app.js dependency arrays; e2e/command-center-header.spec.ts and style.css are
+byte-identical to the a1 subject, so a1 findings 2-6 all still stand, re-measured on 282a84f.
+
+FINDING 1 of 7
+WHAT FAILED: The brief for this slice AGAIN says "H1 - NO CRITERION TEXT FOUND" and "H2 - NO
+CRITERION TEXT FOUND" and tells the seat to treat the Scope one-liner as authority. That is wrong
+for the second cycle running: H1 and H2 are in
+AGJ_Upgrade/command-center-2026-08-26/og-requirements.md lines 102-106. The Scope one-liner drops
+"on the top row", "(with a pending-hint dot/count)", "not a second row" and "can tuck to `...`",
+which is exactly the set of clauses still failing.
+THE FIX: Regenerate the F4 brief with H1/H2 resolved from og-requirements.md:102-106; until then
+read those five lines directly. H1 = "The Terminal chat header matches the mockup: independent
+collapse/expand for the agent tabs and for the reminders/util row, defaulting to tabs collapsed,
+reminders expanded." H2 = "Collapsing the reminders/util row leaves a single clickable bell icon on
+the top row (with a pending-hint dot/count), not a second row; the gear/ME/font controls are compact
+and can tuck to `...`, so that when everything is collapsed the header is one row."
+WHY THE LAST ATTEMPT MISSED IT: a2 worked only from the a1 prescription's tail findings and never
+saw the criterion text.
+
+FINDING 2 of 7
+WHAT FAILED: H2's core geometric clause. Fully collapsed, the header is still TWO rows. Measured on
+282a84f in validation/F4-dom-aria-v2.json, step "fully-collapsed": `[data-term-topbar]` rect =
+{y:6, height:85} holding band1 y=12..46 [terminal-back-list, terminal-topbar-target] and band2
+y=56..84 [tabs-collapse, controls-collapse, bell-indicator]. The bell sits on the SECOND row, which
+H2 forbids by name. A genuine one-row header in this same app measures height 46 (list view, same
+JSON, step "list"). Default state is height 131 = three bands. See F4-header-v2-fully-collapsed.png.
+THE FIX: Delete the row-forcing wrapper. In src/web/public/style.css remove
+`.terminal-topbar-main:has(.command-center-header){flex-wrap:wrap}` and the `flex:1 0 100%` in
+`.command-center-header` — that declaration is what puts the chrome on its own row, and
+`.command-center-header:has(.command-center-bell){flex:0 0 auto}` does not undo it (measured y=56
+with that rule active). Then port the mockup's row split from
+mockups/final/agent-window-v2.html:655-700: row 1 (`.terminal-topbar-main`) carries
+[back][.terminal-topbar-target][tabs area][bell icon][control cluster] as `flex:0 0 auto` siblings,
+and the reminders/util CHIP row is a SEPARATE second element (`.cc-utilarea`, css line 300) that is
+`display:none` when collapsed. The chips are the row that disappears; the tabs toggle, the bell and
+the control cluster live on row 1 in every state.
+WHY THE LAST ATTEMPT MISSED IT: a2 did not touch style.css or the header markup at all.
+
+FINDING 3 of 7
+WHAT FAILED: H2's "(with a pending-hint dot/count)". `[data-testid="bell-indicator"]`
+(src/web/public/app.js:3038-3040) is a bare emoji text node. Measured collapsed header innerText on
+282a84f: "Tabs ▼ (5) | Controls ▼ | \u{1F514}" — no dot, no count, with 1 active reminder (rem-1) and 1
+pending wakeup (wake-1) routed. Nothing in e2e/command-center-header.spec.ts asserts a hint.
+THE FIX: Port the mockup's two hint children into the bell button and gate them by class, as
+mockups/final/agent-window-v2.html:685-689 + css:315-330 — a `.cc-util-icon-dot` span shown only
+when the button carries `has-reminder` (`agentReminders.length > 0`), and a `.cc-util-icon-count`
+span whose text is `wakeups.length`, shown only when the button carries `has-wakeup`. Assert with
+LITERAL fixture values: route 1 reminder + 1 wakeup and assert the dot is visible and the count
+element has text "1"; route `{reminders:[]}` and `{wakeups:[]}` and assert both hidden.
+WHY THE LAST ATTEMPT MISSED IT: a2 did not touch the bell.
+
+FINDING 4 of 7
+WHAT FAILED: H2's "the gear/ME/font controls ... can tuck to `...`". The handle still reads
+"Controls ▲/▼" and the tuck UNMOUNTS its contents: measured fully-collapsed visible counts on
+282a84f are terminalMenu 0, summariesToggle 0, terminalFontDecrease 0, terminalMynav 0, with no
+overflow entry — terminal settings are unreachable until the user un-tucks.
+THE FIX: Follow the mockup's control cluster (agent-window-v2.html:692-700, css:205-218,
+js:1262-1263): one `.cc-ctrl-toggle` handle whose textContent is `'...'` when tucked and `'‹'` when
+expanded, sized 28x28 when tucked; hide the items with
+`.cc-ctrlcluster.collapsed .cc-ctrl-items{display:none}` rather than unmounting them; reveal the
+handle only when util is collapsed or already tucked
+(`.terminal-shell-header.util-collapsed .cc-ctrl-toggle, .cc-ctrlcluster.collapsed .cc-ctrl-toggle
+{display:flex}`). Keep `data-testid="controls-collapse"` on that handle.
+WHY THE LAST ATTEMPT MISSED IT: a2 did not touch the control cluster.
+
+FINDING 5 of 7
+WHAT FAILED: The spec's one-row geometry check is vacuous — RE-PROVEN on this commit. Mutation M4
+(validation/F4-mutation-v2.log) appended `flex-wrap:wrap; max-width:56px` to
+`.command-center-header:has(.command-center-bell)`, forcing the fully-collapsed chrome onto multiple
+rows, and `npx playwright test e2e/command-center-header.spec.ts --project=cc` still exited 0.
+Cause: the assertion compares each child against `geometry.top`/`geometry.bottom`, both read from
+the same topbar under test, so the bound grows with the defect — the D-082 pattern. (The literal
+390/391 horizontal bound DOES discriminate; that half is fine.)
+THE FIX: Assert ROW COUNT from the child rects instead of containment. After fully collapsing, group
+the visible leaf descendants of `[data-term-topbar]` into bands by `Math.round(rect.top)` with a 4px
+tolerance and assert `bands.length === 1`; additionally assert `topbarRect.height <= 48`, a literal
+taken from the list-view header (measured 46), not from the element under test. Both numbers are
+literals, so the test fails on today's build (2 bands / height 85) and on M4.
+WHY THE LAST ATTEMPT MISSED IT: a2 did not touch the spec.
+
+FINDING 6 of 7
+WHAT FAILED: The controls-tuck assertions are vacuous — RE-PROVEN. Mutation M5
+(validation/F4-mutation-v2.log) replaced `${!controlsTucked ? html\`` with `${false ? html\`` so the
+font pill / ME nav / summaries / gear NEVER render in any state, and the focused test still exited 0.
+Cause: `await expect(page.locator('[data-testid="terminal-font-decrease"]')).toBeHidden()` passes for
+an element that does not exist, and the spec never asserts those controls are VISIBLE before it
+clicks `controls-collapse`.
+THE FIX: Bracket every tuck assertion with its positive twin. Before clicking `controls-collapse`,
+assert `terminal-font-decrease`, `terminal-mynav`, `summaries-toggle` and `terminal-menu` are each
+`toBeVisible()`; after the click assert the `...` handle from finding 4 is visible while the items
+are hidden; click it again and assert they are visible once more. The visible-before assertion is
+what M5 breaks.
+WHY THE LAST ATTEMPT MISSED IT: a2 did not touch the spec.
+
+FINDING 7 of 7
+WHAT FAILED: NEW this cycle — a2's own fix has no test, so it will silently revert. Mutation M7
+reverted `}, [menuOpen]);` to `}, []);` (app.js:2409) and mutation M8 reverted
+`}, [summariesOpen, activeTarget]);` to `}, [activeTarget]);` (app.js:2459); BOTH left
+`npx playwright test e2e/command-center-header.spec.ts --project=cc` at exit 0
+(validation/F4-mutation-v2.log).
+THE FIX: Add a request-counting assertion to e2e/command-center-header.spec.ts, using the mechanism
+already demonstrated in validation/F4-menu-probe-v2.mjs — register `page.on('request', ...)` into an
+array, then (a) count URLs matching `/\/api\/summary-agents\/.*\/summaries/`, click
+`[data-testid="summaries-toggle"]`, wait for the panel, and assert the count strictly increased;
+(b) count URLs matching `/\/api\/agent-reminders\/active/`, click `[data-testid="terminal-menu"]`,
+assert its `aria-expanded` is "true", and assert that count strictly increased. Do the gear click
+with nothing else open — an open summaries dropdown intercepts it, which is what produced a false
+negative in this cycle's combined probe.
+WHY THE LAST ATTEMPT MISSED IT: The a1 prescription named the dependency-array fix but not a test
+for it, and the slice's focused command does not observe network traffic at all.
+```
+**Do this before inventing anything.** A slice spent four attempts each inventing a different mechanism while this file sat unread, and closed on the first attempt that had it. If the prescription is WRONG, say why in your callback — that is a finding worth more than a fifth invention.
+
+Address EVERY finding in the prescription — if it lists FINDING 1 of 3, all three land in this one attempt. Leaving one for later does not defer it, it re-spends a whole cycle rediscovering it. If it says the real path is *untested/mocked/no-op*, you MUST write tests that drive the **ACTUAL** overmind code (the real watcher/completion/ingestion path) end-to-end — **do NOT mock, stub, or no-op the thing under test**; a test that asserts a mock is exactly the FAIL. Fix ALL of the listed findings and NOTHING beyond them — 'do not widen scope' means do not go past the prescription, never 'fix only the first item in it'. Re-run the focused tests, then re-commit atomically **with the slice id in the commit SUBJECT** — `feat(F4): <summary>` or `[F4] <summary>`. An untagged subject is read as a foreign commit and this slice parks again, exactly as it would on attempt 1. Then emit:
+- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
+- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
+- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
+  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
+- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
+- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.
+`[projcore callback] implementer F4 STATUS: DONE — commit <new sha> <one line: what changed, max 100 chars>`
+
+---
+
+## THE SLICE (unchanged since attempt 1 — this is not the correction)
+
+### Scope
+Web UI layer: port mockup collapse chrome only (`TerminalHeaderV2` independent tabs/util/control collapse, default tabs-collapsed + utilities-expanded, single-row bell when fully collapsed). Chip content lands in C5/D6/E4. North 2026-08-28 PLAN_SOUND: carry validation/F4-fix-a3.md (htm children array, bell-only collapsed util, CSS port, row click, visibility assert).
+
+### Acceptance criteria — the TEXT is the contract, the id is only its name
+- **H1** — The Terminal chat header matches the mockup: independent collapse/expand for the agent tabs and for the reminders/util row, defaulting to tabs collapsed, reminders expanded.
+- **H2** — Collapsing the reminders/util row leaves a single clickable bell icon on the top row (with a pending-hint dot/count), not a second row; the gear/ME/font controls are compact and can tuck to `...`, so that when everything is collapsed the header is one row.
+
+**If a criterion above does not describe the work in Scope, SAY SO instead of implementing toward it** — that is a PLAN_DEFECT, and it is worth more than another attempt spent satisfying the wrong thing. **If a criterion states an OUTCOME but not a MECHANISM, name the mechanism you chose in your callback.** A correction that re-invents the mechanism is how a slice reaches attempt 6: four attempts inventing, then one with the prescription in hand.
+
+### Focused tests
+`npx playwright test e2e/command-center-header.spec.ts --project=cc`
diff --git a/e2e/command-center-header.spec.ts b/e2e/command-center-header.spec.ts
index ce66cc6..7c4de2e 100644
--- a/e2e/command-center-header.spec.ts
+++ b/e2e/command-center-header.spec.ts
@@ -70,6 +70,10 @@ test('command-center header collapse chrome renders', async ({ page }) => {
   await page.waitForSelector('[data-testid="terminal-header-v2"]', { state: 'visible' });
   expect(pageErrors).toEqual([]);
 
+  const requests: string[] = [];
+  page.on('request', req => requests.push(req.url()));
+  const countRequests = (pattern: RegExp) => requests.filter(u => pattern.test(u)).length;
+
   const tabsCollapse = page.locator('[data-testid="tabs-collapse"]');
   await expect(tabsCollapse).toBeVisible();
   // Tabs collapsed by default
@@ -100,6 +104,21 @@ test('command-center header collapse chrome renders', async ({ page }) => {
   await expect(page.locator('[data-testid="bell-indicator"]')).toBeHidden();
   await expect(page.locator('[data-testid="reminder-chip"]')).toContainText('rem-1');
 
+  // Request counting for summaries and reminders
+  const summariesBefore = countRequests(/\/api\/summary-agents\/.*\/summaries/);
+  await page.locator('[data-testid="summaries-toggle"]').click();
+  await page.waitForSelector('[data-testid="agent-summaries-dropdown"]', { state: 'visible' });
+  await page.waitForTimeout(200);
+  const summariesAfter = countRequests(/\/api\/summary-agents\/.*\/summaries/);
+  expect(summariesAfter).toBeGreaterThan(summariesBefore);
+
+  const remindersBefore = countRequests(/\/api\/agent-reminders\/active/);
+  await page.locator('[data-testid="terminal-menu"]').click();
+  await expect(page.locator('[data-testid="terminal-menu"]')).toHaveAttribute('aria-expanded', 'true');
+  await page.waitForTimeout(200);
+  const remindersAfter = coun
... TRUNCATED at 20000 chars. This is a display bound, NOT the scope of your review — read the rest with `git show bb82a579400cc546ab44f26f24f78278197bdfa0` before judging.
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

# THE SLICE — F4 (run command-center-2026-08-26)

## Scope (do ONLY this)
Web UI layer: port mockup collapse chrome only (`TerminalHeaderV2` independent tabs/util/control collapse, default tabs-collapsed + utilities-expanded, single-row bell when fully collapsed). Chip content lands in C5/D6/E4. North 2026-08-28 PLAN_SOUND: carry validation/F4-fix-a3.md (htm children array, bell-only collapsed util, CSS port, row click, visibility assert).

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **H1** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **H2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`npx playwright test e2e/command-center-header.spec.ts --project=cc`

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=F4 attempt=1 role=validator
  marker=DRV-F4-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY — verifier≠fixer, write NO product code)
Validate F4 independently against its ACs; run the focused tests. ALSO perform a standard-tier RED-TEAM adversarial pass over the diff (distinct lenses); PASS only if it survives. Verify each evidence file EXISTS on disk before PASS. Then append to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] validator F4 STATUS: DONE — <PASS|FAIL> <one line: what changed, max 100 chars>`
then on the NEXT line (plain shell append, NOT emit-status):

## ON A FAIL, WRITE THE PRESCRIPTION (MANDATORY)
Write **`/home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/validation/F4-fix-a3.md`** (absolute — do NOT resolve it against your cwd) before your callback.
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
`[VERDICT-V1] run=command-center-2026-08-26 batch=F4 attempt=3 marker=DRV-F4-21 verdict=<PASS|FAIL> req=<ids> defect_class=<none on a PASS. On a FAIL pick ONE: TEST_NOT_DISCRIMINATING | IMPL_INCOMPLETE | INTERCEPTION_GAP | ALIAS_BYPASS | PLAN_DEFECT | REQUIREMENTS_STRATEGY_DEFECT — or a SHORT_UPPER_SNAKE name of your own if none fit. **Never emit the literal word CLASS**: it is a placeholder, not a value> failed_gate=<none on a PASS; on a FAIL, the ONE gate id that failed — NOT a list of gates you ran> commit=<HEAD sha> redteam=standard-clean evidence=<path:sha256,...>`
## ⚠ EVIDENCE HASHES — GENERATE, NEVER HAND-TYPE (mandatory)
A hand-typed 64-char sha256 gets garbled and fails the gate. Build the `evidence=` value with a SHELL command and paste its EXACT output, e.g.:
`sha256sum <file1> <file2> ... | awk '{print $2":"$1}' | paste -sd,`
Paths are relative to the REPO ROOT for code (`tests/...`, `src/...`) or run-dir-relative for validation artifacts (`plan/.../validation/...`). Do NOT type any hash by hand. For a user-visible req, evidence MUST include a screenshot + a DOM/aria file under `validation/`.
