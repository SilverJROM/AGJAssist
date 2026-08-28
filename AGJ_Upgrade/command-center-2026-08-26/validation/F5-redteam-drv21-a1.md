# F5 Red-Team Validation DRV-F5-21 A1

Verdict: PASS

Mechanism chosen: fixture-backed Playwright UI test with a literal 12-agent group, a literal `bravo` draft, phone viewport `390px`, desktop boundary viewport `900px`, and public UI switching through the native dropdown and strip tab controls.

Lens 1: Test discrimination
- PASS. The focused spec no longer uses an about:blank smoke check. It mounts the real app route with mocked command-center APIs, asserts literal option text (`alpha running`, `bravo idle • draft`, etc.), and requires a non-default switch from `alpha` to `bravo` through the dropdown and from `alpha` to `charlie` through the strip.

Lens 2: J1 phone presentation
- PASS. At 390px the dropdown is visible with `display:flex`, width `120`, current value `alpha:0.0`, and all group members in the select options with status and draft markers. The strip and scrubber are hidden.

Lens 3: J1 phone layout collision
- PASS. Fresh DOM evidence shows dropdown right edge `322.921875` and controls left edge `342`, leaving the required gap. The screenshot shows the dropdown and control cluster in separate boxes.

Lens 4: J2 desktop presentation and drag
- PASS. At 900px the strip is visible, the dropdown is hidden, the scrubber is visible, and pointer dragging the scrubber advances strip `scrollLeft` from `0` to `228`.

Lens 5: Shared switch action
- PASS. Both dropdown `onchange` and strip tab `onclick` call `switchActiveTarget(...)`; evidence after public interactions shows the active header changes to `bravo` and then `charlie`.

Focused command:
`timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-switcher.spec.ts --project=cc`

Result:
2 passed.
