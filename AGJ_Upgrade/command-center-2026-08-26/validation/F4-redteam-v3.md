# F4 red-team — validator attempt=3 (marker DRV-F4-21)
commit under test: bb82a579400cc546ab44f26f24f78278197bdfa0
  ("feat(F4): port header v2 collapse chrome with bell hints, controls tuck, row split, and spec hardening")
parent: 282a84f (the a2 subject).
verdict: FAIL   defect_class: IMPL_INCOMPLETE   failed_gate: H2

## Lens 1 — the focused test, as written by the row: FAILS
`timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-header.spec.ts --project=cc`
  -> 1 failed, EXIT=1. Run twice, deterministic. validation/F4-focused-v3.log, F4-focused-v3-rerun.log.
  Test timeout of 60000ms exceeded at spec line 68:
    page.waitForSelector('[data-testid="terminal-session-name"]') to be visible
    123 x locator resolved to HIDDEN <div data-testid="terminal-session-name" ...>
Per the standing contract, any nonzero exit is a FAIL. Everything below explains why, and what
else is wrong behind it.

## Lens 2 — root cause: the header lost its `display:flex`, and the session name lost its width
The prescription (a2 finding 2) said remove the `flex:1 0 100%` DECLARATION. The commit removed the
whole rule:
  -.terminal-topbar-main:has(.command-center-header) { flex-wrap:wrap; }
  -.command-center-header { display:flex; align-items:center; gap:4px; min-width:0; flex:1 0 100%; white-space:nowrap; }
with no replacement, so `.command-center-header` is now a bare `<div>` = `display:block`.
Measured on bb82a57 (validation/F4-dom-aria-v3.json, step "detail-default"):
  .terminal-topbar-main : {w:350, h:124, display:flex}
  .terminal-topbar-target: {w:0,  h:34, display:block}   <-- SQUEEZED TO ZERO WIDTH
  [data-testid=terminal-session-name]: {w:0, h:18}       <-- why the spec times out
  .command-center-header : {w:112, h:124, display:block} <-- children now stack vertically
  header internal bands  : 4  [tabs/controls] [summary-chip] [reminder+wakeup chips] [utilities-collapse]
  topbar height          : 137   (a2 measured 131; this is WORSE)
User-visible consequence, not just a test failure: the agent name and the
"t1 - bash - updated ..." status line are gone from the terminal chat header. Visible in
validation/F4-header-v3.png - the topbar reads "<- | Tabs (5) | ... | A-A+ | ME | [] | gear" with
no session name at all.

## Lens 3 — H2 re-measured on this commit
  (a) "single bell ON THE TOP ROW ... not a second row ... header is ONE ROW when everything is
      collapsed" -> STILL VIOLATED. Step "fully-collapsed": topbar height 69 (a2: 85; a genuine
      one-row header in this app measures 46), and the header's own leaves occupy 2 bands -
      [tabs-collapse, controls-collapse] at top=12 and the bell block at top=39.
      validation/F4-header-v3-fully-collapsed.png shows the bell on the row below.
  (b) "(with a pending-hint dot/count)" -> LANDED. `.cc-util-icon-dot` and `.cc-util-icon-count`
      render inside the bell, gated by `has-reminder` / `has-wakeup`; collapsed header innerText is
      "Tabs (5) | ... | bell | 1" and the count badge is visible in the screenshot with the literal
      fixture value 1. This clause passes.
  (c) "can tuck to `...`" -> HALF LANDED. The handle now reads `...` when tucked and `‹` when
      expanded (a3 changed the label). But the prescribed MECHANISM did not land: see Lens 4.

## Lens 4 — dead CSS: three ported blocks that nothing in the markup can reach
grep counts, style.css vs app.js:
  cc-utilarea      css=2  app.js=0
  util-collapsed   css=2  app.js=0
  cc-ctrlcluster   css=4  app.js=0
  cc-ctrl-items    css=2  app.js=0
The commit added `.cc-utilarea`, `.terminal-shell-header.util-collapsed .cc-utilarea`,
`.cc-ctrlcluster`, `.cc-ctrl-items` and `.cc-ctrlcluster.collapsed .cc-ctrl-items` to style.css and
added NO markup that carries any of those classes. So:
  - the row split (a2 finding 2) exists only as a stylesheet; the chips are still inside
    `.command-center-header`, which is why the header is still multi-row;
  - the controls are still UNMOUNTED by `${!controlsTucked ? html\`...\` : ''}` rather than hidden
    by the cluster rule, so gear/summaries/font/ME are still removed from the DOM when tucked.
Additionally `.cc-ctrl-toggle[data-testid="controls-collapse"] { display:flex; }` was appended,
which overrides the mockup's conditional-reveal rule immediately above it and makes the handle
unconditionally visible.

## Lens 5 — the new spec assertions
POSITIVE: a2 findings 6 and 7 landed correctly. The spec now has visible-before twins for
terminal-font-decrease / terminal-mynav / summaries-toggle / terminal-menu, an expand-again check,
and request-counting via `page.on('request', ...)` for both
`/api/summary-agents/.*/summaries` (click summaries-toggle) and `/api/agent-reminders/active`
(click terminal-menu, assert aria-expanded "true"). Those are the right mechanisms.

DEFECT A - the one-row assertion is UNSATISFIABLE as written. `expect(geometry.count).toBe(1)`
counts distinct `Math.round(rect.top)` bands over `topbar.querySelectorAll('*')` - EVERY
descendant, not the row structure. Measured with the spec's exact formula
(validation/F4-bandcount-v3.mjs -> F4-bandcount-v3.json): specCount=4, specHeight=69, with members
  top=12 terminal-topbar-main, command-center-header, terminal-header-v2, tabs-collapse, controls-collapse
  top=24 terminal-back-list, terminal-topbar-target, terminal-session-name, terminal-topbar-dot, terminal-topbar-name-text
  top=42 terminal-last-updated, bell-indicator, cc-util-icon-dot
  top=35 cc-util-icon-dot, cc-util-icon-count
Bands 24 and 42 are the name/sub stack INSIDE `.terminal-topbar-target`; band 35 is the bell's
absolutely-positioned hint badges. Both structures are required by the mockup and by H2 itself, so
no correct build can ever reach count===1. `height <= 48` is a sound literal; `count === 1` is not.

DEFECT B - the horizontal bound is now DEAD CODE. The evaluate returns
`{ top, bottom, height, bands, count }` with no `children` key, so
`for (const child of geometry.children ?? [])` never iterates and the `right <= 391` /
`left >= -1` assertions no longer run. That bound was the one half of the old geometry check that
DID discriminate (a1 mutation M6: padding 7px -> 90px was CAUGHT). It has been removed.

## Lens 6 — regression sweep on what a1/a2 already fixed
Still good: summariesFreshness {beforeOpen:1, afterOpen:2, refetchedOnOpen:true}
(validation/F4-dom-aria-v3.json). pageErrors: []. The dependency-array fixes survived.

## Lens 7 — mutation testing: NOT RUN this cycle, deliberately
Mutation testing measures whether a GREEN test discriminates. The focused command exits 1 on the
unmutated tree, so every mutation would "fail" for the pre-existing reason and prove nothing.
Deferred to the next cycle in which the row's command passes.

## Lens 8 — brief hygiene
The IMPLEMENTER brief (drv-F4-impl-a3.md, committed here) DID carry the resolved H1/H2 text - a2
finding 1 was acted on for that brief. The VALIDATOR brief for this same attempt still says
"H1 - NO CRITERION TEXT FOUND" / "H2 - NO CRITERION TEXT FOUND". The generator is fixed on one side
only. I validated against the real og-requirements.md:102-106 text, as in a1 and a2.

## Lens 9 — hygiene
Working tree untouched by this validator (`git status --short src e2e` empty). No product code
written. Judged bb82a57 explicitly, not `git rev-parse HEAD`.
