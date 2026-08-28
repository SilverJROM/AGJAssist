# F4 red-team — validator attempt=4 (marker DRV-F4-21)
commit under test: 23ff1d1b3c304afbaa5315af2719760ac5c0ae30 ("feat(F4): complete one-row header and validator criteria")
preceded in this attempt by 9919e9e ("[F4] Land in-flight header collapse chrome") and
72ec833 ("[F4] Land remaining header.spec.ts dirt from a3 correction").
verdict: PASS   defect_class: none   failed_gate: none   redteam: standard-clean

## Lens 0 — provenance: the tree moved four times before it settled; every number below is post-settle
Recorded with `git hash-object` during this session:
  ~07:18  app 0d932d31 / css 61935e3d / spec ce66cc60  == 282a84f (a2), staged revert, uncommitted
  ~07:22  app 889d9834 / css d89ad87c / spec 7c4de2ef  == bb82a57 (a3), revert undone
  ~07:25  app 6d0a6af7 / css 0fff0079 / spec 118514cf  == uncommitted WIP
  ~07:28  spec f1613b7c                                 == spec edited WHILE a focused run was in flight
  ~07:30  HEAD -> 23ff1d1, working tree CLEAN against it   <-- the state judged below
  ~07:36  spec 3abb0b6a, then 005af475: UNCOMMITTED post-commit edits, still in flight
Interim measurements taken against the earlier states are void and were discarded. Everything in this
report was measured against commit 23ff1d1 while `git status --short src e2e` was empty, with the
three blob hashes verified identical before and after every run.

POST-VALIDATION DRIFT (does not affect the verdict, but the coordinator should know): after 23ff1d1
was validated, e2e/command-center-header.spec.ts was edited again in the working tree, twice, and
those uncommitted edits FAIL (validation/F4-focused-v4-worktree.log). The substantive change swaps
the committed `await page.locator('.terminal-menu-overlay').click({position:{x:8,y:8}})` for a second
click on `[data-testid="terminal-menu"]`, which times out because the open menu's overlay intercepts
the gear as well. The COMMITTED form is the working one. If that line must change, dispatch a
synthetic event on the overlay instead — `await page.locator('.terminal-menu-overlay')
.dispatchEvent('pointerdown')` — since the app closes the menu from a window `pointerdown` listener
and a dispatched event bypasses Playwright's actionability check. The evidence hashes below are
therefore taken from the COMMITTED blobs at 23ff1d1, not from the drifting worktree.

## Lens 1 — the focused command
`timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-header.spec.ts --project=cc`
  -> 1 passed, EXIT=0. Run twice on 23ff1d1, stable. validation/F4-focused-v4.log.

## Lens 2 — H1 against the criterion text (now present in the brief, and matching og-requirements.md:102-106)
"independent collapse/expand for the agent tabs and for the reminders/util row, defaulting to tabs
collapsed, reminders expanded" -> SATISFIED. Measured (validation/F4-dom-aria-v4.json):
  detail-default: agent-group-switcher visible 0, terminal-header-tab visible 0 (tabs collapsed),
  reminder/wakeup/summary chips visible 1 each (reminders expanded).
  after-tabs-expand: exactly 1 switcher, 5 tabs with the literal fixture names, chips still expanded
  -> the two collapses do not interfere.
  after-utilities-collapse: chips hidden, tabs still collapsed independently.

## Lens 3 — H2 against the criterion text
"Collapsing the reminders/util row leaves a single clickable bell icon on the top row (with a
pending-hint dot/count), not a second row; the gear/ME/font controls are compact and can tuck to
`...`, so that when everything is collapsed the header is one row."
  (a) bell on the TOP row, not a second row -> SATISFIED. Fully-collapsed `[data-term-topbar]`
      height = 47.19 (a2 was 85, a3 69/95; the list-view one-row header in this same app is 46).
      The direct flex children of `.terminal-topbar-main` occupy ONE band; the band holds
      terminal-back-list, terminal-topbar-target, terminal-session-name, command-center-header,
      terminal-header-v2, tabs-collapse, bell-indicator, cc-ctrlcluster, controls-collapse.
      Session name width 137 and visible (a3 had 0 — that regression is gone).
      validation/F4-header-v4-fully-collapsed.png shows one row:
      "<- | alpha / t1 - bash - updated | Tabs (5) | bell+badge | ...".
  (b) pending-hint dot/count -> SATISFIED. `.cc-util-icon-dot` visible under `has-reminder`,
      `.cc-util-icon-count` carrying the LITERAL fixture value "1" under `has-wakeup`, with 1 active
      reminder and 1 pending wakeup routed.
  (c) tuck to `...` -> SATISFIED. `.cc-ctrlcluster` / `.cc-ctrl-items` markup now exists (a3 shipped
      this as CSS with no markup); the items are HIDDEN by
      `.cc-ctrlcluster.collapsed .cc-ctrl-items{display:none}` rather than unmounted, and the handle
      renders `...` when tucked / `‹` when expanded, revealed conditionally per the mockup.
  (d) the reminders/util row is now a real second row -- `.cc-utilarea`, a sibling of
      `.terminal-topbar-main` inside `.terminal-shell-header`, hidden by the `util-collapsed` class.
      Default topbar 95 = row 1 (47) + chip row; collapsed 47. That is exactly H2's shape.

## Lens 4 — test discrimination (north D-082): 11 of 11 behavioural mutations CAUGHT
validation/F4-mutation-v4.log. Mutate one product line, re-run the row's command, restore, verify
`git diff --quiet`:
  M1  default tabsCollapsed true->false ............................. CAUGHT
  M2b keep a `utilities-collapse` button in the collapsed branch .... CAUGHT (bell-only holds)
  M4  force the collapsed row to wrap (flex-wrap + flex:1 0 100%) ... CAUGHT  <- vacuous at a1-a3
  M5  `.cc-ctrl-items{display:none}` so controls never show ......... CAUGHT  <- vacuous at a1-a3
  M6  `.command-center-toggle` padding 7px -> 90px (overflow) ....... CAUGHT
  M7  revert `}, [menuOpen]);` -> `}, []);` ........................ CAUGHT  <- vacuous at a2-a3
  M8  revert `}, [summariesOpen, activeTarget]);` -> `}, [activeTarget]);` CAUGHT
  M9  drop the `has-reminder` class from the bell .................. CAUGHT
  M10 bell count `${wakeups.length}` -> `${wakeups.length + 1}` ..... CAUGHT (literal "1" holds)
  M11 tuck label `'...'` -> `'X'` .................................. CAUGHT
  M12 never apply `util-collapsed` to the shell header .............. CAUGHT
  M13 `hidden=${tabsCollapsed}` -> `data-collapsed=${tabsCollapsed}` . CAUGHT
  M14 render the bell unconditionally .............................. CAUGHT
NEGATIVE CONTROL: M2, a deliberately cosmetic mutation (adding an unused `data-testid2` attribute),
was NOT caught — confirming the suite discriminates behaviour rather than failing on any edit.
All three vacuities carried from attempts 1-3 are now closed.

## Lens 5 — the assertions themselves are literal-sourced, not self-derived
`bands` are computed from `.terminal-topbar-main`'s DIRECT children and compared to the literal 1;
`height` to the literal 48; `right`/`left` to the literals 391/-1; the bell count to the literal "1";
the tuck label to the literal '...'; tab names to the five literal fixture strings; request counts to
a strictly-greater comparison across a user action. None reads its expected value from the mechanism
under test. The `geometry.children ?? []` dead loop flagged at a3 is gone — the evaluate now returns
`rects` and the horizontal bound actually runs (proven by M6).
NOTE, not a defect: `height <= 48` against a measured 47.19 is a ~0.8px margin. It is a correct
literal (derived from the 46px list-view header, not from the element under test) but it will trip on
a future font/padding change. Worth widening to 52 the next time this spec is touched.

## Lens 6 — collateral / scope
Diff 282a84f..23ff1d1 touches only e2e/command-center-header.spec.ts, src/web/public/app.js,
src/web/public/style.css. The terminal LIST view is unaffected: topbar height 46, no header chrome
rendered, list body intact (`.cc-utilarea` and `util-collapsed` are both gated on `!isListView`).
pageErrors: []. The a1/a2 dependency-array freshness fixes survive:
summariesFreshness {beforeOpen:1, afterOpen:2, refetchedOnOpen:true}.

## Lens 7 — brief hygiene: RESOLVED
The a4 validator brief now carries the real H1/H2 text, matching og-requirements.md:102-106. The
generator defect raised at attempts 1, 2 and 3 is fixed on both the implementer and validator sides.

## Lens 8 — hygiene
Working tree clean against 23ff1d1 after every mutation. No product code written by this validator.
