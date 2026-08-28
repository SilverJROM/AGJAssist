# F5 Red-Team Validation A4

Commit under test: 40ec05e841e42289566ee9fd36224ca351c43076

## Lens 1: Exact diff scope

PASS. The A4 product change is scoped to phone-width CSS for the AgentGroupSwitcher/header controls, plus the slice-owned Playwright spec. No unrelated product areas changed.

## Lens 2: Narrow presentation

PASS. At 390px, the group switcher is a native dropdown. It is visible, readable, has a nonzero 120px DOMRect, and does not overlap `.cc-ctrlcluster` (`dropdownRight=322.921875`, `controlsLeft=342`).

## Lens 3: Narrow data and indicators

PASS. The dropdown selects the current active agent `alpha:0.0`, includes the full group list, and shows literal status/draft indicators, including `alpha running` and `bravo idle • draft`.

## Lens 4: Narrow no-drag control

PASS. The switcher-scoped scrubber is hidden at phone width, and the horizontal strip is hidden.

## Lens 5: Wide strip and scrubber

PASS. At 900px, the horizontal strip is visible, the dropdown is hidden, tab switching uses the same active-target switch path, and pointer-dragging `[data-testid="agent-group-switcher-scrubber"]` advances `.terminal-header-tabs.scrollLeft` from `0` to `228`.

## Lens 6: Test discrimination

PASS. The focused spec uses literal fixture expectations: active `alpha`, draft-bearing `bravo`, and enough siblings to force desktop overflow. It would fail if the phone dropdown omitted current/status/draft/no-overlap/no-scrubber behavior or if the wide scrubber did not move the strip.

## Focused Test

`timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-switcher.spec.ts --project=cc`

Result: PASS, see `F5-focused-a4.log`.
