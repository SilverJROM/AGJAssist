RED-TEAM C5 attempt 2

commit=4a6b029556c78537c2662a8e8c2e8a584bb4eeaa
focused_test=PASS: timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-reminders.spec.ts --project=cc

Scope authority: C5 scope text, because C1-C4 have no criterion text in og-requirements.md.

Lens 1 - Visible sheet and active view: PARTIAL
The sheet is now visible and the mocked active reminder row renders. validation/C5-dom-aria-a2.txt confirms cadence, custom cadence, repeat limit, include, skip, save, and active-row controls exist in the DOM.

Lens 2 - Current terminal group/API create path: FAIL
src/web/public/app.js:2372-2376 sends folder_group:null when the active group tab is "all". The registered POST route in src/api/routes/agent-reminder-routes.ts requires body.folder_group to be a non-empty string and returns 400 otherwise. The C5 create-flow test at e2e/command-center-reminders.spec.ts:103-104 asserts the invalid null payload as expected, so it passes a payload the real backend rejects. It also does not exercise a deliberately selected non-default terminal group.

Lens 3 - Include/skip mechanism: FAIL
src/web/public/app.js:2378-2381 sends recipients as { include: boolean, skip: boolean }. The API/service contract expects recipients?: { agent_name: string; include?: number }[] and AgentSolicitService only persists recipients when params.recipients.length > 0. A boolean object has no recipient names and no length, so include/skip choices are ignored by the real persistence path. The e2e test asserts the wrong object shape at e2e/command-center-reminders.spec.ts:102.

Lens 4 - Test discrimination: FAIL
The tests now verify visible controls, but the create test mocks /api/agent-reminders and asserts the UI's internally invented payload shape instead of the public C4 route contract. It would pass while real users get a 400 for the default all-tab folder_group and lose include/skip recipient selections.

Verdict: FAIL - IMPL_INCOMPLETE.
