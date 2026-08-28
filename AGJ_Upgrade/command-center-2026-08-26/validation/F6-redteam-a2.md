F6 validator red-team, attempt 2

Commit under test: 6f2ae0f003b86e56ddd346b2e08dc511c04f496b

Lens 1 - focused command: CLEAN
`npx playwright test e2e/command-center-responsive.spec.ts --project=cc`
passed under the required timeout wrapper.

Lens 2 - switcher regression: CLEAN
`e2e/command-center-switcher.spec.ts --project=cc` passed. Treating J1/J2 as
regression criteria is the chosen mechanism because those clauses describe the
F5 switcher behavior, not new F6 CSS-token work.

Lens 3 - runtime theme/layout probe: CLEAN for core H3
No-Telegram browser evidence shows light mode uses light shell colors and dark
mode uses dark shell colors. Phone keeps 12px padding. Tablet/desktop add
responsive transcript/composer/control-bar padding, cap control buttons, and
move the search toggle.

Lens 4 - focused test discrimination: FAIL
The spec still uses weak negative assertions for values named literally by the
test titles: 768px padding is asserted only as `not.toBe('12px')`, and 1024px
padding/search offset are asserted only as not being phone defaults. A wrong
13px, 999px, or edge-to-edge offset would still pass.

Lens 5 - locked mockup token parity: PARTIAL
The second attempt ports more tokens, but the live summaries dropdown remains
an inline `data-testid="agent-summaries-dropdown"` style at `right:12px;width:320px`.
The mockup's responsive `.cc-popover` placement was not mapped to the live
selector, so that surface remains outside the centered responsive token set.

Lens 6 - whitespace/static hygiene: FAIL
`git diff --check 6f2ae0f...^..6f2ae0f...` reports
`e2e/command-center-responsive.spec.ts:118: new blank line at EOF.`
