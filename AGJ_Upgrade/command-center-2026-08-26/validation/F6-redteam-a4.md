F6 validator red-team, attempt 4

Commit under test: 241b5cf3f06077953ee2d3edd79f51a7323fbea1

Lens 1 - focused command: CLEAN
`npx playwright test e2e/command-center-responsive.spec.ts --project=cc`
passed under the required timeout wrapper.

Lens 2 - switcher regression: CLEAN
`e2e/command-center-switcher.spec.ts --project=cc` passed. J1/J2 are treated
as regression criteria because the switcher behavior belongs to F5 and F6 is a
CSS-token port.

Lens 3 - whitespace/static hygiene: CLEAN
`git diff --check 241b5cf3f06077953ee2d3edd79f51a7323fbea1^..241b5cf3f06077953ee2d3edd79f51a7323fbea1`
reported no issues.

Lens 4 - theme/mobile/tablet/desktop layout: CLEAN
Browser evidence shows light and dark device schemes render different readable
shell colors. Phone keeps the 12px spacing. Tablet and 1024 desktop resolve to
their minimum token values where the available content well is below the cap.

Lens 5 - true wide H3 readable column: CLEAN
At 1440px, runtime evidence shows `.terminal-shell` width 1360px,
`.terminal-chat-transcript` padding 111px, and transcript content width 880px.
The restored desktop `max(... calc(... 880px))` mechanism caps the readable
column rather than allowing edge-to-edge text.

Lens 6 - locked token parity: CLEAN
Attempt 4 restores the desktop centered-column formulas for transcript,
composer, control bar, and search toggle while preserving the earlier button
caps, topbar/tab caps, menu sheet centering, and summaries dropdown mapping.
