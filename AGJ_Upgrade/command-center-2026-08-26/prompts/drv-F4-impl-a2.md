# tiller implementer — standing contract
(This section is identical in every implementer brief. Your specific work is in THE SLICE below.)
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.

You are the IMPLEMENTER. You write product code and tests, then commit.

---

# [driver] F4 CORRECTION (attempt 2) — fix EVERY finding the validator listed


## ⚠ STANDING DIRECTION FROM THE COORDINATOR — applies to THIS attempt too

[north] PLAN_SOUND H1/H2. Carry validation/F4-fix-a3.md at sol after L1. Cherry-pick 4d32468. Fix: (1) header htm children valid array, no i.push; (2) collapsed utilities = bell-only; (3) port header-v2 CSS one-row; (4) click actual session row not parent; (5) collapsed tabs = visibility not DOM count. Playwright 180s. Callback immediately after commit. Budget 8. Split F4a/F4b only if this still fails.

**This is a constraint, not background.** It was written after a previous attempt and it still binds: if it forbids something, the fix that does it is wrong even when the tests go green.
The independent validator FAILed F4: defect_class=IMPL_INCOMPLETE gate=None.
**Validator's callback summary:** [projcore callback] validator F4 STATUS: DONE — FAIL H2: collapsed bell sits on row 2, no hint dot/count, no ⋯ tuck

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
# F4 prescription — validator cycle attempt=1, marker DRV-F4-21, commit c3f81e7
(The previous cycle's a1 prescription was preserved as validation/F4-fix-a1.prev-cycle.md.)
Read this WITH validation/F4-redteam-v1.md — every claim below is backed by a measurement in it.

FINDING 1 of 8
WHAT FAILED: The brief for this slice says "H1 - NO CRITERION TEXT FOUND" and "H2 - NO CRITERION
TEXT FOUND" and tells the seat to treat the Scope one-liner as authority. That is wrong: H1 and H2
are present in AGJ_Upgrade/command-center-2026-08-26/og-requirements.md lines 102-106. The Scope
one-liner is a lossy summary of H2 - it omits "on the top row", "(with a pending-hint dot/count)",
"not a second row", and "can tuck to `...`". Building to the summary is what produced findings 2-4.
THE FIX: Regenerate the F4 brief with H1/H2 resolved from og-requirements.md:102-106, and until then
read those five lines directly. H1 = "The Terminal chat header matches the mockup: independent
collapse/expand for the agent tabs and for the reminders/util row, defaulting to tabs collapsed,
reminders expanded." H2 = "Collapsing the reminders/util row leaves a single clickable bell icon on
the top row (with a pending-hint dot/count), not a second row; the gear/ME/font controls are compact
and can tuck to `...`, so that when everything is collapsed the header is one row."
WHY THE LAST ATTEMPT MISSED IT: The brief told it the criteria did not exist, so it built to Scope.

FINDING 2 of 8
WHAT FAILED: H2's core geometric clause. Fully collapsed (tabs collapsed + utilities collapsed +
controls tucked) the header is TWO rows, not one. Measured in validation/F4-dom-aria-v1.json, step
"fully-collapsed": `[data-term-topbar]` rect = {y:6, height:85}, holding band1 y=12..46
[terminal-back-list, terminal-topbar-target] and band2 y=56..84 [tabs-collapse, controls-collapse,
bell-indicator]. The bell is on the SECOND row - the exact thing H2 forbids. A real one-row header
in this same app measures height 46 (list view, same file, step "list"). Default state is height 131
(three bands). Visible in validation/F4-header-v1-fully-collapsed.png.
THE FIX: Delete the row-forcing wrapper. In src/web/public/style.css remove
`.terminal-topbar-main:has(.command-center-header){flex-wrap:wrap}` and
`.command-center-header{...flex:1 0 100%...}` - `flex:1 0 100%` is what puts the chrome on its own
row, and `.command-center-header:has(.command-center-bell){flex:0 0 auto}` does not undo it
(measured y=56 with that rule in effect). Then port the mockup's row split from
mockups/final/agent-window-v2.html:655-700: row 1 (`.terminal-topbar-main`) carries
[back][.terminal-topbar-target][tabs area][bell icon][control cluster] as flex:0 0 auto siblings,
and the reminders/util CHIP row is a SECOND element (`.cc-utilarea`, css line 300) that is
`display:none` when collapsed. That is, the chips are the second row that disappears; the bell,
the tabs toggle and the control cluster live on row 1 always.
WHY THE LAST ATTEMPT MISSED IT: It invented a `.command-center-header` wrapper holding both the
toggles and the chips, then gave that wrapper `flex:1 0 100%`, which guarantees a second row in
every state - and its own geometry assertion could not detect that (finding 5).

FINDING 3 of 8
WHAT FAILED: H2's "(with a pending-hint dot/count)". `[data-testid="bell-indicator"]` renders as a
bare emoji text node (src/web/public/app.js:3038-3040) with no dot and no count, even though the
probe fixtures supplied 1 active reminder (rem-1) and 1 pending wakeup (wake-1). Nothing in
e2e/command-center-header.spec.ts asserts a hint at all.
THE FIX: Port the mockup's two hint children into the bell button and gate them by class, exactly as
mockups/final/agent-window-v2.html:685-689 + css:315-330 - a `.cc-util-icon-dot` span shown only when
the button carries `has-reminder` (i.e. `agentReminders.length > 0`), and a `.cc-util-icon-count`
span carrying `wakeups.length` shown only when the button carries `has-wakeup`. Assert it with
LITERAL fixture values: with 1 reminder + 1 pending wakeup routed, the dot is visible and the count
element has text "1"; with `{reminders:[]}` and `{wakeups:[]}` routed, both are hidden.
WHY THE LAST ATTEMPT MISSED IT: The Scope one-liner said "single-row bell"; only H2 says the bell
carries a hint, and the brief said H2 had no text.

FINDING 4 of 8
WHAT FAILED: H2's "the gear/ME/font controls ... can tuck to `...`". The port tucks them behind a
text button reading "Controls ▲/▼", and when tucked the gear and the summaries button are removed
from the DOM with no overflow entry - measured in F4-dom-aria-v1.json step "fully-collapsed":
terminalMenu visible 0, summariesToggle visible 0, i.e. terminal settings become unreachable without
first un-tucking.
THE FIX: Follow the mockup's control cluster (agent-window-v2.html:692-700, css:205-218 and js:1262-1263):
one `.cc-ctrl-toggle` handle whose textContent is `'...'` when tucked and `'‹'` when expanded, sized
28x28 when tucked; `.cc-ctrlcluster.collapsed .cc-ctrl-items{display:none}` hides the items rather
than unmounting them; and the handle is revealed only when `util-collapsed` or already tucked
(`.terminal-shell-header.util-collapsed .cc-ctrl-toggle, .cc-ctrlcluster.collapsed .cc-ctrl-toggle
{display:flex}`). Keep `data-testid="controls-collapse"` on that handle.
WHY THE LAST ATTEMPT MISSED IT: It read "control collapse" from Scope and chose unmounting; the `...`
affordance is only named in H2 and in the mockup.

FINDING 5 of 8
WHAT FAILED: The spec's one-row geometry check is vacuous - PROVEN, not suspected. Mutation M4
(validation/F4-mutation-v1.log) appended `flex-wrap:wrap; max-width:56px` to
`.command-center-header:has(.command-center-bell)`, which forces the fully-collapsed chrome onto
multiple rows, and `npx playwright test e2e/command-center-header.spec.ts --project=cc` still exited
0. Cause: the assertion compares each child against `geometry.top`/`geometry.bottom`, which are read
from the same topbar under test, so the bound expands with the defect - the D-082 pattern. (The
horizontal 390/391 literal DOES discriminate: mutation M6, padding 7px -> 90px, exit 1.)
THE FIX: Assert ROW COUNT from the child rects instead of containment. In
e2e/command-center-header.spec.ts, after fully collapsing, group the visible leaf descendants of
`[data-term-topbar]` into bands by `Math.round(rect.top)` within a 4px tolerance and assert
`bands.length === 1`; additionally assert `topbarRect.height <= 48`, a literal taken from the
list-view header (measured 46), not from the element under test. Both numbers are literals, and the
test then fails on today's build (measured 2 bands / height 85) and on M4.
WHY THE LAST ATTEMPT MISSED IT: It asked the topbar what to expect, and the topbar grows to fit
whatever it is given.

FINDING 6 of 8
WHAT FAILED: The controls-tuck assertions are vacuous - PROVEN. Mutation M5
(validation/F4-mutation-v1.log) replaced `${!controlsTucked ? html\`` with `${false ? html\`` so the
font pill / ME nav / summaries / gear NEVER render in any state, and the focused test still exited 0.
Cause: `await expect(page.locator('[data-testid="terminal-font-decrease"]')).toBeHidden()` passes for
an element that does not exist, and the spec never asserts those controls are VISIBLE before it
clicks `controls-collapse`.
THE FIX: Bracket every tuck assertion with its positive twin. Before clicking `controls-collapse`,
assert `terminal-font-decrease`, `terminal-mynav`, `summaries-toggle` and `terminal-menu` are each
`toBeVisible()`; after the click assert the `...` handle from finding 4 is visible and the items are
hidden; then click it again and assert they are visible once more. The visible-before assertion is
what M5 breaks.
WHY THE LAST ATTEMPT MISSED IT: One-sided hidden-after assertions cannot tell "tucked" from "absent".

FINDING 7 of 8
WHAT FAILED: A freshness regression in an existing feature, outside this slice's scope. Opening the
summaries dropdown no longer refetches summaries. Measured with the same probe against both commits:
parent c3f81e7^ -> summariesFreshness {beforeOpen:0, afterOpen:1, refetchedOnOpen:true};
HEAD c3f81e7 -> {beforeOpen:1, afterOpen:1, refetchedOnOpen:false}. Cause: src/web/public/app.js:2439-2458
dropped `if (!summariesOpen) return;` AND dropped `summariesOpen` from the dependency array, so the
panel now shows whatever was fetched when the pane was selected.
THE FIX: Keep the guard deleted (the chip needs data on mount) but PUT THE DEPENDENCY BACK:
`}, [summariesOpen, activeTarget]);`. That fetches on target select for the chip and again on every
open for the panel. Cover it with the probe's own mechanism: count requests matching
`/api/summary-agents/.*/summaries`, click `summaries-toggle`, and assert the count increased.
WHY THE LAST ATTEMPT MISSED IT: Removing the guard and removing the dep look like one edit; only the
guard needed to go.

FINDING 8 of 8
WHAT FAILED: Same class, second site. src/web/public/app.js:2398-2408 changed the reminders/wakeups
effect deps from `[menuOpen]` to `[]`, so the settings menu no longer refreshes the active-reminder
list when it is opened; it is fetched exactly once per mount. `handleSaveReminder` refetches after a
save, and there is no UI delete path, so the visible symptom is a stale active-reminder list in a
long-lived session and a stale wakeup chip (the 30s poller at app.js:2411-2423 is still gated on
`menuOpen`).
THE FIX: `}, [menuOpen]);` on that effect - the guard stays deleted so the chips still populate on
mount, and the dep restores the on-open refresh. If the chip is meant to stay live independently,
ungate the 30s poller as well, but that belongs to C5/D6/E4, not F4.
WHY THE LAST ATTEMPT MISSED IT: Same edit shape as finding 7.
```
**Do this before inventing anything.** A slice spent four attempts each inventing a different mechanism while this file sat unread, and closed on the first attempt that had it. If the prescription is WRONG, say why in your callback — that is a finding worth more than a fifth invention.

Address EVERY finding in the prescription — if it lists FINDING 1 of 3, all three land in this one attempt. Leaving one for later does not defer it, it re-spends a whole cycle rediscovering it. If it says the real path is *untested/mocked/no-op*, you MUST write tests that drive the **ACTUAL** overmind code (the real watcher/completion/ingestion path) end-to-end — **do NOT mock, stub, or no-op the thing under test**; a test that asserts a mock is exactly the FAIL. Fix ALL of the listed findings and NOTHING beyond them — 'do not widen scope' means do not go past the prescription, never 'fix only the first item in it'. Re-run the focused tests, then re-commit atomically **with the slice id in the commit SUBJECT** — `feat(F4): <summary>` or `[F4] <summary>`. An untagged subject is read as a foreign commit and this slice parks again, exactly as it would on attempt 1. Then emit:
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.
`[projcore callback] implementer F4 STATUS: DONE — commit <new sha> <one line: what changed, max 100 chars>`

---

## THE SLICE (unchanged since attempt 1 — this is not the correction)

### Scope
Web UI layer: port mockup collapse chrome only (`TerminalHeaderV2` independent tabs/util/control collapse, default tabs-collapsed + utilities-expanded, single-row bell when fully collapsed). Chip content lands in C5/D6/E4. North 2026-08-28 PLAN_SOUND: carry validation/F4-fix-a3.md (htm children array, bell-only collapsed util, CSS port, row click, visibility assert).

### Acceptance criteria — the TEXT is the contract, the id is only its name
- **H1** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **H2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO instead of implementing toward it** — that is a PLAN_DEFECT, and it is worth more than another attempt spent satisfying the wrong thing. **If a criterion states an OUTCOME but not a MECHANISM, name the mechanism you chose in your callback.** A correction that re-invents the mechanism is how a slice reaches attempt 6: four attempts inventing, then one with the prescription in hand.

### Focused tests
`npx playwright test e2e/command-center-header.spec.ts --project=cc`
