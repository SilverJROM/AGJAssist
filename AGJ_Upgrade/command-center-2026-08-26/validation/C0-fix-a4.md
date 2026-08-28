FINDING 1 of 6
WHAT FAILED: The required C6 gate exits 1. `.fence-gate-pos.json` shows C5 and C6 failed in the positive run, and `.fence-gate-neg.json` shows C4, C5, and C6 failed in the negative run instead of the required C5-only failure.
THE FIX: Make the positive journey green first, then make the negative-control failure set exact. Mechanism: run the positive spec alone with `FENCE_REPORT_PATH=.fence-gate-pos.json FENCE_ID=C6 ...` and fix the first real C5/C6 assertion failures before rerunning `--gate`.
WHY THE LAST ATTEMPT MISSED IT: It improved earlier C1-C4/auth issues but did not close the positive C5/C6 path.

FINDING 2 of 6
WHAT FAILED: e2e/command-center-reminders-fence.spec.ts:48-53 calls `scripts/cc-fire-due.mts`, but that file is untracked and not part of commit 6811b3fa6ed8750a5004a0268df055831dbcb21f. A clean checkout of the commit cannot run the C3/C6 fireDue mechanism.
THE FIX: Commit `scripts/cc-fire-due.mts` or move the helper into an already tracked harness file. Mechanism: the helper must open `process.env.DB_PATH`, instantiate `AgentReminderScheduler` with real `TmuxService`, `SafetyService`, `AuditService`, `TerminalGroupsService`, and call `fireDue(userId, folderGroup)`.
WHY THE LAST ATTEMPT MISSED IT: The dirty worktree contained the helper, so local execution masked the missing committed artifact.

FINDING 3 of 6
WHAT FAILED: The C5 negative control is hardcoded in the spec at e2e/command-center-reminders-fence.spec.ts:162-164 with `if (FENCE_STUB === 'C3') throw ...`. That is not a mechanism-level C3 stub causing a UI assertion failure. Separately, the server-side C3 stub still makes `/api/agent-reminders/active` return 500 globally, causing C4 and C6 to fail in the negative run.
THE FIX: Remove the explicit FENCE_STUB throw from the spec. Mechanism: map FENCE_STUB=C3 to the C5 ActiveRemindersView data path only, or otherwise patch the C3 contributor so the browser-visible active-reminder row is absent while C4's owner-gated `/api/agent-reminders/active` probe and C6's post-fire checks still pass. The negative failed set must be exactly `[{"id":"C5","kind":"assert"}]`.
WHY THE LAST ATTEMPT MISSED IT: It forced a named red by branching on the stub flag rather than proving the stubbed dependency broke only C5.

FINDING 4 of 6
WHAT FAILED: C6 in e2e/command-center-reminders-fence.spec.ts:194-196 checks `e.details?.solicit_message`, but AuditService stores `details` as a JSON string. This makes the audit assertion fail even when the audit row exists with the expected serialized payload.
THE FIX: Parse audit `details` before asserting. Mechanism: for each audit entry, if `typeof e.details === "string"`, `JSON.parse(e.details)` and compare `details.solicit_message` to `LITERAL_SOLICIT_C6`; if the API route is intended to return parsed details, implement that in the route and assert the parsed public shape.
WHY THE LAST ATTEMPT MISSED IT: It assumed the API returned structured details without checking AuditService/query output.

FINDING 5 of 6
WHAT FAILED: This harness-only commit changes product files `src/api/server.ts` and `src/web/public/app.js`. The scope says HARNESS-CORRECTNESS ONLY and "Do not add product routes"; the product TEST_MODE routes from the prior attempt remain and this attempt changes app rendering to show `solicit_message`.
THE FIX: Keep C0 changes in harness-owned files only unless the plan explicitly changes scope. Mechanism: move `/api/db/tables` inspection into direct temp-DB reads as already done for C1, move fireDue invocation into the committed harness helper, and avoid product UI changes by asserting UI text that the existing app already renders or by closing the prerequisite C5 product slice separately.
WHY THE LAST ATTEMPT MISSED IT: It carried forward product-route/test-support changes from a previous failed attempt and added a product UI adjustment to satisfy the harness.

FINDING 6 of 6
WHAT FAILED: C5 positive gate still fails even though a separate validation screenshot can show the active reminder row under a manually controlled server. The mandated gate's positive report is authoritative and remains red.
THE FIX: Stabilize the C5 browser setup inside the actual fence spec. Mechanism: after creating `LITERAL_ACTIVE_C5`, wait for the app's `/api/agent-reminders/active` response after opening the terminal menu, then assert exactly one visible `[data-testid="active-reminder-row"]` contains `LITERAL_ACTIVE_C5`. If the app filters reminders by active group/current terminal, seed or select that exact group before opening the sheet.
WHY THE LAST ATTEMPT MISSED IT: It did not align the seeded reminder's folder group with the terminal sheet's active group/loading lifecycle in the mandated gate run.
