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

# [driver] E4 CORRECTION (attempt 3) — fix EVERY finding the validator listed

The independent validator FAILed E4: defect_class=IMPL_INCOMPLETE gate=None.
**Validator's callback summary:** [projcore callback] validator E4 STATUS: DONE — FAIL active pane shows other wakeups; test bypasses UI controls

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
FINDING 1 of 2
WHAT FAILED: D1/D2 are incomplete in src/web/public/app.js. From the ACTIVE:0 agent chat, the wakeup sheet renders a pending row for OTHER:0 and the collapsed summary says "2 wakeups · in 70m". The contract is a one-time wakeup on that single agent and a pending indicator on the agent window, so the UI must not show or count other panes' wakeups in the active agent's sheet/indicator.
THE FIX: In TerminalTab, derive wakeups for display and summary from `wakeups.filter(w => w.pane_target === activeTarget && new Date(w.manual_fire_time) > now)`. Use that active-pane list for `wakeup-collapsed-summary`, `wakeup-pending-row`, and cancel buttons. After POST, append only the returned wakeup for the active pane or refetch pending and keep the same activeTarget display filter.
WHY THE LAST ATTEMPT MISSED IT: The fix added a collapsed summary and ticker, but kept the pending list global.

FINDING 2 of 2
WHAT FAILED: e2e/command-center-wakeup.spec.ts is still not discriminating for the WakeupSheet. It does not click a terminal session row before trying to open the terminal menu, does not assert `[data-testid="wakeup-sheet"]`, does not fill `[data-testid="wakeup-date-input"]`, `[data-testid="wakeup-time-input"]`, or `[data-testid="wakeup-action-input"]`, and schedules/cancels by direct `fetch()` calls instead of the UI controls. A UI with the WakeupSheet removed but the API routes mocked could still satisfy the POST/DELETE assertions.
THE FIX: Drive the public UI path: mock two tmux panes and two pending wakeups with different pane_target values, click the active pane row, open `[data-testid="terminal-menu"]`, assert the sheet and inputs are visible, assert only the active pane's literal pending wakeup appears in expanded and collapsed states, fill the date/time/action inputs with a non-default literal action, click `[data-testid="wakeup-save"]`, assert the POST payload, click `[data-testid="wakeup-cancel"]`, and assert the DELETE id plus row removal.
WHY THE LAST ATTEMPT MISSED IT: It moved assertions to mocked API calls, but bypassed the component interactions that the slice is supposed to validate.
```
**Do this before inventing anything.** A slice spent four attempts each inventing a different mechanism while this file sat unread, and closed on the first attempt that had it. If the prescription is WRONG, say why in your callback — that is a finding worth more than a fifth invention.

## BRAIN DIRECTION — intercept at the MODULE-LOAD / PROXY boundary, not per-method
Your interception is being bypassed because you patch methods AFTER the module is loaded, so a reference captured before the patch (`const w = fs.writeFile; w(...)`), a wrapper, or a fresh `require('fs')` escapes it. Catch aliases at the boundary itself:
- Intercept at RESOLUTION: wrap `Module._load` (or a `--loader`) so EVERY `require('fs'|'child_process'|'net'|'http'|'https')` returns a **Proxy** whose traps route through your interceptor — an alias of a proxied member is still the proxied member.
- For `globalThis.fetch`/timers, replace the global with a Proxy and assert no un-trapped global remains.
- The harness's own invariant test must PROVE an alias/wrapper attempt is caught (that is `AC-R8.1`'s 'alias/wrapper attempts are caught'), driving the REAL adapter boundary — not a mock of it.

Address EVERY finding in the prescription — if it lists FINDING 1 of 3, all three land in this one attempt. Leaving one for later does not defer it, it re-spends a whole cycle rediscovering it. If it says the real path is *untested/mocked/no-op*, you MUST write tests that drive the **ACTUAL** overmind code (the real watcher/completion/ingestion path) end-to-end — **do NOT mock, stub, or no-op the thing under test**; a test that asserts a mock is exactly the FAIL. Fix ALL of the listed findings and NOTHING beyond them — 'do not widen scope' means do not go past the prescription, never 'fix only the first item in it'. Re-run the focused tests, then re-commit atomically **with the slice id in the commit SUBJECT** — `feat(E4): <summary>` or `[E4] <summary>`. An untagged subject is read as a foreign commit and this slice parks again, exactly as it would on attempt 1. Then emit:
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.
`[projcore callback] implementer E4 STATUS: DONE — commit <new sha> <one line: what changed, max 100 chars>`

---

## THE SLICE (unchanged since attempt 1 — this is not the correction)

### Scope
Web UI layer: port `WakeupSheet` plus expanded/collapsed pending indicator (manual date/time/action, pending time, clear on fire or cancel). After C5 to serialize agent-window `app.js` edits.

### Acceptance criteria — the TEXT is the contract, the id is only its name
- **D1** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **D2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **D3** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO instead of implementing toward it** — that is a PLAN_DEFECT, and it is worth more than another attempt spent satisfying the wrong thing. **If a criterion states an OUTCOME but not a MECHANISM, name the mechanism you chose in your callback.** A correction that re-invents the mechanism is how a slice reaches attempt 6: four attempts inventing, then one with the prescription in hand.

### Focused tests
`npx playwright test e2e/command-center-wakeup.spec.ts --project=cc`
