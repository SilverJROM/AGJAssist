F6 validator red-team, attempt 3

Commit under test: 99b2a2797ecfee5fe39793dfb6e7e2476c43a6b9

Lens 1 - focused command: CLEAN
`npx playwright test e2e/command-center-responsive.spec.ts --project=cc`
passed under the required timeout wrapper.

Lens 2 - switcher regression: CLEAN
`e2e/command-center-switcher.spec.ts --project=cc` passed. J1/J2 are treated
as regression criteria because they describe the F5 switcher behavior rather
than new F6 CSS-token product work.

Lens 3 - whitespace/static hygiene: CLEAN
`git diff --check 99b2a2797ecfee5fe39793dfb6e7e2476c43a6b9^..99b2a2797ecfee5fe39793dfb6e7e2476c43a6b9`
reported no issues.

Lens 4 - theme/mobile/tablet/1024 layout: CLEAN
Browser evidence shows light and dark device color schemes produce different
readable shell colors. Phone keeps 12px padding. Tablet/1024 assertions match
the committed fixed literals, and controls remain capped.

Lens 5 - true wide H3 readable column: FAIL
The locked mockup uses `max(..., calc((100% - 880px) / 2))` for desktop
transcript/composer/control-bar padding. Attempt 3 changed transcript,
composer, control-bar, and search toggle desktop offsets to fixed 24/16px
values. At 1440px, runtime evidence shows `.terminal-shell` width 1360px,
`.terminal-chat-transcript` width 1102px, and transcript padding still `24px`.
That is wide, edge-near text rather than a centered capped readable column.

Lens 6 - focused test discrimination over wide widths: FAIL
The focused spec asserts only 390, 768, and 1024 widths. It does not include a
wide desktop specimen such as 1440px, so deleting the desktop `calc((100% -
880px) / 2)` mechanism and replacing it with fixed `24px` still passes.
