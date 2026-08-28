F2 validator red-team pass, attempt 2

Commit under test: 335984b1b7260d2d18299d335279b212aabf7295
Scope authority: G1/G2/G3 have no criterion text, so the slice scope is the authority.

Focused test:
- `timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-drafts.spec.ts --project=cc` passed.
- Red-team result: the focused test is still not discriminating. It catches `waitForSelector('[data-testid="terminal-session-name"]')`, never asserts the selector exists, never clicks a real terminal row, never mocks grouped sessions, never asserts `switcher`, and only asserts raw `localStorage`. It can pass without mounting `FriendlyTerminalView` or rendering switcher indicators.

Lens 1: per-pane draft restore/keep
- Independent mechanism: mocked two grouped panes `SA:0.0` and `SB:0.0`, preloaded literal draft keys, opened SA, switched to SB, filled both composers, switched back, then read the public composer value.
- Result: PASS for restore/keep. `SA` opened with `literal-alpha-preloaded`; `SB` opened with `literal-beta-preloaded`; returning to `SA` restored `literal-alpha-live`.

Lens 2: switcher indicators
- Independent mechanism: read public header-tab text/title while sibling panes had non-empty drafts.
- Result: PASS for the desktop header switcher. The sibling tab rendered `SB •` / `Switch to SB — draft` and later `SA •` / `Switch to SA — draft`.

Lens 3: clear only sent pane
- Independent mechanism: while on `SA`, clicked `terminal-send-command`, captured the send request and read both draft keys afterward.
- Result: PARTIAL. The other pane key stayed `literal-beta-live`, but the sent pane key was recreated as an empty string after `clearTerminalDraft()`, because the input-clearing render persists `input === ''` back into the active pane key.

Verdict: FAIL. Product behavior is mostly fixed, but the required focused test still does not prove the slice and the sent-pane clear mechanism does not leave the helper's removed-key state intact.
