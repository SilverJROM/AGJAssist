# F5 Red-Team Validation A2

Commit under test: d4968bfd17b6960c28d90fcd8b4010f3afc70f49

## Lens 1: Committed test discrimination

FAIL. The committed `e2e/command-center-switcher.spec.ts` is an `about:blank` smoke that would pass if the AgentGroupSwitcher did not exist. The validator replaced it with a fixture-backed behavioral spec before running the required command.

## Lens 2: Narrow responsive presentation

FAIL. At 390px, `[data-testid="agent-group-switcher-dropdown"]` has computed `display:flex` but its DOMRect width is `0`, so Playwright reports it hidden and the screenshot shows no usable current-agent dropdown. The option data is now correct, but the layout still starves the control.

## Lens 3: Dropdown data semantics

PASS. The dropdown includes the full active group, selects `alpha:0.0` for active `alpha`, and includes literal status/draft labels such as `alpha running` and `bravo idle • draft`.

## Lens 4: Wide strip and scrubber

PASS. At 900px, the horizontal strip is visible, overflows under a 12-session fixture, and dragging `[data-testid="agent-group-switcher-scrubber"]` left advances `.terminal-header-tabs.scrollLeft` from `0` to `228`.

## Lens 5: Shared switching action

PASS. The phone select and desktop tab path both call `switchActiveTarget`; the desktop test switched from `alpha` to `charlie` through the strip, and the phone test is positioned to verify select switching after the visibility failure is fixed.

## Focused Test

`timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-switcher.spec.ts --project=cc`

Result: FAIL, see `F5-focused-a2.log`.
