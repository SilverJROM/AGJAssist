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

# [driver] C0 CORRECTION (attempt 2) — fix EVERY finding the validator listed

The independent validator FAILed C0: defect_class=IMPL_INCOMPLETE gate=None.
**Validator's callback summary:** [projcore callback] validator C0 STATUS: DONE — FAIL gate does not start; C5/stub harness not clean

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
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
HARNESS-CORRECTNESS ONLY. Rewrite e2e/command-center-reminders-fence.spec.ts against the REAL C4 contract. Do not add product routes. Collect ALL of C1-C6 (do not abort after the first fail). Owner session required. C1 schema via DB/temp copy not GET /schema. C2 POST /api/agent-reminders with folder_group plus cadence_minutes plus recipients array. C3 fireDue into a real temp pane (not GET /due). C4 owner-gated GET /active. C5 UI sheet visible. C6 solicit reached only included panes. FENCE_STUB=C3 must force named C5 kind=assert red. Write fence-report-v1.json in finally with verdict_line tokens fence=C6 verdict=PASS or FAIL fault_class=none or implementation or plan. Budget 6 after a4 remaining gaps.

### Acceptance criteria — the TEXT is the contract, the id is only its name
- **HARNESS-SMOKE** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO instead of implementing toward it** — that is a PLAN_DEFECT, and it is worth more than another attempt spent satisfying the wrong thing. **If a criterion states an OUTCOME but not a MECHANISM, name the mechanism you chose in your callback.** A correction that re-invents the mechanism is how a slice reaches attempt 6: four attempts inventing, then one with the prescription in hand.

### Focused tests
`FENCE_ID=C6 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate`
