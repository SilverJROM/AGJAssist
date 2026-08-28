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

# [driver] F5 CORRECTION (attempt 4) — fix EVERY finding the validator listed

The independent validator FAILed F5: defect_class=IMPL_INCOMPLETE gate=None.
**Validator's callback summary:** [projcore callback] validator F5 STATUS: DONE — FAIL J1 phone rect overlap; mechanism=390px non-overlap

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
FINDING 1 of 2
WHAT FAILED: At 390px, `[data-testid="agent-group-switcher-dropdown"]` now has width `120px`, but it overlaps `.cc-ctrlcluster`; DOM evidence in `F5-narrow-a3-dom.txt` shows dropdown right `328.90625` and controls left `225`, and `F5-narrow-a3.png` shows the select visually colliding with the A-/A+ controls.
THE FIX: In `src/web/public/style.css`, add a phone-mode layout rule for the command-center topbar that reserves separate horizontal boxes for the switcher and controls. A concrete mechanism is to tuck or hide `.cc-ctrl-items` at `max-width:899px` while the switcher is expanded, or otherwise set `.terminal-topbar-main:has(.command-center-header)` children so `.agent-group-switcher-dropdown-wrap` right edge remains before `.cc-ctrlcluster` left edge with a gap.
WHY THE LAST ATTEMPT MISSED IT: It proved nonzero dropdown width, but did not test sibling-rectangle overlap inside the 390px Telegram header.

FINDING 2 of 2
WHAT FAILED: The committed `e2e/command-center-switcher.spec.ts` from A2 is an `about:blank` smoke test and does not fail when J1/J2 are violated; the validator had to replace it with fixture-backed assertions to expose the A3 overlap.
THE FIX: Keep a discriminating `e2e/command-center-switcher.spec.ts` in the implementation commit. Use a literal group fixture with active `alpha`, draft-bearing `bravo`, and enough siblings to overflow the desktop strip; assert phone dropdown value/options/no-scrubber/no-overlap, desktop strip/dropdown swap, tab switch, and scrubber-driven `scrollLeft`.
WHY THE LAST ATTEMPT MISSED IT: It delegated real validation to the validator instead of making the slice-owned focused spec enforce the acceptance criteria.
```
**Do this before inventing anything.** A slice spent four attempts each inventing a different mechanism while this file sat unread, and closed on the first attempt that had it. If the prescription is WRONG, say why in your callback — that is a finding worth more than a fifth invention.

Address EVERY finding in the prescription — if it lists FINDING 1 of 3, all three land in this one attempt. Leaving one for later does not defer it, it re-spends a whole cycle rediscovering it. If it says the real path is *untested/mocked/no-op*, you MUST write tests that drive the **ACTUAL** overmind code (the real watcher/completion/ingestion path) end-to-end — **do NOT mock, stub, or no-op the thing under test**; a test that asserts a mock is exactly the FAIL. Fix ALL of the listed findings and NOTHING beyond them — 'do not widen scope' means do not go past the prescription, never 'fix only the first item in it'. Re-run the focused tests, then re-commit atomically **with the slice id in the commit SUBJECT** — `feat(F5): <summary>` or `[F5] <summary>`. An untagged subject is read as a foreign commit and this slice parks again, exactly as it would on attempt 1. Then emit:
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.
`[projcore callback] implementer F5 STATUS: DONE — commit <new sha> <one line: what changed, max 100 chars>`

---

## THE SLICE (unchanged since attempt 1 — this is not the correction)

### Scope
Web UI layer: `AgentGroupSwitcher` — below 900px status/draft dropdown with no drag; at 900px+ horizontal strip plus working pointer scrubber; both paths call the same switch action.

### Acceptance criteria — the TEXT is the contract, the id is only its name
- **J1** — At **phone / narrow widths** the group agent switcher is a **dropdown** (current agent + caret → tap → pick from the group list, with status + draft indicators); no drag control.
- **J2** — At **wide tablet / desktop widths** it is the horizontal strip **+ a working draggable scrubber**; the presentation swaps by width and both paths switch the active agent identically.

**If a criterion above does not describe the work in Scope, SAY SO instead of implementing toward it** — that is a PLAN_DEFECT, and it is worth more than another attempt spent satisfying the wrong thing. **If a criterion states an OUTCOME but not a MECHANISM, name the mechanism you chose in your callback.** A correction that re-invents the mechanism is how a slice reaches attempt 6: four attempts inventing, then one with the prescription in hand.

### Focused tests
`npx playwright test e2e/command-center-switcher.spec.ts --project=cc`
