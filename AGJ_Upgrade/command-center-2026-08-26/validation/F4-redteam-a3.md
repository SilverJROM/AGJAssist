F4 validator red-team a3

Target commit:
`7a77cc61493b3b4485073147d69dd97ca4ddf75d`

Focused command:
`timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-header.spec.ts --project=cc`

Focused result: FAIL. The spec timed out at `e2e/command-center-header.spec.ts:67` waiting for `terminal-session-name` after clicking `row.locator('..')`.

Lens 1 - focused test gate:
The required focused command is red, so F4 cannot pass. The row-open step clicks the row parent instead of the `terminal-session-row` itself; that parent has no open handler, so the test waits forever for detail header state.

Lens 2 - independent UI path:
The validation probe clicked `[data-testid="terminal-session-row"][data-session-target="t1"]` directly at a non-control coordinate. `F4-dom-aria-a3.json` still captured `pageErrors:["TypeError: i.push is not a function"]`, all F4 header selectors at zero in `detail-default`, and the body remained on the terminal list. The inserted header render tree is not safe under the public detail path.

Lens 3 - test assertion mechanism:
The spec comment says "No visible tab buttons when collapsed", but it asserts `page.locator('[data-testid="terminal-header-tab"]').count() === 0`. The product mechanism mounts hidden tab buttons under a hidden switcher, so this assertion would fail after the open bug is fixed unless either the product unmounts collapsed tabs or the test asserts visible count/hidden state.

Lens 4 - fully collapsed bell:
The implementation renders `utilities-collapse` as a text button outside the utility container at all times. In the fully collapsed state, it would show both `Hide utilities` and the bell, not a single-row bell-only utility signal.

Lens 5 - one-row geometry:
No CSS was added for `command-center-header`, `terminal-header-v2`, `controls-collapse`, `utilities-collapse`, `bell-indicator`, or the chip ids. The unstyled inline buttons and spans are inserted into the existing topbar flex row, so the mockup chrome and 390px one-row requirement are not established by a stable layout mechanism.

Verdict: FAIL. H1/H2 have no OG criterion text in the brief, so this validation uses the F4 scope text as the authority.
