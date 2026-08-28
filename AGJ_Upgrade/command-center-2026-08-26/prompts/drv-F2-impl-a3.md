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

# [driver] F2 CORRECTION (attempt 3) — fix EVERY finding the validator listed

The independent validator FAILed F2: defect_class=TEST_NOT_DISCRIMINATING gate=None.
**Validator's callback summary:** [projcore callback] validator F2 STATUS: DONE — FAIL scope-authority; focused spec bypasses UI; send leaves empty key

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
FINDING 1 of 2
WHAT FAILED: `e2e/command-center-drafts.spec.ts` is still not a discriminating Web UI test for F2. At commit `335984b1b7260d2d18299d335279b212aabf7295`, the test catches and ignores `waitForSelector('[data-testid="terminal-session-name"]')`, never mocks `/api/tmux/sessions` or `/api/terminal/groups`, never clicks a terminal row, never asserts `switcher`, conditionally skips all header-tab assertions when `tabCount === 0`, and reads raw `localStorage` instead of the public composer/switcher DOM path. The focused run passed after waiting about 10 seconds even though it did not prove `FriendlyTerminalView` mounted.
THE FIX: Rewrite the focused Playwright spec with local route mocks for two grouped panes (`SA:0.0`, `SB:0.0`) and literal preloaded draft keys. Open `/index.html#/terminals`, click the `SA` row, assert `[data-testid="terminal-composer-input"]` has `literal-alpha-preloaded`, assert the visible sibling tab text/title contains `SB` and a draft marker, fill `literal-alpha-live`, click the public `SB` switcher tab, assert the composer has `literal-beta-preloaded`, fill `literal-beta-live`, switch back to `SA`, assert the composer has `literal-alpha-live`, click send on `SA`, and assert `SB` still restores `literal-beta-live` through the composer path. Do not catch selector failures; do not make tab assertions conditional on zero tabs.
WHY THE LAST ATTEMPT MISSED IT: It checked storage survival rather than driving the mounted terminal UI and public switcher/composer path.

FINDING 2 of 2
WHAT FAILED: Sending clears the active pane visually but recreates the active draft storage key as an empty string. In `src/web/public/app.js`, `sendCommand()` calls `setInput('')` and `clearTerminalDraft(draftViewer, target)` at lines 4123-4124, then the `[input,target]` persist effect at lines 3586-3589 writes `''` back to `agj_terminal_draft:friendly-terminal:<target>`. The independent probe saw `storageAfterSendA === ""` rather than the removed-key state from `clearTerminalDraft()`, while `storageAfterSendB` correctly stayed `literal-beta-live`.
THE FIX: Add a send-clear guard/ref so the persist effect skips the render caused by `setInput('')` after a successful send, or make the write helper remove the key for an empty draft if that matches the intended draft model. The mechanism should leave `localStorage.getItem(activeDraftKey) === null` immediately after send while preserving the unsent sibling key.
WHY THE LAST ATTEMPT MISSED IT: It verified that the sibling draft survived, but did not assert the sent pane remained removed after `clearTerminalDraft()`.
```
**Do this before inventing anything.** A slice spent four attempts each inventing a different mechanism while this file sat unread, and closed on the first attempt that had it. If the prescription is WRONG, say why in your callback — that is a finding worth more than a fifth invention.

## BRAIN DIRECTION — intercept at the MODULE-LOAD / PROXY boundary, not per-method
Your interception is being bypassed because you patch methods AFTER the module is loaded, so a reference captured before the patch (`const w = fs.writeFile; w(...)`), a wrapper, or a fresh `require('fs')` escapes it. Catch aliases at the boundary itself:
- Intercept at RESOLUTION: wrap `Module._load` (or a `--loader`) so EVERY `require('fs'|'child_process'|'net'|'http'|'https')` returns a **Proxy** whose traps route through your interceptor — an alias of a proxied member is still the proxied member.
- For `globalThis.fetch`/timers, replace the global with a Proxy and assert no un-trapped global remains.
- The harness's own invariant test must PROVE an alias/wrapper attempt is caught (that is `AC-R8.1`'s 'alias/wrapper attempts are caught'), driving the REAL adapter boundary — not a mock of it.

Address EVERY finding in the prescription — if it lists FINDING 1 of 3, all three land in this one attempt. Leaving one for later does not defer it, it re-spends a whole cycle rediscovering it. If it says the real path is *untested/mocked/no-op*, you MUST write tests that drive the **ACTUAL** overmind code (the real watcher/completion/ingestion path) end-to-end — **do NOT mock, stub, or no-op the thing under test**; a test that asserts a mock is exactly the FAIL. Fix ALL of the listed findings and NOTHING beyond them — 'do not widen scope' means do not go past the prescription, never 'fix only the first item in it'. Re-run the focused tests, then re-commit atomically **with the slice id in the commit SUBJECT** — `feat(F2): <summary>` or `[F2] <summary>`. An untagged subject is read as a foreign commit and this slice parks again, exactly as it would on attempt 1. Then emit:
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.
`[projcore callback] implementer F2 STATUS: DONE — commit <new sha> <one line: what changed, max 100 chars>`

---

## THE SLICE (unchanged since attempt 1 — this is not the correction)

### Scope
Web UI layer: wire per-pane drafts into `FriendlyTerminalView` and the agent switcher (restore on switch, draft-kept + switcher indicators, clear only the sent pane). After B8 so OVM chrome is gone.

### Acceptance criteria — the TEXT is the contract, the id is only its name
- **G1** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **G2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **G3** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO instead of implementing toward it** — that is a PLAN_DEFECT, and it is worth more than another attempt spent satisfying the wrong thing. **If a criterion states an OUTCOME but not a MECHANISM, name the mechanism you chose in your callback.** A correction that re-invents the mechanism is how a slice reaches attempt 6: four attempts inventing, then one with the prescription in hand.

### Focused tests
`npx playwright test e2e/command-center-drafts.spec.ts --project=cc`
