F2 validator red-team pass, attempt 1

Commit under test: 257d83f945df65305081d9fc9bce8ed36d0b38e9
Scope authority: G1/G2/G3 have no criterion text, so the slice scope is the authority.

Focused test:
- `timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-drafts.spec.ts --project=cc` passed.
- Red-team result: the focused test is not discriminating. It only counts `data-testid` placeholders and would pass without per-pane draft persistence, restoration, switcher indicators, or clear-only-sent-pane behavior.

Lens 1: draft state mechanism
- Mechanism tested independently: preload literal distinct localStorage draft values for `SA:0.0` and `SB:0.0`, open `SA`, switch to `SB`, then switch back through the public header-tab DOM path.
- Expected: `SA` opens with `literal-alpha-preloaded`, `SB` opens with `literal-beta-preloaded`, and returning to `SA` restores `literal-alpha-live`.
- Actual: the composer is empty after opening `SA`, after switching to `SB`, and after returning to `SA`; both draft storage keys are also overwritten to empty on target changes.
- Source cause: `FriendlyTerminalView` writes `input` on `[input,target]` immediately, while `loadInitial()` resets `input` to empty on target/session load.

Lens 2: switcher/dropdown indicators
- The commit changes `terminal-header-tabs` to `agent-group-switcher`, but header-tab buttons only render session names.
- There is no draft-aware indicator state on sibling buttons.
- `agent-group-switcher-dropdown` is a hidden placeholder inside `FriendlyTerminalView`, and `App()` also renders hidden global placeholders for all three test IDs.

Verdict: FAIL.
