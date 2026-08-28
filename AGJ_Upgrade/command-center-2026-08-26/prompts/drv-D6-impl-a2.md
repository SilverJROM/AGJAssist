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

# [driver] D6 CORRECTION (attempt 2) — fix EVERY finding the validator listed

The independent validator FAILed D6: defect_class=TEST_NOT_DISCRIMINATING gate=None.
**Validator's callback summary:** [projcore callback] validator D6 STATUS: DONE — FAIL newest-first untested; UI preserves API order not DESC sort

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
FINDING 1 of 4
WHAT FAILED: E2 newest-first. Independent probe sent summaries oldest-first (`First summary` at `2026-08-27T09:00:00Z`, then `Second summary` at `2026-08-27T10:00:00Z`). `src/web/public/app.js` renders `summaries.map` with no `created_at`/`id` sort, so card 0 was First (9:00 AM) and card 1 was Second (10:00 AM). The focused spec at `e2e/command-center-summaries.spec.ts:31-34` already lists newest-first, so `cards.nth(0)` = `Second summary` cannot fail a non-sorting UI.
THE FIX: In `src/web/public/app.js` inside the summaries-dropdown render (the `summaries.map` around the `data-testid="summary-card"` block), sort a copy before mapping: `[...summaries].sort((a, b) => { const tb = Date.parse(b.created_at || '') || 0; const ta = Date.parse(a.created_at || '') || 0; return tb - ta || (Number(b.id) || 0) - (Number(a.id) || 0); })`. In `e2e/command-center-summaries.spec.ts`, put the fixture oldest-first (id 1 / 09:00 `First summary` first, then id 2 / 10:00 `Second summary`) and keep asserting nth(0) contains `Second summary` and nth(1) contains `First summary`.
WHY THE LAST ATTEMPT MISSED IT: The spec computed expected order from an already-DESC fixture, which is the order the unsort UI already emits.

FINDING 2 of 4
WHAT FAILED: E2 "that agent's summaries". The focused spec routes `**/api/summary-agents/*/summaries` and returns the same two rows for every agent. It never records the GET pathname. A UI that fetches `/api/summary-agents/wrong/summaries` or a hardcoded name would still pass. The pane fixture target is the literal `1`.
THE FIX: In the cards test, replace the glob fulfill with a pathname check: parse `new URL(route.request().url()).pathname` and only return the two-row fixture when it equals `/api/summary-agents/1/summaries`; otherwise return `{ summaries: [] }`. After opening the dropdown, `expect(requestedPath).toBe('/api/summary-agents/1/summaries')` (record `requestedPath` from that route). Keep the pane target literal `1` in the tmux fixture.
WHY THE LAST ATTEMPT MISSED IT: The glob mock made every agent look like agent-a.

FINDING 3 of 4
WHAT FAILED: E2 timestamped. Cards do render `new Date(s.created_at).toLocaleString()`, but `e2e/command-center-summaries.spec.ts` never asserts any date/time text. A card with only summary text + `via …` would still pass.
THE FIX: In the cards test, compute the expected stamp in the spec from the fixture literal (not from the component): `const newestStamp = new Date('2026-08-27T10:00:00Z').toLocaleString();` and `await expect(cards.nth(0)).toContainText(newestStamp);` plus the same for `2026-08-27T09:00:00Z` on nth(1).
WHY THE LAST ATTEMPT MISSED IT: Assertions covered summary text and endpoint tags only.

FINDING 4 of 4
WHAT FAILED: E2 scrollable. The dropdown has inline `max-height:400px;overflow:auto`, but the focused spec never asserts those styles. Removing them would still pass.
THE FIX: After the dropdown is visible, `await expect(page.locator('[data-testid="agent-summaries-dropdown"]')).toHaveCSS('max-height', '400px');` and `await expect(page.locator('[data-testid="agent-summaries-dropdown"]')).toHaveCSS('overflow', 'auto');`.
WHY THE LAST ATTEMPT MISSED IT: Scroll was CSS-only with no discriminating assertion.
```
**Do this before inventing anything.** A slice spent four attempts each inventing a different mechanism while this file sat unread, and closed on the first attempt that had it. If the prescription is WRONG, say why in your callback — that is a finding worth more than a fifth invention.

Address EVERY finding in the prescription — if it lists FINDING 1 of 3, all three land in this one attempt. Leaving one for later does not defer it, it re-spends a whole cycle rediscovering it. If it says the real path is *untested/mocked/no-op*, you MUST write tests that drive the **ACTUAL** overmind code (the real watcher/completion/ingestion path) end-to-end — **do NOT mock, stub, or no-op the thing under test**; a test that asserts a mock is exactly the FAIL. Fix ALL of the listed findings and NOTHING beyond them — 'do not widen scope' means do not go past the prescription, never 'fix only the first item in it'. Re-run the focused tests, then re-commit atomically **with the slice id in the commit SUBJECT** — `feat(D6): <summary>` or `[D6] <summary>`. An untagged subject is read as a foreign commit and this slice parks again, exactly as it would on attempt 1. Then emit:
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.
`[projcore callback] implementer D6 STATUS: DONE — commit <new sha> <one line: what changed, max 100 chars>`

---

## THE SLICE (unchanged since attempt 1 — this is not the correction)

### Scope
Web UI layer: port `AgentSummariesDropdown` (per-agent newest-first cards, endpoint tags, scroll, empty state). After D5 as the other new agent-window sheet.

### Acceptance criteria — the TEXT is the contract, the id is only its name
- **E2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **E3** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO instead of implementing toward it** — that is a PLAN_DEFECT, and it is worth more than another attempt spent satisfying the wrong thing. **If a criterion states an OUTCOME but not a MECHANISM, name the mechanism you chose in your callback.** A correction that re-invents the mechanism is how a slice reaches attempt 6: four attempts inventing, then one with the prescription in hand.

### Focused tests
`npx playwright test e2e/command-center-summaries.spec.ts --project=cc`
