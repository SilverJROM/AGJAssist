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

# [driver] F3 CORRECTION (attempt 3) — fix EVERY finding the validator listed

The independent validator FAILed F3: defect_class=TEST_NOT_DISCRIMINATING gate=None.
**Validator's callback summary:** [projcore callback] validator F3 STATUS: DONE — FAIL impl correct; spec green with send-ref resets deleted (mutant M2)

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
FINDING 1 of 1
WHAT FAILED: The product change is CORRECT — do not touch `src/web/public/app.js`. What fails is discrimination: half of it is unguarded. Proof: the shipped `e2e/command-center-refresh.spec.ts`, byte-for-byte, was run against an `/app.js` served through a Playwright route with ONE half of the commit reverted.
  - MUTANT M1 (`const kept = lastUser >= 0 ? list.slice(0, lastUser + 1) : [];` -> `const kept = [];`) => RED at line 181, `terminal-turn-user` expected 1 received 0. Correct.
  - MUTANT M2 (delete the two lines `openAgentAfterYouRef.current = false;` and `sendBaselineRef.current = '';` from `processRefreshSnapshot`) => `1 passed`, exit 0. The spec cannot tell the fixed build from the unfixed one.
And the behaviour M2 removes really is broken (validation/F3-dom-aria-m22-a2b.json, LENS 6): with those two lines gone, a refresh clicked WHILE a send is still capturing, whose response carries new body text, leaves `openAgentAfterYouRef.current === true` while the rebuild has appended a fresh agent after the kept YOU turn; every later poll then hits `applyConversationSnapshot`'s guard `if (openAgentAfterYouRef.current) { if (lastUserIdx < 0 || lastUserIdx < lastAgentIdx) return list; }` and returns the list unchanged — the clearing line sits AFTER that early return — so the transcript freezes permanently (`lens6_m2_livePollRendered=false`, stuck on `REFRESH BODY rho`). At HEAD the same journey renders it (`lens5_head_livePollRendered=true`).
The spec misses it because its freeze block refreshes only after `await page.waitForTimeout(3000)  // Allow send to settle` (line 158): the completed `performSend` has already cleared `openAgentAfterYouRef` via the normal path, so line 167's assertion passes for a build that never executed the reset. Line 167 as written is near-vacuous — it asserts only that ordinary polling works, which it always did. Raising its timeout or moving the literal will NOT fix this.
THE FIX: the discriminating specimen is REFRESH-DURING-SEND, with the refresh response carrying NEW body text. Add a second block to `e2e/command-center-refresh.spec.ts` (keep the existing settled-send block — it guards M1):
    // Freeze prevention: refresh clicked WHILE the send is still capturing.
    // captureCommandResult runs ~3.4s, so 400ms after the click the send is still in flight
    // and openAgentAfterYouRef is still set — this is the only window that exercises the reset.
    nonRefreshOutput = 'initial output fixture';
    await composer.fill('midsend fixture');
    await sendBtn.click();
    await expect(page.locator('[data-testid="terminal-turn-user"]')).toHaveCount(2);
    await page.waitForTimeout(400);                       // NO settle wait — that is the point
    pendingRefreshOutput = 'initial output fixture\nmidsend refresh body fixture';
    await refreshBtn.click();
    await expect(refreshStatus).toContainText('Updated', { timeout: 10000 });
    await expect(page.locator('[data-testid="terminal-conversation"]')).toContainText('midsend refresh body fixture', { timeout: 10000 });
    // The pane moves on; only the 1s background poll can deliver this literal.
    nonRefreshOutput = 'initial output fixture\nmidsend refresh body fixture\nmidsend poll fixture';
    await expect(page.locator('[data-testid="terminal-conversation"]')).toContainText('midsend poll fixture', { timeout: 10000 });
Three requirements make it discriminate, and all three are load-bearing:
  (1) NO settle wait between `sendBtn.click()` and `refreshBtn.click()` — 400ms, inside `captureCommandResult`;
  (2) `pendingRefreshOutput` must be set to text NOT already on screen, so the rebuild opens an agent entry after the kept YOU turn (with an unchanged body the rebuild appends nothing, `lastUserIdx` stays greater than `lastAgentIdx`, the guard never fires, and the mutant passes — verified: LENS 2, `lens2_m2_livePollRendered=true`);
  (3) the final literal must arrive ONLY through `nonRefreshOutput` (the background poll), never through a refresh click.
Every expected value is a literal fixture served by the route, not a value read back from the mechanism under test. To confirm it discriminates before reporting DONE, delete those two reset lines from `processRefreshSnapshot`, run the spec, and check it goes red at the `midsend poll fixture` assertion; then restore them.
WHY THE LAST ATTEMPT MISSED IT: F3-fix-a1.md Finding 3(b) named the freeze literal but not the ORDERING — it said "after that refresh", and the attempt reasonably read that as after a settled send, which is the one arrangement in which the guard cannot fire.
```
**Do this before inventing anything.** A slice spent four attempts each inventing a different mechanism while this file sat unread, and closed on the first attempt that had it. If the prescription is WRONG, say why in your callback — that is a finding worth more than a fifth invention.

Address EVERY finding in the prescription — if it lists FINDING 1 of 3, all three land in this one attempt. Leaving one for later does not defer it, it re-spends a whole cycle rediscovering it. If it says the real path is *untested/mocked/no-op*, you MUST write tests that drive the **ACTUAL** overmind code (the real watcher/completion/ingestion path) end-to-end — **do NOT mock, stub, or no-op the thing under test**; a test that asserts a mock is exactly the FAIL. Fix ALL of the listed findings and NOTHING beyond them — 'do not widen scope' means do not go past the prescription, never 'fix only the first item in it'. Re-run the focused tests, then re-commit atomically **with the slice id in the commit SUBJECT** — `feat(F3): <summary>` or `[F3] <summary>`. An untagged subject is read as a foreign commit and this slice parks again, exactly as it would on attempt 1. Then emit:
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.
`[projcore callback] implementer F3 STATUS: DONE — commit <new sha> <one line: what changed, max 100 chars>`

---

## THE SLICE (unchanged since attempt 1 — this is not the correction)

### Scope
Web UI layer: always-reachable refresh control on `FriendlyTerminalView`; re-pull pane output and session metadata together; in-progress then completion; composer stays interactive. Project `cc` supplies live API/tmux. North 2026-08-27 PLAN_SOUND: I1/I2 satisfiable; after L1 resume at L4 (sol) with budget 6 so >=2 strong informed attempts on the a4 remainder.

### Acceptance criteria — the TEXT is the contract, the id is only its name
- **I1** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **I2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO instead of implementing toward it** — that is a PLAN_DEFECT, and it is worth more than another attempt spent satisfying the wrong thing. **If a criterion states an OUTCOME but not a MECHANISM, name the mechanism you chose in your callback.** A correction that re-invents the mechanism is how a slice reaches attempt 6: four attempts inventing, then one with the prescription in hand.

### Focused tests
`npx playwright test e2e/command-center-refresh.spec.ts --project=cc`
