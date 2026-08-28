FINDING 1 of 3
WHAT FAILED: Focused gate `FENCE_ID=C6 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate` exits nonzero before the spec runs. The Playwright webServer crashes importing `src/services/overmind/pane-utils.js` from `src/services/ovm-session.ts`; the file is absent in commit `4e854e9739c9300ec8e0411a52e4ac405936128b`.
THE FIX: Restore `src/services/overmind/pane-utils.ts` with the exported helpers used by `ovm-session.ts`, `agent-wake-scheduler.ts`, and `agent-event-ingest.ts`, or change those imports to an existing module. Then rerun the exact C0 gate with the timeout wrapper.
WHY THE LAST ATTEMPT MISSED IT: The harness changes were reviewed without confirming that the real Fastify webServer can boot.

FINDING 2 of 3
WHAT FAILED: `e2e/command-center-reminders-fence.spec.ts:145-162` creates a reminder with `solicit_message: 'LITERAL_ACTIVE_C5'`, then asserts the UI active reminder row contains that message. The current UI row at `src/web/public/app.js:2934` renders only `${r.id} ${r.cadence_minutes} min`, so the positive C5 check is not aligned to the real C5 public UI surface.
THE FIX: For a harness-only fix, make C5 assert a literal value the sheet actually renders through the public UI, such as the deliberately chosen `cadence_minutes: 120` yielding `120 min`, and keep the sheet visibility assertion. Do not compute the expected text from the API response.
WHY THE LAST ATTEMPT MISSED IT: The C5 literal chosen by the harness is not a displayed field in the existing sheet.

FINDING 3 of 3
WHAT FAILED: The C6 contract requires `FENCE_STUB=C3` to force exactly named `C5` kind=`assert` red. The server stub at `src/api/server.ts:145-148` returns 500 for every `/api/agent-reminders/active` request. The spec's C4 check at `e2e/command-center-reminders-fence.spec.ts:136-140` also calls that endpoint, so once the startup blocker is fixed the negative control can fail C4 as well as C5; the gate runner at `e2e/run-command-center-playwright-fence.mjs:148-150` requires an exact failure set.
THE FIX: Give the negative control a C5-only mechanism. One concrete path is: make the C4 probe call `/api/agent-reminders/active?c4_probe=1`, change the C3 stub to skip requests with `c4_probe=1`, and let the UI C5 load keep hitting plain `/api/agent-reminders/active` so only C5 is recorded as `{ id: 'C5', kind: 'assert' }`.
WHY THE LAST ATTEMPT MISSED IT: The stub target was endpoint-wide, but the spec added both C4 and C5 coverage through the same endpoint.
