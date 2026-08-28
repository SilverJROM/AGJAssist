# F4 red-team — validator cycle attempt=1 (marker DRV-F4-21)
commit under test: c3f81e7d9774b83277f4789eb6d812a194f388bb ("fix(F4): repair command center header collapse chrome")
verdict: FAIL   defect_class: IMPL_INCOMPLETE   failed_gate: H2

## Lens 0 — criterion resolution (brief said "NO CRITERION TEXT FOUND")
The brief marked H1 and H2 as having no criterion text. That is FALSE. Both are in
`og-requirements.md` lines 102-106. Reading them changes the verdict, because H2 names
mechanisms the Scope one-liner omits (bell ON ROW 1, pending-hint dot/count, `...` tuck,
"when everything is collapsed the header is ONE ROW"). Recorded as a brief-generation
defect; the criteria themselves are sound.

## Lens 1 — focused test, as written by the row
`npx playwright test e2e/command-center-header.spec.ts --project=cc` -> 1 passed (exit 0).
See validation/F4-focused-v1.log. Green, but see Lens 3.

## Lens 2 — product behaviour, measured against H1/H2 (not against the test)
Probe: validation/F4-ui-probe-v1.mjs -> validation/F4-dom-aria-v1.json, F4-header-v1*.png.
Fixtures: 6 sessions/1 group, 1 active reminder (rem-1), 1 pending wakeup (wake-1), 1 summary.
Viewport 390x844. No page errors (pageErrors: []).

H1 (independent collapse, default tabs-collapsed + util-expanded) -> SATISFIED.
  detail-default: agentGroupSwitcher visible 0, terminalHeaderTab visible 0,
  reminder/wakeup/summary chips visible 1 each. Toggles are independent (tabs expand
  leaves utilities untouched; utilities collapse leaves tabs untouched).

H2 -> VIOLATED on three of its four clauses.
  (a) "single clickable bell icon ON THE TOP ROW ... not a second row ... when everything is
      collapsed the header is ONE ROW."
      MEASURED: fully-collapsed topbar rect = {y:6, height:85} holding TWO bands:
        band1 y=12..46  [terminal-back-list, terminal-topbar-target]
        band2 y=56..84  [tabs-collapse, controls-collapse, bell-indicator]
      For scale, the list-view topbar (a genuine one-row header) is height 46.
      Default state is worse: height 131 = three bands.
      Screenshot F4-header-v1-fully-collapsed.png shows the bell on the second row.
      Cause: `.command-center-header { flex:1 0 100% }` + `.terminal-topbar-main:has(
      .command-center-header){flex-wrap:wrap}` force the whole chrome onto its own row.
      `.command-center-header:has(.command-center-bell){flex:0 0 auto}` does not undo it
      (the row is already broken by the time it applies; measured y=56 with it in effect).
  (b) "(with a pending-hint dot/count)" -> ABSENT. The collapsed control is a bare text
      node "\u{1F514}" with no dot and no count, while the fixture had 1 active reminder and
      1 pending wakeup. Locked mockup names the mechanism: `.cc-util-icon-dot` gated by
      `.has-reminder`, `.cc-util-icon-count` gated by `.has-wakeup`
      (mockups/final/agent-window-v2.html:315-330).
  (c) "the gear/ME/font controls are compact and can tuck to `...`" -> DIVERGES. The port
      tucks them behind a text button labelled "Controls ▲/▼" and, when tucked, the gear
      (`terminal-menu`) and `summaries-toggle` disappear with no overflow entry at all
      (fully-collapsed: terminalMenu visible 0, summariesToggle visible 0). The mockup
      keeps a `...` handle (`ctrlToggle.textContent = v ? '...' : '‹'`, line 1263) and
      only reveals that handle when util is collapsed or already tucked.
  (d) "collapsing the reminders/util row" -> the chips do collapse and the bell restores
      them. This clause passes.

## Lens 3 — test discrimination (north D-082), proved by mutation, not by reading
Harness: mutate one product line, re-run the row's focused command, restore, verify
`git diff --quiet`. Full logs: validation/F4-mutation-v1.log.

  M1 default tabsCollapsed true->false ............................ CAUGHT (exit 1)
  M2 keep `utilities-collapse` rendered in the collapsed branch .... CAUGHT (exit 1)
  M3 `hidden=${tabsCollapsed}` -> `data-collapsed=${tabsCollapsed}` . CAUGHT (exit 1)
  M6 `.command-center-toggle{padding:0 7px}` -> `padding:0 90px` .... CAUGHT (exit 1)
  M4 collapsed header forced onto multiple rows
     (`.command-center-header:has(.command-center-bell)` +=
      `flex-wrap:wrap; max-width:56px`) ............................ NOT CAUGHT (exit 0)
  M5 controls block never renders (`${!controlsTucked ?` -> `${false ?`) NOT CAUGHT (exit 0)

  M4 is the D-082 violation in the spec's one-row check: the expected bounds
  (`geometry.top` / `geometry.bottom`) are read from the very topbar under test, so the
  bound grows with the defect. Only the literal 390/391 horizontal bound has teeth (M6).
  This is precisely why the H2(a) breakage above shipped green.
  M5 is a vacuous-absence gap: Playwright `toBeHidden()` passes for an element that does
  not exist, and the spec never asserts those controls are VISIBLE before clicking
  `controls-collapse`, so the whole control-tuck third of H1/H2 is untested.

## Lens 4 — regression sweep on collateral edits (scope says "collapse chrome only")
The commit also removed the lazy-fetch guards from three effects. Measured, not inferred:
  `summariesFreshness` = {beforeOpen, afterOpen, refetchedOnOpen}
    parent c3f81e7^ : {0, 1, true}   <- opening the summaries dropdown refetched
    HEAD    c3f81e7 : {1, 1, false}  <- opening it no longer refetches
  Mechanism: `useEffect(..., [summariesOpen, activeTarget])` with `if (!summariesOpen) return;`
  became `useEffect(..., [activeTarget])` with the guard deleted (app.js:2439-2458).
  Same shape for reminders/wakeups: deps `[menuOpen]` -> `[]` (app.js:2398-2408), so the
  settings menu no longer refreshes the active-reminder list on open; only
  `handleSaveReminder` refetches, and there is no delete path that does.
  Both are freshness regressions in existing panels, and both are chip-content plumbing
  that the plan row explicitly defers to C5/D6/E4.

## Lens 5 — mockup parity (lesser)
Collapsed tabs render as the text "Tabs ▼ (5)"; the locked mockup uses a
`.cc-tabs-collapsed-pill` reading "\u{1F5C2} N ›" (agent-window-v2.html:669). H1's text does not
require the pill, so this is a note for F5/F6 parity, not part of the gate.

## Lens 6 — hygiene
Working tree restored clean after every mutation (`git diff --quiet -- src e2e` -> clean).
No product code written by this validator.
