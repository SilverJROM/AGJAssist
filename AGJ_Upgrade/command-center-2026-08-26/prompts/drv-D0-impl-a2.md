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

# [driver] D0 CORRECTION (attempt 2) — fix EVERY finding the validator listed


## ⚠ STANDING DIRECTION FROM THE COORDINATOR — applies to THIS attempt too

EXIT 09:55:16Z D0-a10 unparked then immediately re-parked: fences_for(D0) included D7 because D0 was in D7 plan deps, and parked fence D7 has no OPEN (retired to .pre-reprepare; post-PREPARE OPEN is vacuous because D1-D6 already landed). D0 is harness-author, not a product unit. Plan D7 deps no longer list D0; D7 stays parked until advance-D0.marker. Standing D0.txt: port summaries-fence from 8a0ebc5 / D0-fix-a3.md onto HEAD 241b5cf; do NOT wholesale cherry-pick 8a0ebc5 (would revert F4-F6). Keep cc-capture-reply.mts. FENCE_STUB=D3 named-red E1. Not a new north question.

**This is a constraint, not background.** It was written after a previous attempt and it still binds: if it forbids something, the fix that does it is wrong even when the tests go green.
The independent validator FAILed D0: defect_class=IMPL_INCOMPLETE gate=None.
**Validator's callback summary:** [projcore callback] validator D0 STATUS: DONE — FAIL positive F3 sheet hidden; final report masks it

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
FINDING 1 of 2
WHAT FAILED: The focused D7 gate failed its positive run in e2e/command-center-summaries-fence.spec.ts F3. After opening a real tmux-backed terminal session, the test clicked [data-testid="terminal-menu"], but [data-testid="summary-endpoint-sheet"] stayed hidden for 5000ms. .fence-gate-pos.json shows passed E3,F2,E1,F1 and failed F3 kind=assert; E2 did not run.
THE FIX: Make the F3 harness open the actual settings sheet before asserting endpoint controls. Mechanism: after openTerminalSession(page, sessionName), wait for the selected terminal view to settle, click [data-testid="terminal-menu"], then assert [data-testid="terminal-menu"] has aria-expanded="true" or [data-testid="terminal-menu-sheet"] has class "open" before checking [data-testid="summary-endpoint-sheet"]. If that state never flips, replace openTerminalSession's select-only branch with the proven session-opening path from e2e/command-center-endpoints.spec.ts so the click targets the live terminal header that owns menuOpen.
WHY THE LAST ATTEMPT MISSED IT: It validated D5 with mocked endpoint tests but did not run the D7 positive path against the real temp-copy app/menu state.

FINDING 2 of 2
WHAT FAILED: The final fence-report-v1.json written by e2e/run-command-center-playwright-fence.mjs --gate hides the positive F3 failure. It reports verdict FAIL with failed E1 only because the negative D3 control correctly failed E1, while the real positive failure is only preserved in .fence-gate-pos.json.
THE FIX: Change the gate report aggregation mechanism so a failed positive run carries its .fence-gate-pos.json failures into the final fence-report-v1.json, and append expected negative failures only as a separate negative_control section or distinct kind. The D3 negative specimen can still require exactly E1 kind=assert, but it must not overwrite the positive-run failed id.
WHY THE LAST ATTEMPT MISSED IT: It treated the runner's final summary as sufficient evidence even when the positive and negative reports disagreed.
```
**Do this before inventing anything.** A slice spent four attempts each inventing a different mechanism while this file sat unread, and closed on the first attempt that had it. If the prescription is WRONG, say why in your callback — that is a finding worth more than a fifth invention.

Address EVERY finding in the prescription — if it lists FINDING 1 of 3, all three land in this one attempt. Leaving one for later does not defer it, it re-spends a whole cycle rediscovering it. If it says the real path is *untested/mocked/no-op*, you MUST write tests that drive the **ACTUAL** overmind code (the real watcher/completion/ingestion path) end-to-end — **do NOT mock, stub, or no-op the thing under test**; a test that asserts a mock is exactly the FAIL. Fix ALL of the listed findings and NOTHING beyond them — 'do not widen scope' means do not go past the prescription, never 'fix only the first item in it'. Re-run the focused tests, then re-commit atomically **with the slice id in the commit SUBJECT** — `feat(D0): <summary>` or `[D0] <summary>`. An untagged subject is read as a foreign commit and this slice parks again, exactly as it would on attempt 1. Then emit:
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.
`[projcore callback] implementer D0 STATUS: DONE — commit <new sha> <one line: what changed, max 100 chars>`

---

## THE SLICE (unchanged since attempt 1 — this is not the correction)

### Scope
HARNESS-CORRECTNESS ONLY. Rewrite e2e/command-center-summaries-fence.spec.ts against the real D4 owner-gated contract plus the closed-C6 solicit-reply arrival fixture. Do not invent unauth GET /api/summary-endpoints 200, GET /api/agent-summaries, or GET /api/summary-endpoints/default. Use FENCE_ORIGIN and OWNER_TOKEN. Collect ALL of E1,E2,E3,F1,F2,F3. FENCE_STUB=D3 named-red on E1 kind=assert. Write fence-report-v1.json in finally. Do not add product routes. North 2026-08-28 PLAN_SOUND: carry validation/D0-fix-a3.md.

### Acceptance criteria — the TEXT is the contract, the id is only its name
- **HARNESS-SMOKE** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO instead of implementing toward it** — that is a PLAN_DEFECT, and it is worth more than another attempt spent satisfying the wrong thing. **If a criterion states an OUTCOME but not a MECHANISM, name the mechanism you chose in your callback.** A correction that re-invents the mechanism is how a slice reaches attempt 6: four attempts inventing, then one with the prescription in hand.

### Focused tests
`FENCE_ID=D7 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate`
