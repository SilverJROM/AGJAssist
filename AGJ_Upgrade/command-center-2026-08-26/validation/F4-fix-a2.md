# F4 prescription — validator attempt=2, marker DRV-F4-21, commit 282a84f87e3aa4ca0e21348858f21b0726d2c988
Read this WITH validation/F4-redteam-v2.md — every number below is a measurement in it.

## ALREADY DONE — DO NOT REDO
a1 findings 7 and 8 (the effect-dependency freshness regressions) are FIXED and verified:
  summariesFreshness {beforeOpen:1, afterOpen:2, refetchedOnOpen:true}   (F4-dom-aria-v2.json)
  menu open -> reminders 1->2, wakeups 1->2, aria-expanded "true"        (F4-menu-probe-v2.json)
The 2-line diff in 282a84f is correct. What follows is everything it did not touch — this commit
changed ONLY app.js dependency arrays; e2e/command-center-header.spec.ts and style.css are
byte-identical to the a1 subject, so a1 findings 2-6 all still stand, re-measured on 282a84f.

FINDING 1 of 7
WHAT FAILED: The brief for this slice AGAIN says "H1 - NO CRITERION TEXT FOUND" and "H2 - NO
CRITERION TEXT FOUND" and tells the seat to treat the Scope one-liner as authority. That is wrong
for the second cycle running: H1 and H2 are in
AGJ_Upgrade/command-center-2026-08-26/og-requirements.md lines 102-106. The Scope one-liner drops
"on the top row", "(with a pending-hint dot/count)", "not a second row" and "can tuck to `...`",
which is exactly the set of clauses still failing.
THE FIX: Regenerate the F4 brief with H1/H2 resolved from og-requirements.md:102-106; until then
read those five lines directly. H1 = "The Terminal chat header matches the mockup: independent
collapse/expand for the agent tabs and for the reminders/util row, defaulting to tabs collapsed,
reminders expanded." H2 = "Collapsing the reminders/util row leaves a single clickable bell icon on
the top row (with a pending-hint dot/count), not a second row; the gear/ME/font controls are compact
and can tuck to `...`, so that when everything is collapsed the header is one row."
WHY THE LAST ATTEMPT MISSED IT: a2 worked only from the a1 prescription's tail findings and never
saw the criterion text.

FINDING 2 of 7
WHAT FAILED: H2's core geometric clause. Fully collapsed, the header is still TWO rows. Measured on
282a84f in validation/F4-dom-aria-v2.json, step "fully-collapsed": `[data-term-topbar]` rect =
{y:6, height:85} holding band1 y=12..46 [terminal-back-list, terminal-topbar-target] and band2
y=56..84 [tabs-collapse, controls-collapse, bell-indicator]. The bell sits on the SECOND row, which
H2 forbids by name. A genuine one-row header in this same app measures height 46 (list view, same
JSON, step "list"). Default state is height 131 = three bands. See F4-header-v2-fully-collapsed.png.
THE FIX: Delete the row-forcing wrapper. In src/web/public/style.css remove
`.terminal-topbar-main:has(.command-center-header){flex-wrap:wrap}` and the `flex:1 0 100%` in
`.command-center-header` — that declaration is what puts the chrome on its own row, and
`.command-center-header:has(.command-center-bell){flex:0 0 auto}` does not undo it (measured y=56
with that rule active). Then port the mockup's row split from
mockups/final/agent-window-v2.html:655-700: row 1 (`.terminal-topbar-main`) carries
[back][.terminal-topbar-target][tabs area][bell icon][control cluster] as `flex:0 0 auto` siblings,
and the reminders/util CHIP row is a SEPARATE second element (`.cc-utilarea`, css line 300) that is
`display:none` when collapsed. The chips are the row that disappears; the tabs toggle, the bell and
the control cluster live on row 1 in every state.
WHY THE LAST ATTEMPT MISSED IT: a2 did not touch style.css or the header markup at all.

FINDING 3 of 7
WHAT FAILED: H2's "(with a pending-hint dot/count)". `[data-testid="bell-indicator"]`
(src/web/public/app.js:3038-3040) is a bare emoji text node. Measured collapsed header innerText on
282a84f: "Tabs ▼ (5) | Controls ▼ | \u{1F514}" — no dot, no count, with 1 active reminder (rem-1) and 1
pending wakeup (wake-1) routed. Nothing in e2e/command-center-header.spec.ts asserts a hint.
THE FIX: Port the mockup's two hint children into the bell button and gate them by class, as
mockups/final/agent-window-v2.html:685-689 + css:315-330 — a `.cc-util-icon-dot` span shown only
when the button carries `has-reminder` (`agentReminders.length > 0`), and a `.cc-util-icon-count`
span whose text is `wakeups.length`, shown only when the button carries `has-wakeup`. Assert with
LITERAL fixture values: route 1 reminder + 1 wakeup and assert the dot is visible and the count
element has text "1"; route `{reminders:[]}` and `{wakeups:[]}` and assert both hidden.
WHY THE LAST ATTEMPT MISSED IT: a2 did not touch the bell.

FINDING 4 of 7
WHAT FAILED: H2's "the gear/ME/font controls ... can tuck to `...`". The handle still reads
"Controls ▲/▼" and the tuck UNMOUNTS its contents: measured fully-collapsed visible counts on
282a84f are terminalMenu 0, summariesToggle 0, terminalFontDecrease 0, terminalMynav 0, with no
overflow entry — terminal settings are unreachable until the user un-tucks.
THE FIX: Follow the mockup's control cluster (agent-window-v2.html:692-700, css:205-218,
js:1262-1263): one `.cc-ctrl-toggle` handle whose textContent is `'...'` when tucked and `'‹'` when
expanded, sized 28x28 when tucked; hide the items with
`.cc-ctrlcluster.collapsed .cc-ctrl-items{display:none}` rather than unmounting them; reveal the
handle only when util is collapsed or already tucked
(`.terminal-shell-header.util-collapsed .cc-ctrl-toggle, .cc-ctrlcluster.collapsed .cc-ctrl-toggle
{display:flex}`). Keep `data-testid="controls-collapse"` on that handle.
WHY THE LAST ATTEMPT MISSED IT: a2 did not touch the control cluster.

FINDING 5 of 7
WHAT FAILED: The spec's one-row geometry check is vacuous — RE-PROVEN on this commit. Mutation M4
(validation/F4-mutation-v2.log) appended `flex-wrap:wrap; max-width:56px` to
`.command-center-header:has(.command-center-bell)`, forcing the fully-collapsed chrome onto multiple
rows, and `npx playwright test e2e/command-center-header.spec.ts --project=cc` still exited 0.
Cause: the assertion compares each child against `geometry.top`/`geometry.bottom`, both read from
the same topbar under test, so the bound grows with the defect — the D-082 pattern. (The literal
390/391 horizontal bound DOES discriminate; that half is fine.)
THE FIX: Assert ROW COUNT from the child rects instead of containment. After fully collapsing, group
the visible leaf descendants of `[data-term-topbar]` into bands by `Math.round(rect.top)` with a 4px
tolerance and assert `bands.length === 1`; additionally assert `topbarRect.height <= 48`, a literal
taken from the list-view header (measured 46), not from the element under test. Both numbers are
literals, so the test fails on today's build (2 bands / height 85) and on M4.
WHY THE LAST ATTEMPT MISSED IT: a2 did not touch the spec.

FINDING 6 of 7
WHAT FAILED: The controls-tuck assertions are vacuous — RE-PROVEN. Mutation M5
(validation/F4-mutation-v2.log) replaced `${!controlsTucked ? html\`` with `${false ? html\`` so the
font pill / ME nav / summaries / gear NEVER render in any state, and the focused test still exited 0.
Cause: `await expect(page.locator('[data-testid="terminal-font-decrease"]')).toBeHidden()` passes for
an element that does not exist, and the spec never asserts those controls are VISIBLE before it
clicks `controls-collapse`.
THE FIX: Bracket every tuck assertion with its positive twin. Before clicking `controls-collapse`,
assert `terminal-font-decrease`, `terminal-mynav`, `summaries-toggle` and `terminal-menu` are each
`toBeVisible()`; after the click assert the `...` handle from finding 4 is visible while the items
are hidden; click it again and assert they are visible once more. The visible-before assertion is
what M5 breaks.
WHY THE LAST ATTEMPT MISSED IT: a2 did not touch the spec.

FINDING 7 of 7
WHAT FAILED: NEW this cycle — a2's own fix has no test, so it will silently revert. Mutation M7
reverted `}, [menuOpen]);` to `}, []);` (app.js:2409) and mutation M8 reverted
`}, [summariesOpen, activeTarget]);` to `}, [activeTarget]);` (app.js:2459); BOTH left
`npx playwright test e2e/command-center-header.spec.ts --project=cc` at exit 0
(validation/F4-mutation-v2.log).
THE FIX: Add a request-counting assertion to e2e/command-center-header.spec.ts, using the mechanism
already demonstrated in validation/F4-menu-probe-v2.mjs — register `page.on('request', ...)` into an
array, then (a) count URLs matching `/\/api\/summary-agents\/.*\/summaries/`, click
`[data-testid="summaries-toggle"]`, wait for the panel, and assert the count strictly increased;
(b) count URLs matching `/\/api\/agent-reminders\/active/`, click `[data-testid="terminal-menu"]`,
assert its `aria-expanded` is "true", and assert that count strictly increased. Do the gear click
with nothing else open — an open summaries dropdown intercepts it, which is what produced a false
negative in this cycle's combined probe.
WHY THE LAST ATTEMPT MISSED IT: The a1 prescription named the dependency-array fix but not a test
for it, and the slice's focused command does not observe network traffic at all.
