# F4 red-team — validator attempt=2 (marker DRV-F4-21)
commit under test: 282a84f87e3aa4ca0e21348858f21b0726d2c988 ("[F4] fix summaries and reminders effect deps")
parent: c3f81e7 (the a1 subject). Diff = 2 lines, both dependency arrays in src/web/public/app.js.
verdict: FAIL   defect_class: IMPL_INCOMPLETE   failed_gate: H2

## What a2 changed, and what it did NOT
`git diff 282a84f^..282a84f` touches ONLY app.js:2409 and app.js:2459 - the two dependency
arrays named in a1 findings 7 and 8. e2e/command-center-header.spec.ts and src/web/public/style.css
are BYTE-IDENTICAL to the a1 subject (sha256 1378ba60...c22ce4 and aa67a3f6...aa2af7 both
re-measured this cycle). So a1 findings 2, 3, 4, 5 and 6 could not have been addressed, and were
re-measured rather than assumed.

## Lens 0 — criterion resolution (UNCHANGED brief defect)
The a2 brief again says "H1 - NO CRITERION TEXT FOUND" and "H2 - NO CRITERION TEXT FOUND".
Both are in og-requirements.md lines 102-106. This is the second brief in a row to hide them, and
it is the reason the header keeps being built to the lossy Scope one-liner. Raised again as
finding 1.

## Lens 1 — focused test, as written by the row
`npx playwright test e2e/command-center-header.spec.ts --project=cc` -> 1 passed (exit 0).
validation/F4-focused-v2.log. Green, and (per Lens 4) green for the wrong reasons.

## Lens 2 — a1 findings 7 and 8: BOTH FIXED, verified
Probe validation/F4-ui-probe-v2.mjs -> F4-dom-aria-v2.json:
  summariesFreshness = {beforeOpen:1, afterOpen:2, refetchedOnOpen:TRUE}
  (a1 measured {1,1,false} on c3f81e7 and {0,1,true} on the pre-F4 parent.) Fixed.
Dedicated probe validation/F4-menu-probe-v2.mjs -> F4-menu-probe-v2.json:
  menuVisibleBeforeClick:true, clickError:null, menuExpanded:"true",
  onMount {reminders:1, wakeups:1} -> afterMenuOpen {reminders:2, wakeups:2}. Fixed.
  NOTE ON A FALSE READING I DISCARDED: the combined v2 probe reported
  remindersFreshness.refetchedOnMenuOpen:false, but it clicked the gear while the summaries
  dropdown overlay was open and the click was swallowed by a `.catch(() => {})`. The isolated
  probe above (nothing else open, click asserted, aria-expanded read back) is the measurement that
  counts. Reported here so the next seat does not chase a defect that is not there.
ACCEPTED TRADE-OFF (not a finding): with the guards deleted and only the deps restored, both
effects now also fire when the menu / dropdown CLOSES - one extra idempotent GET per close. That
is the shape a1 prescribed, it is what makes the chips populate on mount, and it is harmless.

## Lens 3 — product behaviour vs H1/H2, re-measured on this commit
Fixtures: 6 sessions / 1 group, 1 active reminder (rem-1), 1 pending wakeup (wake-1), 1 summary.
Viewport 390x844. pageErrors: [].

H1 (independent collapse; default tabs-collapsed + util-expanded) -> SATISFIED, unchanged.

H2 -> STILL VIOLATED on the same three clauses; every number below is re-measured on 282a84f:
  (a) "bell ... ON THE TOP ROW ... not a second row ... header is ONE ROW when everything is
      collapsed". Step "fully-collapsed": `[data-term-topbar]` = {y:6, height:85} holding two
      bands - y=12..46 [terminal-back-list, terminal-topbar-target] and y=56..84
      [tabs-collapse, controls-collapse, bell-indicator]. The list-view header, a genuine one-row
      header in the same app, measures height 46. Default state = height 131 (three bands).
      See F4-header-v2-fully-collapsed.png: the bell is plainly on row 2.
  (b) "(with a pending-hint dot/count)". Collapsed header innerText is exactly
      "Tabs ▼ (5) | Controls ▼ | \u{1F514}" - no dot, no count, with 1 active reminder and 1 pending
      wakeup in the fixtures.
  (c) "the gear/ME/font controls ... can tuck to `...`". Handle still reads "Controls ▼/▲";
      fully-collapsed visible counts: terminalMenu 0, summariesToggle 0, terminalFontDecrease 0,
      terminalMynav 0 - they are unmounted with no overflow entry, so terminal settings are
      unreachable until the user un-tucks.

## Lens 4 — test discrimination (north D-082), re-proved by mutation on THIS commit
Full logs: validation/F4-mutation-v2.log.
  M4 `.command-center-header:has(.command-center-bell)` += `flex-wrap:wrap; max-width:56px`
     (forces the fully-collapsed chrome onto multiple rows) ......... NOT CAUGHT (exit 0)
  M5 `${!controlsTucked ? html\`` -> `${false ? html\`` (font/ME/summaries/gear NEVER render
     in any state) ................................................. NOT CAUGHT (exit 0)
  M7 revert this commit's own fix: `}, [menuOpen]);` -> `}, []);` ... NOT CAUGHT (exit 0)
  M8 revert this commit's own fix: `}, [summariesOpen, activeTarget]);`
     -> `}, [activeTarget]);` ....................................... NOT CAUGHT (exit 0)
  M4/M5 are the a1 findings 5/6 vacuities, unchanged.
  M7/M8 are NEW: a2 landed a behaviour fix with no test at all. Both lines can be reverted and
  the slice's own focused command stays green, so the regression will come back silently.

## Lens 5 — new-defect sweep on the a2 diff itself
No infinite-render risk: neither effect writes a value that appears in its own dependency array.
No page errors, no console errors. Chips still populate on mount (detail-default shows
reminder/wakeup/summary chips visible 1 each) - restoring the deps did not re-introduce the
lazy-fetch behaviour the chips depend on. The 2-line diff is correct as far as it goes.

## Lens 6 — hygiene
Working tree restored clean after every mutation (`git diff --stat -- src e2e` empty).
No product code written by this validator. Judged 282a84f explicitly, not `git rev-parse HEAD`.
