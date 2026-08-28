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

# [driver] D5 CORRECTION (attempt 3) — fix EVERY finding the validator listed

The independent validator FAILed D5: defect_class=TEST_NOT_DISCRIMINATING gate=None.
**Validator's callback summary:** [projcore callback] validator D5 STATUS: DONE — FAIL scope ACs by D5 text; spec weak for edit/delete/default mechanisms

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
FINDING 1 of 3
WHAT FAILED: The focused edit test at `e2e/command-center-endpoints.spec.ts:104` is not discriminating. It assigns `patchBody` from the intercepted request but never asserts `patchBody.name`, `patchBody.base_url`, or `patchBody.model`; the only final assertion is that some PATCH request existed. A UI implementation could send stale values or wrong field names and this test would still pass.
THE FIX: In the edit test, intercept `**/api/summary-endpoints/**`, capture the PATCH body for `/api/summary-endpoints/2`, and assert literal values after Save: `name === 'test-ep-edited'`, `base_url === 'https://api.edited/v1'`, and `model === 'gpt-4-edited'`. Make the follow-up GET return the edited row and assert the row text contains `test-ep-edited` so the public UI refresh path is covered.
WHY THE LAST ATTEMPT MISSED IT: It added `patchBody` but replaced payload assertions with a request-existence check.

FINDING 2 of 3
WHAT FAILED: The focused delete test at `e2e/command-center-endpoints.spec.ts:158` is not discriminating. The route fixture returns the same two endpoints after DELETE, and the test removed the row-count assertion with a comment saying UI update is verified via request. It would pass even if the UI never refreshed or never removed the deleted endpoint from the displayed list.
THE FIX: Make the delete route fixture stateful: before DELETE return endpoints `140` and `test-ep`; after DELETE `/api/summary-endpoints/2`, return only the `140` endpoint from the follow-up GET. Assert `page.locator('[data-testid="endpoint-row"]')` has count `1` and that the sheet does not contain `test-ep`.
WHY THE LAST ATTEMPT MISSED IT: It treated observing the DELETE request as equivalent to verifying the visible remove behavior.

FINDING 3 of 3
WHAT FAILED: The focused default-radio test at `e2e/command-center-endpoints.spec.ts:195` is not discriminating. It does not wait for or assert POST `/api/summary-endpoints/2/default`, does not assert the selected id, and can pass from the browser's native radio checked state before the API/default-refresh mechanism is proven.
THE FIX: In the default test, wrap the radio click in `Promise.all` with `page.waitForRequest(req => req.url().endsWith('/api/summary-endpoints/2/default') && req.method() === 'POST')`, assert the captured id is the literal string `'2'`, make the next GET return endpoint 2 as `is_default: true`, and only then assert the second radio is checked and the first is unchecked.
WHY THE LAST ATTEMPT MISSED IT: It asserted the DOM radio state without tying that state to the default endpoint API call and refreshed fixture.
```
**Do this before inventing anything.** A slice spent four attempts each inventing a different mechanism while this file sat unread, and closed on the first attempt that had it. If the prescription is WRONG, say why in your callback — that is a finding worth more than a fifth invention.

Address EVERY finding in the prescription — if it lists FINDING 1 of 3, all three land in this one attempt. Leaving one for later does not defer it, it re-spends a whole cycle rediscovering it. If it says the real path is *untested/mocked/no-op*, you MUST write tests that drive the **ACTUAL** overmind code (the real watcher/completion/ingestion path) end-to-end — **do NOT mock, stub, or no-op the thing under test**; a test that asserts a mock is exactly the FAIL. Fix ALL of the listed findings and NOTHING beyond them — 'do not widen scope' means do not go past the prescription, never 'fix only the first item in it'. Re-run the focused tests, then re-commit atomically **with the slice id in the commit SUBJECT** — `feat(D5): <summary>` or `[D5] <summary>`. An untagged subject is read as a foreign commit and this slice parks again, exactly as it would on attempt 1. Then emit:
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.
`[projcore callback] implementer D5 STATUS: DONE — commit <new sha> <one line: what changed, max 100 chars>`

---

## THE SLICE (unchanged since attempt 1 — this is not the correction)

### Scope
Web UI layer: port `SummaryEndpointSettings` (add/edit/remove, radio default, seeded `140`, owner-only errors). After C5 to avoid a dual `app.js` merge.

### Acceptance criteria — the TEXT is the contract, the id is only its name
- **F1** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **F2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **F3** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO instead of implementing toward it** — that is a PLAN_DEFECT, and it is worth more than another attempt spent satisfying the wrong thing. **If a criterion states an OUTCOME but not a MECHANISM, name the mechanism you chose in your callback.** A correction that re-invents the mechanism is how a slice reaches attempt 6: four attempts inventing, then one with the prescription in hand.

### Focused tests
`npx playwright test e2e/command-center-endpoints.spec.ts --project=cc`
