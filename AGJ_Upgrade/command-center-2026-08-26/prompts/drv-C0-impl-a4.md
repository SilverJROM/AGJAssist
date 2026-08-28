# tiller implementer — standing contract
(This section is identical in every implementer brief. Your specific work is in THE SLICE below.)
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.

You are the IMPLEMENTER. You write product code and tests, then commit.

---

# [driver] C0 CORRECTION (attempt 4) — fix EVERY finding the validator listed

The independent validator FAILed C0: defect_class=TEST_NOT_DISCRIMINATING gate=None.
**Validator's callback summary:** [projcore callback] validator C0 STATUS: DONE — FAIL gate red; token, C1 table, product test route defects

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
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
```
**Do this before inventing anything.** A slice spent four attempts each inventing a different mechanism while this file sat unread, and closed on the first attempt that had it. If the prescription is WRONG, say why in your callback — that is a finding worth more than a fifth invention.

Address EVERY finding in the prescription — if it lists FINDING 1 of 3, all three land in this one attempt. Leaving one for later does not defer it, it re-spends a whole cycle rediscovering it. If it says the real path is *untested/mocked/no-op*, you MUST write tests that drive the **ACTUAL** overmind code (the real watcher/completion/ingestion path) end-to-end — **do NOT mock, stub, or no-op the thing under test**; a test that asserts a mock is exactly the FAIL. Fix ALL of the listed findings and NOTHING beyond them — 'do not widen scope' means do not go past the prescription, never 'fix only the first item in it'. Re-run the focused tests, then re-commit atomically **with the slice id in the commit SUBJECT** — `feat(C0): <summary>` or `[C0] <summary>`. An untagged subject is read as a foreign commit and this slice parks again, exactly as it would on attempt 1. Then emit:
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.
`[projcore callback] implementer C0 STATUS: DONE — commit <new sha> <one line: what changed, max 100 chars>`

---

## THE SLICE (unchanged since attempt 1 — this is not the correction)

### Scope
HARNESS-CORRECTNESS ONLY. Rewrite e2e/command-center-reminders-fence.spec.ts against the REAL C4 contract. Do not add product routes. Collect ALL of C1-C6 (do not abort after the first fail). Owner session required. C1 schema via DB/temp copy not GET /schema. C2 POST /api/agent-reminders with folder_group plus cadence_minutes plus recipients array. C3 fireDue into a real temp pane (not GET /due). C4 owner-gated GET /active. C5 UI sheet visible. C6 solicit reached only included panes. FENCE_STUB=C3 must force named C5 kind=assert red. Write fence-report-v1.json in finally with verdict_line tokens fence=C6 verdict=PASS or FAIL fault_class=none or implementation or plan.

### Acceptance criteria — the TEXT is the contract, the id is only its name
- **HARNESS-SMOKE** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO instead of implementing toward it** — that is a PLAN_DEFECT, and it is worth more than another attempt spent satisfying the wrong thing. **If a criterion states an OUTCOME but not a MECHANISM, name the mechanism you chose in your callback.** A correction that re-invents the mechanism is how a slice reaches attempt 6: four attempts inventing, then one with the prescription in hand.

### Focused tests
`FENCE_ID=C6 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate`
