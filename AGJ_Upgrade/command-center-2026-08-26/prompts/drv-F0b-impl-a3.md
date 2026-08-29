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

# [driver] F0b CORRECTION (attempt 3) — fix EVERY finding the validator listed


## ⚠ STANDING DIRECTION FROM THE COORDINATOR — applies to THIS attempt too

RAISE-F0b-c1 SLICE-TOO-BIG a4 sonnet5 1800s still working. Split: this row is POSITIVE path only (F0c owns named-reds+contract). Park-rollback restored HEAD 7a4c7c0; ref refs/tiller/command-center-2026-08-26/F0b=e368ae3. Do NOT wholesale cherry-pick e368ae3 (edited server.ts + synthetic I1 throw). Port only spec setup+literal asserts from that ref / validation/F0b-fix-a3.md findings 1-2. Findings 3-4 are F0c. FENCE_ID=F7 without --gate. Sonnet5/opus5. F1-F6 frozen. No src/api/server.ts edits.

**This is a constraint, not background.** It was written after a previous attempt and it still binds: if it forbids something, the fix that does it is wrong even when the tests go green.
The independent validator FAILed F0b: defect_class=TEST_NOT_DISCRIMINATING gate=None.
**Validator's callback summary:** [projcore callback] validator F0b STATUS: DONE — FAIL scope-as-AC; focused green, H3 fallback masks missing theme attr

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
FINDING 1 of 3
WHAT FAILED: H3 in `e2e/command-center-window-fence.spec.ts` lines 303-309 is non-discriminating. It first reads `document.documentElement.getAttribute("data-theme")`, but if the product does not set that attribute it returns `window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"` and then asserts only truthiness. This passes even when the "window theme attribute is applied" condition is false.
THE FIX: Make H3 assert the public product mechanism directly: `const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme")); expect(theme).toMatch(/^(light|dark|system|agj-dark)$/);` or, if the shipped mechanism is a body/class/CSS-variable theme instead of `data-theme`, change the H3 selector/read path to that exact product-owned surface and assert a literal allowed value. Do not fall back to `matchMedia` after a missing product attribute.
WHY THE LAST ATTEMPT MISSED IT: It turned the previous null-attribute failure into an unconditional browser-derived truthy value instead of proving the product-applied theme surface.

FINDING 2 of 3
WHAT FAILED: Setup/open failures are still not represented in `fence-report-v1.json`. Each test now calls `finishContributor()` from `finally`, but if `openAgentWindow()` throws before any `check()` call, `localFailed` remains empty, the shard records no failed acceptance id, and the original exception propagates outside the named G1-J2 report. That violates the slice requirement to collect all G1-J2 in the fence report.
THE FIX: Wrap setup in a named-reporting mechanism. For each contributor test, catch setup/open errors before the finally block and push one failure record for that contributor's acceptance ids, or move `openAgentWindow()` inside a helper that records a deterministic failure such as `{id:"G3",kind:"assert"}` for F1, `{id:"G1",kind:"assert"}` for F2, `{id:"I1",kind:"assert"}` for F3, `{id:"H1",kind:"assert"}` for F4, `{id:"J1",kind:"assert"}` for F5, and `{id:"H3",kind:"assert"}` for F6 before rethrowing.
WHY THE LAST ATTEMPT MISSED IT: It moved `finishContributor()` into finally but did not add a catch path that maps pre-check exceptions into named acceptance failures.

FINDING 3 of 3
WHAT FAILED: A failing checked assertion can still leak tmux sessions. In every test finally block, `await finishContributor(...)` runs before the `killSession()` loop. When `localFailed` is nonempty, `finishContributor()` writes the report and then throws at its `expect(localFailed).toEqual([])` assertion, so the subsequent `killSession()` loop is skipped.
THE FIX: Put tmux cleanup in its own guaranteed finally path that cannot be bypassed by `finishContributor()` throwing. For example: `try { await finishContributor(...); } finally { for (const sessionName of sessions) killSession(sessionName); }` inside each test's outer finally, or split `writeContributorReport()` from `assertContributorPassed()` so cleanup always runs before the assertion throws.
WHY THE LAST ATTEMPT MISSED IT: It prioritized report emission in finally but left cleanup sequenced after the throwing assertion.
```
**Do this before inventing anything.** A slice spent four attempts each inventing a different mechanism while this file sat unread, and closed on the first attempt that had it. If the prescription is WRONG, say why in your callback — that is a finding worth more than a fifth invention.

Address EVERY finding in the prescription — if it lists FINDING 1 of 3, all three land in this one attempt. Leaving one for later does not defer it, it re-spends a whole cycle rediscovering it. If it says the real path is *untested/mocked/no-op*, you MUST write tests that drive the **ACTUAL** overmind code (the real watcher/completion/ingestion path) end-to-end — **do NOT mock, stub, or no-op the thing under test**; a test that asserts a mock is exactly the FAIL. Fix ALL of the listed findings and NOTHING beyond them — 'do not widen scope' means do not go past the prescription, never 'fix only the first item in it'. Re-run the focused tests, then re-commit atomically **with the slice id in the commit SUBJECT** — `feat(F0b): <summary>` or `[F0b] <summary>`. An untagged subject is read as a foreign commit and this slice parks again, exactly as it would on attempt 1. Then emit:
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.
`[projcore callback] implementer F0b STATUS: DONE — commit <new sha> <one line: what changed, max 100 chars>`

---

## THE SLICE (unchanged since attempt 1 — this is not the correction)

### Scope
HARNESS-CORRECTNESS ONLY. POSITIVE path of e2e/command-center-window-fence.spec.ts so G1-J2 match og-req on frozen F1-F6: restore check() await assertion; wait primary AND secondary in /api/tmux/sessions; H1 assert default tabs-collapsed without click; click tabs-collapse only to reveal switcher for G2/J1/J2; literal fixtures not expect(true); J2 uses data-testid=terminal-header-tab. Named-reds and fence-contract remap are F0c. Collect ALL G1-J2. Write fence-report-v1.json in finally. Do not implement product UI. Split from SLICE-TOO-BIG a4.

### Acceptance criteria — the TEXT is the contract, the id is only its name
- **HARNESS-SMOKE** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO instead of implementing toward it** — that is a PLAN_DEFECT, and it is worth more than another attempt spent satisfying the wrong thing. **If a criterion states an OUTCOME but not a MECHANISM, name the mechanism you chose in your callback.** A correction that re-invents the mechanism is how a slice reaches attempt 6: four attempts inventing, then one with the prescription in hand.

### Focused tests
`FENCE_ID=F7 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs`
