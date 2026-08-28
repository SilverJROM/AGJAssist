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

# [driver] F6 CORRECTION (attempt 2) — fix EVERY finding the validator listed

The independent validator FAILed F6: defect_class=IMPL_INCOMPLETE gate=None.
**Validator's callback summary:** [projcore callback] validator F6 STATUS: DONE — FAIL vacuous test; incomplete locked responsive token port

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
FINDING 1 of 3
WHAT FAILED: `e2e/command-center-responsive.spec.ts` is non-discriminating. It only runs `expect(true).toBe(true)`, so `npx playwright test e2e/command-center-responsive.spec.ts --project=cc` passes even if the F6 CSS block is removed.
THE FIX: Replace the placeholder with a real Playwright spec that stubs the command-center terminal like `e2e/command-center-switcher.spec.ts`, opens a terminal, captures 390/768/1024 widths, and asserts literal computed values from the locked contract: 390 transcript/composer padding stays the phone value, 768 transcript/composer padding is 16px with centered control bar, and 1024 transcript/composer/control-bar padding is `max(...880px...)` as a concrete pixel value for the chosen viewport. Also assert a negative mechanism by checking at least one selector whose value would remain wrong if the new F6 block were deleted.
WHY THE LAST ATTEMPT MISSED IT: The focused test was left as a harness placeholder rather than a CSS/UI discriminator.

FINDING 2 of 3
WHAT FAILED: The CSS port is incomplete against `AGJ_Upgrade/command-center-2026-08-26/mockups/final/agent-window-v2.html`. The commit ports transcript/composer/control-bar padding and menu/header rules, but omits locked responsive tokens for `.terminal-topbar-target`, `.terminal-header-tab`, transcript/search tool right offset, `.terminal-search-bar`, `.terminal-control-bar button`, summary popover placement, and desktop util-row gap. Runtime evidence in `validation/F6-dom-aria-a1.json` shows the control buttons still have `flexGrow: "1"`, `maxWidth: "none"`, and `.terminal-search-toggle` remains `right: "12px"` at 1024px.
THE FIX: Extend the F6 media blocks in `src/web/public/style.css` with the missing live-app equivalents: at `min-width:768px`, cap `.terminal-topbar-target` to 220px, set `.terminal-header-tab` max-width 140px, move `.terminal-search-toggle` to the same centered-column right offset, give `.terminal-search-bar` centered margins and bottom radius, set `.terminal-control-bar button { flex: 0 1 72px; max-width: 88px; }`, and center the summaries dropdown/menu-equivalent to the locked popover width. At `min-width:1024px`, cap `.terminal-topbar-target` to 260px, `.terminal-header-tab` to 160px, move search/tool offsets to the 880px column, and apply the desktop util gap where the live header exposes that row.
WHY THE LAST ATTEMPT MISSED IT: The port copied only a subset of the locked tablet/desktop token block.

FINDING 3 of 3
WHAT FAILED: The F6 slice lists J1 and J2 acceptance criteria even though those describe group-agent switcher behavior, while the F6 scope is the CSS theme/responsive token port. The already-focused F5 switcher regression passes, but J1/J2 are not F6 product work.
THE FIX: Treat J1/J2 in F6 as explicit regression checks only, or remove them from the F6 acceptance row and leave them owned by F5. If retained, make the F6 responsive spec invoke the same mechanisms as `e2e/command-center-switcher.spec.ts`: 390px dropdown with status/draft option labels and >=900px strip plus pointer-drag scrubber.
WHY THE LAST ATTEMPT MISSED IT: The plan row mixed the CSS-token slice with switcher behavior criteria from the prior slice.
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
