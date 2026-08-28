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

# [driver] F3 CORRECTION (attempt 5) — fix EVERY finding the validator listed

The independent validator FAILed F3: defect_class=FLAKY_GATE_TEST gate=None.
**Validator's callback summary:** [projcore callback] validator F3 STATUS: DONE — FAIL mutants now discriminate but spec flakes 1-in-3 on the 30s test timeout

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
FINDING 1 of 1
WHAT FAILED: The product code and the discrimination are both CORRECT now — do not touch `src/web/public/app.js`, and do
not restructure the mid-send block. What fails is that the gate test does not pass RELIABLY. Three consecutive runs of the
prescribed command `timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-refresh.spec.ts --project=cc`:
  run 1: 1 passed (11.3s), exit 0
  run 2: 1 FAILED, exit 1 — `Test timeout of 30000ms exceeded` at e2e/command-center-refresh.spec.ts:185 (`midsend poll fixture`)
  run 3: 1 passed (29.9s), exit 0 — 0.1s under the ceiling
ROOT CAUSE (measured, not inferred — validation/F3-timing-m24.jsonl, 5 instrumented runs): every wait AFTER the view
mounts is stable at ~10.2s (view-mounted -> midsend-poll-rendered = 10135/10126/10138/10131/10138 ms). What varies is the
MOUNT: 1207 / 2470 / 4801 / 13515 / 16893 ms. Two of those runs finished at 24.9s and 28.1s against the 30000ms per-test
timeout in `playwright.config.ts`. A mount near 20s pushes the final assertion past the ceiling. The failure transcript
shows the correct pre-poll state — the clock ran out mid-assertion; this is NOT a product freeze and NOT a bad specimen.
The mount phase fetches `https://telegram.org/js/telegram-web-app.js` (~850ms), `https://esm.sh/preact@10.19.3`,
`https://esm.sh/htm@3.1.1` and a jsdelivr stylesheet (validation/F3-netprobe-m24.jsonl); on a quiet box the whole mount is
~1.2s, so the jitter tracks machine load (this box runs other seats; `uptime` showed load ~2.8 with another project's node
process at 173% CPU during the failing window). The journey's ~10.2s of deliberate waits — the `waitForTimeout(3000)`
settle sleep plus two 1200ms route delays — leaves no headroom for that.
THE FIX: one line. Make it the FIRST statement inside the test in `e2e/command-center-refresh.spec.ts`, immediately after
`test('command-center refresh control is always reachable and re-pulls output and session metadata', async ({ page }) => {`:
    // The journey itself is ~10s of deliberate waits; page mount on this shared box has been
    // measured between 1.2s and 16.9s. The 30000ms config default leaves no headroom.
    test.setTimeout(90000);
`test.setTimeout()` is a per-test override — it does NOT touch `playwright.config.ts` and does not affect any other spec.
VERIFIED BEFORE BEING PRESCRIBED (validation/F3-fixcheck-timeout-m24.spec.ts, log validation/F3-redteam-probe-m24-a4.log):
  - shipped journey + `test.setTimeout(90000)`: 5 runs, 5 passed, exit 0 every time.
  - discrimination is NOT weakened by the longer timeout: the four mutants in validation/F3-mutant-*-m24.spec.ts already
    carry `test.setTimeout(120000)` and still go red — M1 (`kept` -> `[]`) at line 182, M2 (both resets deleted) and M2a
    (only `openAgentAfterYouRef.current = false;` deleted) at line 204. So raising the ceiling removes the flake without
    removing the test's teeth.
DO NOT "fix" this by deleting or shortening `await page.waitForTimeout(3000);  // Allow send to settle` (line 158). That
sleep is what makes the FIRST freeze block the SETTLED-send specimen; without it that block collapses into the mid-send
one and M1's guard at line 182 is the only thing left. If you want the journey shorter, replace that sleep with a
deterministic wait on the agent turn that the settled send produces
(`await expect(page.locator('[data-testid="terminal-turn-agent"]')).toHaveCount(N)`) and then RE-RUN the M1/M2/M2a
mutants to prove all three are still red — do not ship a shortening that has not been re-mutated.
DO NOT chase M2b (deleting only `sendBaselineRef.current = '';` leaves the spec green). That is correct and was settled at
attempt 3: after a refresh either an agent entry was appended (`openNew` false) or the refresh snapshot equals the
pre-send snapshot (both diffs identical), so no user-visible failure can be constructed from it.
WHY THE LAST ATTEMPT MISSED IT: the specimen was verified once, green, on a quiet box; nothing in the attempt-3
prescription asked for a repeat-run stability check, and a single green run cannot show a 1-in-3 wall-clock flake.
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
