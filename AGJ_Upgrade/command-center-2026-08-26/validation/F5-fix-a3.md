FINDING 1 of 2
WHAT FAILED: At 390px, `[data-testid="agent-group-switcher-dropdown"]` now has width `120px`, but it overlaps `.cc-ctrlcluster`; DOM evidence in `F5-narrow-a3-dom.txt` shows dropdown right `328.90625` and controls left `225`, and `F5-narrow-a3.png` shows the select visually colliding with the A-/A+ controls.
THE FIX: In `src/web/public/style.css`, add a phone-mode layout rule for the command-center topbar that reserves separate horizontal boxes for the switcher and controls. A concrete mechanism is to tuck or hide `.cc-ctrl-items` at `max-width:899px` while the switcher is expanded, or otherwise set `.terminal-topbar-main:has(.command-center-header)` children so `.agent-group-switcher-dropdown-wrap` right edge remains before `.cc-ctrlcluster` left edge with a gap.
WHY THE LAST ATTEMPT MISSED IT: It proved nonzero dropdown width, but did not test sibling-rectangle overlap inside the 390px Telegram header.

FINDING 2 of 2
WHAT FAILED: The committed `e2e/command-center-switcher.spec.ts` from A2 is an `about:blank` smoke test and does not fail when J1/J2 are violated; the validator had to replace it with fixture-backed assertions to expose the A3 overlap.
THE FIX: Keep a discriminating `e2e/command-center-switcher.spec.ts` in the implementation commit. Use a literal group fixture with active `alpha`, draft-bearing `bravo`, and enough siblings to overflow the desktop strip; assert phone dropdown value/options/no-scrubber/no-overlap, desktop strip/dropdown swap, tab switch, and scrubber-driven `scrollLeft`.
WHY THE LAST ATTEMPT MISSED IT: It delegated real validation to the validator instead of making the slice-owned focused spec enforce the acceptance criteria.
