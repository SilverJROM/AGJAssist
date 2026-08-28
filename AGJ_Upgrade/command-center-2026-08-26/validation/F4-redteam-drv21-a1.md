# F4 validator red-team a1

commit=138b91fd1ea8d33b60ced74061b2d1edf21ad787
focused_test=PASS: timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-header.spec.ts --project=cc
probe=PASS: timeout --signal=TERM --kill-after=15s 180s node AGJ_Upgrade/command-center-2026-08-26/validation/F4-ui-probe-drv21-a1.mjs

Mechanism chosen: mock non-empty reminder, wakeup, and summary responses; drive the public terminal chat UI; collapse utilities; restore through the bell; collapse utilities again; tuck controls; assert visible state plus topbar geometry.

Lens 1 - H1 default and independence: clean. `tabsCollapsed` defaults true and `utilitiesCollapsed` defaults false in `src/web/public/app.js`; the focused spec and probe verify hidden agent tab buttons with the utility chips still visible. Utilities can collapse/restore without expanding tabs.

Lens 2 - H2 one-row bell: clean. In the fully collapsed 390px state, `F4-dom-aria-drv21-a1.json` reports `bands:[15]`, `headerHeight:47`, the bell at top 15/bottom 43, and all visible topbar children inside x=0..391. `F4-header-drv21-a1.png` visually shows a single top row with the bell and pending dot/count.

Lens 3 - pending hint and click target: clean. The probe supplies a reminder and wakeup the UI would not invent by itself; the collapsed bell carries `has-reminder has-wakeup`, a visible dot, count text `1`, and aria label `Show utilities`. Clicking it restores `[data-testid="utilities"]`.

Lens 4 - compact controls tuck: clean. `cc-ctrlcluster.collapsed` hides the font, ME, summaries, and settings controls while leaving the `...` handle visible. The probe asserts font and ME are not visible after tuck, and the screenshot shows the tucked handle on the same row.

Lens 5 - test discrimination: clean. The expected chip values are literals from mocked public API routes (`drv21-reminder`, `drv21-wakeup`, `DRV21 summary signal`), not computed from the implementation. The geometric one-row check fails if the bell drops to another flex band or any visible topbar child overflows the 390px viewport.

Residual note: the target commit itself is empty (`git diff 138b91fd1ea8d33b60ced74061b2d1edf21ad787^..138b91fd1ea8d33b60ced74061b2d1edf21ad787` has no output), so this verdict validates the exact committed tree at that SHA rather than a non-empty F4 code diff.
