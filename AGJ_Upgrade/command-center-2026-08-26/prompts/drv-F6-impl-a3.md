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

# [driver] F6 CORRECTION (attempt 3) — fix EVERY finding the validator listed

The independent validator FAILed F6: defect_class=IMPL_INCOMPLETE gate=None.
**Validator's callback summary:** [projcore callback] validator F6 STATUS: DONE — FAIL mech=DOM computed literals; weak tests, popover token, whitespace

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
FINDING 1 of 3
WHAT FAILED: `e2e/command-center-responsive.spec.ts` is improved but still not fully discriminating against wrong responsive values. The test titled `768px transcript/composer padding is 24px...` only asserts `not.toBe('12px')`; the 1024px test similarly asserts padding/search offsets are not phone defaults. A bad value such as `13px`, `999px`, or any non-12px search offset would pass.
THE FIX: Replace the weak negative assertions with literal computed values from the chosen viewport/shell specimen. For the current shipped static-server specimen, assert the actual locked outputs observed through the public DOM path: at 390px transcript/composer padding `12px`; at 768px transcript/composer padding `16px`, control-bar padding `10px`, control buttons `flex-grow: 0`, `flex-basis: 72px`, `max-width: 88px`, topbar max-width `220px`; at 1024px transcript/composer padding `24px`, control-bar padding `16px`, search-toggle right `16px`, topbar max-width `260px`, and control buttons still capped. If the intended shell fixture changes, encode that fixture literally and update these expected literals together.
WHY THE LAST ATTEMPT MISSED IT: It tested "changed from phone" rather than the exact locked token values.

FINDING 2 of 3
WHAT FAILED: The live summaries dropdown was not included in the responsive token port. `src/web/public/app.js` renders `[data-testid="agent-summaries-dropdown"]` with inline `right:12px;width:320px`, while the locked mockup has a responsive `.cc-popover` token. Since the live selector is inline-styled and not `.cc-popover`, the new `style.css` media blocks do not center or widen that surface on tablet/desktop.
THE FIX: Map the mockup popover token to the live selector. Either move the summaries dropdown styling out of inline `style` into a class that `style.css` can control, or add a narrowly-scoped responsive rule for `.terminal-shell [data-testid="agent-summaries-dropdown"]` using `!important` only for the inline-conflicting `left/right/width` properties. At `min-width:768px`, use `left:12px; right:auto; width:min(440px, calc(100% - 24px))`; keep the existing top/z-index/overflow/background/border/radius/padding/shadow behavior unless deliberately changed.
WHY THE LAST ATTEMPT MISSED IT: It copied the mockup `.cc-popover` concept but did not bind it to the live dropdown selector.

FINDING 3 of 3
WHAT FAILED: Static hygiene failed: `git diff --check 6f2ae0f003b86e56ddd346b2e08dc511c04f496b^..6f2ae0f003b86e56ddd346b2e08dc511c04f496b` reports `e2e/command-center-responsive.spec.ts:118: new blank line at EOF.`
THE FIX: Remove the extra blank line at the end of `e2e/command-center-responsive.spec.ts` so the file ends immediately after the final `});` plus a single terminating newline.
WHY THE LAST ATTEMPT MISSED IT: The focused Playwright run does not check whitespace errors.
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
