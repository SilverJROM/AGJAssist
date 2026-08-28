F6 validator red-team, attempt 1

Commit under test: 8e174159607b86502d308e4f7efadb5ef9632050

Lens 1 - focused test discrimination: FAIL
`e2e/command-center-responsive.spec.ts` only asserts `expect(true).toBe(true)`.
It never loads the terminal UI, never reads `style.css`, and would still pass if the
F6 CSS block were deleted.

Lens 2 - locked mockup token parity: FAIL
The commit ports transcript, composer, control-bar padding, menu-sheet centering,
and header padding. It omits locked tablet/desktop rules for topbar target width,
header tab max width, transcript/search tool right offset, search-bar margins,
control-bar button caps, summary popover placement, and desktop util-row gap.

Lens 3 - runtime computed layout: PARTIAL
Browser evidence shows transcript/composer/control-bar padding changes at 768 and
1024, but control buttons still stretch (`flex-grow: 1`, no max-width) and search
toggle right remains fixed at 12px even at 1024.

Lens 4 - existing switcher regression: CLEAN
`e2e/command-center-switcher.spec.ts --project=cc` passed under the required
timeout wrapper, so the already-implemented J1/J2 switcher behavior was not
regressed by this commit.

Lens 5 - scope/AC coherence: FAIL
J1 and J2 are switcher behavior criteria. They do not describe the F6 CSS token
port scope except as a regression check against F5.
