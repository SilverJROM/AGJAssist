FINDING 1 of 3
WHAT FAILED: src/web/public/app.js:2372-2376 posts folder_group:null when resolvedActiveGroupTab is "all", and e2e/command-center-reminders.spec.ts:103-104 asserts that null as correct. The real POST /api/agent-reminders route requires a non-empty string folder_group, so this create path fails against the C4 API contract and does not prove "current terminal group".
THE FIX: Bind the sheet to an actual current terminal group string before saving. Mechanism: hydrate terminalGroups with a literal non-default group such as "g-alpha", set activeGroupTab to that group through the UI/local state path, save a reminder, and assert the POST body contains folder_group:"g-alpha". If the UI remains on "all", either send a route-accepted string such as "all" by design or disable Save until a real group is selected; do not post null.
WHY THE LAST ATTEMPT MISSED IT: The mocked e2e test made null the expected value instead of checking the backend route contract.

FINDING 2 of 3
WHAT FAILED: src/web/public/app.js:2378-2381 posts recipients as { include: boolean, skip: boolean }, but src/api/routes/agent-reminder-routes.ts and AgentSolicitService expect recipients to be an array of { agent_name, include }. Because the object has no recipient names or length, include/skip choices are not persisted.
THE FIX: Replace the boolean recipients object with a recipient-row mechanism. The UI must collect at least one literal agent name and an include/skip value, then POST recipients:[{ agent_name:"agent-a", include:0 }] for skip and recipients:[{ agent_name:"agent-a", include:1 }] for include. Update the Playwright interception to assert that exact array shape, not { include:false, skip:true }.
WHY THE LAST ATTEMPT MISSED IT: It modeled include/skip as global toggles instead of the API's per-agent recipient rows.

FINDING 3 of 3
WHAT FAILED: e2e/command-center-reminders.spec.ts mocks POST /api/agent-reminders and only asserts the UI's generated payload, so the focused test passes even when the public route would reject the request or ignore recipients.
THE FIX: Add a route-contract specimen to the Playwright test or a focused companion assertion that uses the same POST body against the real registered /api/agent-reminders contract. Mechanism: after intercepting the browser POST, assert body.folder_group is a non-empty literal group id and body.recipients is an array with a literal agent_name plus numeric include flag; remove the null-folder and boolean-recipient expectations.
WHY THE LAST ATTEMPT MISSED IT: The test did not compare the intercepted payload to the C4 API schema/service shape.
