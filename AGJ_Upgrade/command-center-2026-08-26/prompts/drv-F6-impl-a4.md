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

# [driver] F6 CORRECTION (attempt 4) — fix EVERY finding the validator listed

The independent validator FAILed F6: defect_class=IMPL_INCOMPLETE gate=None.
**Validator's callback summary:** [projcore callback] validator F6 STATUS: DONE — FAIL mech=1440 computed padding; wide column not capped

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
FINDING 1 of 2
WHAT FAILED: H3 wide readability is broken at true desktop width. In `src/web/public/style.css`, attempt 3 replaced the locked desktop centered-column mechanism with fixed values: `.terminal-chat-transcript`/`.terminal-chat-composer` use `padding-left/right: 24px`, `.terminal-control-bar` uses `16px`, and `.terminal-search-toggle` uses `right: 16px`. Runtime evidence in `validation/F6-dom-aria-a3.json` at 1440px shows `.terminal-shell` width `1360`, `.terminal-chat-transcript` width `1102`, and transcript padding `24px`; the content is not capped near the locked 880px readable column.
THE FIX: Restore the dynamic desktop column formulas from the locked mockup for every wide-column surface. At `@media (min-width:1024px)`, use `padding-left/right: max(24px, calc((100% - 880px) / 2))` for `.terminal-chat-transcript` and `.terminal-chat-composer`, `padding-left/right: max(16px, calc((100% - 880px) / 2))` for `.terminal-control-bar`, and `right: max(16px, calc((100% - 880px) / 2))` for `.terminal-search-toggle`. Keep the existing button cap and topbar/tab max-width rules.
WHY THE LAST ATTEMPT MISSED IT: It optimized to the 1024px literal test values and removed the scaling mechanism that matters at 1440px.

FINDING 2 of 2
WHAT FAILED: `e2e/command-center-responsive.spec.ts` is discriminating at 390/768/1024, but it does not include a true wide desktop specimen, so the regression in FINDING 1 passes the focused command. The test would not fail when the centered desktop `calc((100% - 880px) / 2)` mechanism is replaced with fixed padding.
THE FIX: Add a 1440px focused Playwright test that opens the terminal through the same public DOM path and asserts literal wide computed values from the restored formula. For the current static-server viewport specimen, assert transcript and composer padding are substantially larger than 24px and equal to the formula for the measured `.terminal-shell`/containing width; also assert `.terminal-chat-transcript` content width is capped near 880px rather than exceeding 1000px. Use a literal helper fixture for the expected shell width if necessary, but do not assert only `not.toBe('24px')`.
WHY THE LAST ATTEMPT MISSED IT: The focused spec stopped at 1024px, where fixed padding can appear acceptable.
```
**Do this before inventing anything.** A slice spent four attempts each inventing a different mechanism while this file sat unread, and closed on the first attempt that had it. If the prescription is WRONG, say why in your callback — that is a finding worth more than a fifth invention.

Address EVERY finding in the prescription — if it lists FINDING 1 of 3, all three land in this one attempt. Leaving one for later does not defer it, it re-spends a whole cycle rediscovering it. If it says the real path is *untested/mocked/no-op*, you MUST write tests that drive the **ACTUAL** overmind code (the real watcher/completion/ingestion path) end-to-end — **do NOT mock, stub, or no-op the thing under test**; a test that asserts a mock is exactly the FAIL. Fix ALL of the listed findings and NOTHING beyond them — 'do not widen scope' means do not go past the prescription, never 'fix only the first item in it'. Re-run the focused tests, then re-commit atomically **with the slice id in the commit SUBJECT** — `feat(F6): <summary>` or `[F6] <summary>`. An untagged subject is read as a foreign commit and this slice parks again, exactly as it would on attempt 1. Then emit:
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.
`[projcore callback] implementer F6 STATUS: DONE — commit <new sha> <one line: what changed, max 100 chars>`

---

## THE SLICE (unchanged since attempt 1 — this is not the correction)

### Scope
CSS layer: port locked `agent-window-v2` theme/responsive tokens in `style.css` (system/light/dark, 390px spacing, centered capped column on tablet/desktop) without regressing existing controls.

### Acceptance criteria — the TEXT is the contract, the id is only its name
- **H3** — The surface is **theme-adaptive** (light/dark follows the device setting) and **readable**; it holds up **mobile / tablet / desktop** — wide widths keep a centered readable column rather than edge-to-edge text.
- **J1** — At **phone / narrow widths** the group agent switcher is a **dropdown** (current agent + caret → tap → pick from the group list, with status + draft indicators); no drag control.
- **J2** — At **wide tablet / desktop widths** it is the horizontal strip **+ a working draggable scrubber**; the presentation swaps by width and both paths switch the active agent identically.

**If a criterion above does not describe the work in Scope, SAY SO instead of implementing toward it** — that is a PLAN_DEFECT, and it is worth more than another attempt spent satisfying the wrong thing. **If a criterion states an OUTCOME but not a MECHANISM, name the mechanism you chose in your callback.** A correction that re-invents the mechanism is how a slice reaches attempt 6: four attempts inventing, then one with the prescription in hand.

### Focused tests
`npx playwright test e2e/command-center-responsive.spec.ts --project=cc`
