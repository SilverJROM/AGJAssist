F2 validator red-team pass, attempt 3

Commit under test: afa783f35e136a7c9fae7a3b841c867b45fb7496
Scope authority: G1/G2/G3 have no criterion text, so the slice scope is the authority.

Focused test:
- `timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-drafts.spec.ts --project=cc` passed.
- The focused test now drives the public terminal list, composer, header switcher tabs, send button, and literal per-pane draft values.

Lens 1: per-pane draft restore/keep
- Independent mechanism: mocked two grouped panes `SA:0.0` and `SB:0.0`, preloaded literal draft keys, opened SA, switched to SB, filled both composers, switched back, then read the public composer value.
- Result: PASS. `SA` opened with `literal-alpha-preloaded`; `SB` opened with `literal-beta-preloaded`; returning to `SA` restored `literal-alpha-live`.

Lens 2: switcher indicators
- Independent mechanism: read public header-tab text/title while sibling panes had non-empty drafts.
- Result: PASS. The sibling tab rendered `SB •` / `Switch to SB — draft` and later `SA •` / `Switch to SA — draft`.

Lens 3: clear only sent pane
- Independent mechanism: while on `SA`, clicked `terminal-send-command`, captured the send request, read both draft keys afterward, then switched back to SB through the public tab.
- Result: PASS. The active `SA` key was removed (`null`), `SB` stayed `literal-beta-live`, and the SB composer restored `literal-beta-live`.

Verdict: PASS.
