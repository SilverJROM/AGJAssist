# F5 Red-Team Validation A1

Commit under test: 238b28b098bbce559ec81c4f4447225dbf8f1037

## Lens 1: Narrow responsive presentation

FAIL. At 390px, `[data-testid="agent-group-switcher-dropdown"]` is present and has computed `display:flex`, but Playwright reports it hidden and the screenshot shows only a clipped sliver beside the Tabs button. This does not satisfy the phone-width dropdown requirement.

## Lens 2: Dropdown data semantics

FAIL. The native select is populated from `headerGroupSiblings`, so it excludes the current active agent. In the captured DOM, activeName is `alpha` but selectValue is `bravo:0.0`; the option list starts at `bravo`. The phone requirement says the control presents the current agent before the user picks from the group list.

## Lens 3: Status and draft indicators

PARTIAL. Draft is visible for `bravo` as `bravo • draft`, but status is not represented per option. The only status-like signal remains outside the dropdown/strip.

## Lens 4: Wide strip and scrubber

FAIL. At 1120px the horizontal strip renders and tab clicks are wired, but there is no switcher-scoped `[role="scrollbar"]`, `input[type="range"]`, scrubber test id, or scrubber class in `[data-testid="terminal-header-v2"]`. No pointer-drag scrubber path exists in the diff.

## Lens 5: Shared switching action

PARTIAL. The newly added select calls `switchActiveTarget(e.target.value)`, matching the tab click action, but the control is not actually usable at phone width and starts on the wrong selected value because it omits the active target.

## Focused Test

`timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-switcher.spec.ts --project=cc`

Result: FAIL, see `F5-focused-a1-rerun.log`.
