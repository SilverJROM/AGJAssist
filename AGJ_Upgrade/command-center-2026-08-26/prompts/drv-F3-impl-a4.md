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

# [driver] F3 CORRECTION (attempt 4) — fix EVERY finding the validator listed

The independent validator FAILed F3: defect_class=TEST_NOT_DISCRIMINATING gate=None.
**Validator's callback summary:** [projcore callback] validator F3 STATUS: DONE — FAIL midsend specimen lands after send ends; 1200ms route delay defeats it

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
FINDING 1 of 1
WHAT FAILED: `src/web/public/app.js` is CORRECT — do not touch it. The mid-send specimen added by this commit
(`e2e/command-center-refresh.spec.ts` lines 169-184) still does not discriminate. Proof: the shipped spec, byte-for-byte,
run against an `/app.js` served through a Playwright route with part of the product change reverted (each mutant asserts
its needle matched exactly once):
  - M1 (`const kept = lastUser >= 0 ? list.slice(0, lastUser + 1) : [];` -> `const kept = [];`)  => RED at line 181, exit 1. Correct.
  - M2 (delete BOTH `openAgentAfterYouRef.current = false;` and `sendBaselineRef.current = '';`) => `1 passed`, exit 0. WRONG.
  - M2a (delete ONLY `openAgentAfterYouRef.current = false;`)                                     => `1 passed`, exit 0. WRONG.
ROOT CAUSE (measured, not inferred): the mid-send refresh is served by the SAME route branch that sleeps 1200ms
(`await new Promise(r => setTimeout(r, 1200));`), so `processRefreshSnapshot` runs ~1.6s after `sendBtn.click()`. But
`captureCommandResult` has already returned by ~1.15s: line 172 sets `nonRefreshOutput = 'initial output fixture'`
immediately before the send, so the FIRST capture read sees a change, `changed` becomes true, and the loop exits after two
stable reads (250 + 450 + 450 ms) instead of running its full 8 iterations. `performSend` therefore clears
`openAgentAfterYouRef` through the normal path BEFORE the rebuild runs, and the reset the specimen exists to exercise is a
no-op. The comment on line 170 ("captureCommandResult runs ~3.4s") holds only when the pane output does NOT change during
the capture, which is not this arrangement.
THE FIX: keep the whole block, keep the 400ms wait, keep the literals — make the MID-SEND refresh response return
IMMEDIATELY so the rebuild lands inside the send window. Three edits to `e2e/command-center-refresh.spec.ts`:
  1. beside `let nonRefreshOutput = 'initial output fixture';` add:
         let delayRefreshResponse = true;
  2. in the `**/api/tmux/panes/*/output*` route, change
         await new Promise(r => setTimeout(r, 1200));
     to
         if (delayRefreshResponse) await new Promise(r => setTimeout(r, 1200));
     (the earlier refreshes still need the delay — they assert `Refreshing` before `Updated`; only the mid-send one must not have it)
  3. in the mid-send block, immediately BEFORE
         pendingRefreshOutput = 'initial output fixture\nmidsend refresh body fixture';
     add:
         delayRefreshResponse = false;   // land the rebuild INSIDE the send window
While there, correct the line-170 comment: the capture exits early (~1.15s) here because line 172 changes the pane output
right before the send; the specimen works because the refresh response is now immediate, not because the capture is long.
THIS EXACT CHANGE WAS BUILT AND RUN BEFORE BEING PRESCRIBED (validation/F3-fixcheck-*-m23.spec.ts, log
validation/F3-redteam-probe-m23-a3.log):
  - on HEAD: 1 passed, exit 0
  - on the M2 mutant: 1 failed, exit 1, at line 203 — `midsend poll fixture` never arrives, the transcript is frozen on
    `midsend refresh body fixture`
  - on the M2a mutant: 1 failed, exit 1 — it pins the load-bearing line specifically
DO NOT chase M2b. Deleting ONLY `sendBaselineRef.current = '';` leaves the spec green even with the fix above, and that is
correct: that line only changes behaviour when `applyConversationSnapshot` runs with `openNew === true` via the
`hasBaseline` branch, and after a refresh either an agent entry was appended (`openNew` false) or the refresh snapshot
equals the pre-send snapshot (both diffs identical). It is defensive code with no constructible user-visible failure —
spending an attempt on a specimen for it would be wasted.
WHY THE LAST ATTEMPT MISSED IT: F3-fix-a2.md named the ordering (400ms, no settle wait) and the new-body requirement but
not the RESPONSE LATENCY — with the shared 1200ms route delay the refresh resolves after the send has already finished, so
the correct ordering of the CLICKS still produced the wrong ordering of the EFFECTS.
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
