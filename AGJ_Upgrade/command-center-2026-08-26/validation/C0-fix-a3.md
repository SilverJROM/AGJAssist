FINDING 1 of 6
WHAT FAILED: The required C6 gate exits 1. `.fence-gate-pos.json` shows C1-C6 all failed because e2e/run-command-center-playwright-fence.mjs:15-30 signs OWNER_TOKEN with `process.env.JWT_SECRET || fallback`, but the runner does not load `.env`; the server process does load `.env` and verifies with a different JWT secret.
THE FIX: In e2e/run-command-center-playwright-fence.mjs, load `.env` before signing the token, or pass an explicit JWT_SECRET into both the token bootstrap and the server process. Mechanism: use `dotenv.config()` in the runner before `bootstrapOwnerToken()`, then insert/update the session row with a token signed by that same secret and pass the token via OWNER_TOKEN.
WHY THE LAST ATTEMPT MISSED IT: It moved from static token to dynamic token but still used a different secret than the server.

FINDING 2 of 6
WHAT FAILED: e2e/run-command-center-playwright-fence.mjs:23-27 mutates `data/agjassist.db` directly during token bootstrap. The fence command is explicitly `AGJASSIST_FENCE_DB_MODE=temp-copy`, so validation must not write the source DB.
THE FIX: Move owner-token/session bootstrap into the isolated DB lifecycle. Mechanism: have scripts/cc-run-isolated.mjs create the temp DB first, mint/insert the owner session into that temp DB, and expose OWNER_TOKEN to the Playwright process/server environment; or make the runner create a temp copy itself before DB writes and point both webServer and tests at that path.
WHY THE LAST ATTEMPT MISSED IT: It bootstrapped before the temp-copy harness owned the DB path.

FINDING 3 of 6
WHAT FAILED: e2e/command-center-reminders-fence.spec.ts:55-62 asserts `agent_reminders`, but the C0 scope says C1 schema via DB/temp copy must verify `agent_solicit_reminders` and `agent_solicit_recipients`.
THE FIX: Change the C1 assertion to require both literal table names `agent_solicit_reminders` and `agent_solicit_recipients` from `/api/db/tables` or another temp-DB inspection path. Do not assert legacy `agent_reminders` for this fence.
WHY THE LAST ATTEMPT MISSED IT: It regressed the a1 table-name correction while restructuring the spec.

FINDING 4 of 6
WHAT FAILED: src/api/server.ts:258-283 adds `/api/test/fire-due` and `/api/db/tables` to the product server even though C0 says "Do not add product routes." `/api/test/fire-due` also has no auth/owner preHandler despite the owner-session requirement.
THE FIX: Remove these product route additions from src/api/server.ts. Mechanism: place test-only helper endpoints in the Playwright harness/server bootstrap layer, or invoke the scheduler through a test-only dependency hook that is not registered in the production API route table. If a TEST_MODE route is kept by an explicit plan change, add owner auth and document the plan change first.
WHY THE LAST ATTEMPT MISSED IT: It treated TEST_MODE gating as enough despite the explicit no-product-routes scope.

FINDING 5 of 6
WHAT FAILED: C5 in e2e/command-center-reminders-fence.spec.ts:137-154 does not prove the visible ActiveRemindersView browser path. It never clicks `[data-testid="terminal-menu"]`, and the Playwright error context shows the page is the login screen, not the terminal/reminder UI.
THE FIX: After valid owner login, navigate to `#/terminals`, click `[data-testid="terminal-menu"]`, wait for `[data-testid="agent-reminder-sheet"]`, and assert a visible active-reminder row/control containing the literal `LITERAL_ACTIVE_C5` text loaded from `/api/agent-reminders/active`. Under FENCE_STUB=C3, that visible UI assertion must be the named C5 failure.
WHY THE LAST ATTEMPT MISSED IT: It checked a locator without opening the UI surface or proving the authenticated app state.

FINDING 6 of 6
WHAT FAILED: e2e/run-command-center-playwright-fence.mjs:123-127 considers the negative control satisfied if C5 appears in the failed list, even when every other check also fails. In this run `.fence-gate-neg.json` had C1-C6 all failed, but `fence-report-v1.json` reported only C5.
THE FIX: Make the gate require negative specificity. Mechanism: after reading `negReport.failed`, assert the set of `{id,kind}` failures equals exactly the configured expected_negative_fail_ids/expected_negative_kind, or at minimum fail when unexpected named assertion ids are present.
WHY THE LAST ATTEMPT MISSED IT: It filtered expected failures out of a broad failure list and discarded the unexpected failures.
