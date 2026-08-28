F4 validator red-team a1 rebind

Target commit:
`038ac730d58b048e0c202abb01d23194b8c67658`

Focused command:
`timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-header.spec.ts --project=cc`

Focused result: PASS, but the test remains non-discriminating for F4.

Lens 1 - exact diff scope:
The target commit changes only `src/web/public/app.js`, adding `data-collapsed="true"` to the existing `agent-group-switcher` div. No render branch, state hook, button, aria affordance, or CSS selector consumes that attribute. This does not implement independent tabs, utility, or control collapse.

Lens 2 - rendered UI evidence:
The 390x844 probe uses six literal sessions plus literal reminder, wakeup, and summary fixtures. `F4-dom-aria-a1.txt` shows `terminal-header-v2:0`, `command-center-header:0`, `tabs-collapse:0`, `reminder-chip:0`, and `wakeup-chip:0`. It also shows five visible legacy tab buttons (`bravo` through `foxtrot`) despite the new `data-collapsed="true"` attribute.

Lens 3 - default and fully-collapsed states:
The rendered header has no default collapsed-tabs control or summary pill, no utilities-expanded row/chip area, no utility collapse control, and no single row-1 bell indicator after full collapse. Font controls, ME nav, summaries, and settings remain independent legacy controls with no shared control-collapse/tuck state.

Lens 4 - test discrimination:
The focused spec opens `/index.html#/terminals`, waits one second, and asserts only that `body` is visible. It would pass if the command-center header collapse chrome were absent, as demonstrated by this run.

Verdict: FAIL. H1/H2 have no OG criterion text in the brief, so this validation uses the F4 scope text as the authority.
