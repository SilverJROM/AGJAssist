RED-TEAM C5 attempt 3

commit=fb921dcfcdd35a94c5ee80401f16b81cdb784d24
focused_test=PASS: timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-reminders.spec.ts --project=cc

Scope authority: C5 scope text, because C1-C4 have no criterion text in og-requirements.md.

Lens 1 - AgentReminderSheet/ActiveRemindersView visibility: PASS
The sheet is visible in the terminal settings menu and renders a mocked active reminder row with a literal id/cadence. validation/C5-dom-aria-a3.txt records visible text, controls, and an ARIA snapshot for the sheet.

Lens 2 - Cadence and repeat controls: PASS
The UI exposes preset cadence buttons, a custom cadence input, unlimited/stop-N repeat mode buttons, and a stop-N numeric input. The focused Playwright test selects the non-default 60-minute preset and stop-N value 3, then asserts the posted body uses those literal values.

Lens 3 - Current group/API contract: PASS
The save payload now sends folder_group as a non-empty string, using "all" for the all-tab current group or the active group id for a selected terminal group. That satisfies the C4 POST route's non-empty string requirement and keeps reload-stable persistence out of scope for C6.

Lens 4 - Include/skip recipient mechanism: PASS
The UI now sends recipients as an array of rows with agent_name and numeric include flag. Unchecking the Include control posts include:0 for the literal agent-b row, which matches AgentSolicitService persistence and represents the skip path through the route contract.

Lens 5 - Test discrimination: PASS
The Playwright create test no longer accepts null folder_group or boolean recipient objects. It supplies literal, non-default values and asserts the intercepted public POST body contains the exact route-compatible values.

Verdict: PASS - standard-clean.
