# F5 Red-Team Validation A3

Commit under test: ab66edffe9e5f0a660318acd66ac3a6e3372c6e7

## Lens 1: Exact diff scope

PASS. The A3 diff is scoped to phone-width CSS allocation for the AgentGroupSwitcher and does not touch unrelated product code.

## Lens 2: Narrow dropdown geometry

FAIL. At 390px after expanding Tabs, the dropdown now has nonzero width (`120px`) and correct option data, but its DOMRect overlaps the controls cluster. Captured geometry: dropdown right `328.90625`, controls left `225`; the current-agent dropdown is not a clean readable/tappable phone control.

## Lens 3: Narrow data semantics

PASS. The select value is `alpha:0.0` for active `alpha`, and the full group options include literal status/draft labels such as `alpha running` and `bravo idle • draft`.

## Lens 4: Narrow no-drag requirement

PASS. The switcher-scoped scrubber is hidden at phone width in the captured DOM.

## Lens 5: Wide strip and scrubber

PASS. At 900px, the horizontal strip is visible, the dropdown is hidden, the scrubber is visible, tab switching works, and pointer drag advances `.terminal-header-tabs.scrollLeft` from `0` to `228`.

## Lens 6: Focused test discrimination

PARTIAL. The validator spec is now discriminating and catches the narrow overlap. The committed spec introduced in A2 was still only an `about:blank` smoke, so the slice should retain the validator's fixture-backed assertions when the product fix lands.

## Focused Test

`timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-switcher.spec.ts --project=cc`

Result: FAIL on the narrow overlap assertion, see `F5-focused-a3-rerun.log`.
