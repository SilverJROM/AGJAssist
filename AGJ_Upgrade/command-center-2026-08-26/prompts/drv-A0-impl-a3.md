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

# [driver] A0 CORRECTION (attempt 3) — fix EVERY finding the validator listed

The independent validator FAILed A0: defect_class=INTERCEPTION_GAP gate=None.
**Validator's callback summary:** [projcore callback] validator A0 STATUS: DONE — FAIL scope-as-AC; wrote A0-fix-a2; late hook, F1 misses G3

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
FINDING 1 of 2
WHAT FAILED: FENCE_STUB is not a preload and does not patch the named contributor unit before route/job registration. In src/index.ts, createApiServer(...) completes at lines 130-159 before the new apiServer.addHook('preHandler', ...) block at lines 161-191. createApiServer registers all route groups in src/api/server.ts lines 138-226 before returning, so this is a late Fastify request hook that rewrites selected HTTP responses, not a contributor/module patch before registration.
THE FIX: Move the stub mechanism into a real pre-registration path: either pass a FENCE_STUB stub registry/dependency into createApiServer before the register*Routes calls, or load a Node/tsx preload before src/index.ts imports/registers the relevant modules. The mapping must patch the contributor unit/service/route registration behavior before routes and jobs are registered, with the Playwright assertions left unchanged.
WHY THE LAST ATTEMPT MISSED IT: It removed the external proxy but recreated the same boundary interception inside Fastify after the app was already built.

FINDING 2 of 2
WHAT FAILED: The F1 negative-control mapping is disconnected from the expected failure. fence-contract.json expects FENCE_STUB=F1 on F7 to fail G3, but src/index.ts lines 186-189 intercept only /api/agent-group-switcher. e2e/command-center-window-fence.spec.ts lines 36-38 defines G3 as visibility of [data-testid="refresh-from-session"], and rg finds no product or spec call to /api/agent-group-switcher outside the stub itself, so this path cannot intentionally force the named G3 assertion when the F7 positive journey is otherwise green.
THE FIX: Map F1 to the actual contributor that controls the refresh-from-session surface or its backing session-refresh data path, and patch that unit before the page renders. If F1 is not the correct contributor for G3, update fence-contract.json's expected_negative_fail_ids/stub mapping to a contributor whose replacement reaches G3 through the same UI assertion.
WHY THE LAST ATTEMPT MISSED IT: It copied the old URL-handler shape without verifying that each stub target intersects its contract's named assertion.
```
**Do this before inventing anything.** A slice spent four attempts each inventing a different mechanism while this file sat unread, and closed on the first attempt that had it. If the prescription is WRONG, say why in your callback — that is a finding worth more than a fifth invention.

## BRAIN DIRECTION — intercept at the MODULE-LOAD / PROXY boundary, not per-method
Your interception is being bypassed because you patch methods AFTER the module is loaded, so a reference captured before the patch (`const w = fs.writeFile; w(...)`), a wrapper, or a fresh `require('fs')` escapes it. Catch aliases at the boundary itself:
- Intercept at RESOLUTION: wrap `Module._load` (or a `--loader`) so EVERY `require('fs'|'child_process'|'net'|'http'|'https')` returns a **Proxy** whose traps route through your interceptor — an alias of a proxied member is still the proxied member.
- For `globalThis.fetch`/timers, replace the global with a Proxy and assert no un-trapped global remains.
- The harness's own invariant test must PROVE an alias/wrapper attempt is caught (that is `AC-R8.1`'s 'alias/wrapper attempts are caught'), driving the REAL adapter boundary — not a mock of it.

Address EVERY finding in the prescription — if it lists FINDING 1 of 3, all three land in this one attempt. Leaving one for later does not defer it, it re-spends a whole cycle rediscovering it. If it says the real path is *untested/mocked/no-op*, you MUST write tests that drive the **ACTUAL** overmind code (the real watcher/completion/ingestion path) end-to-end — **do NOT mock, stub, or no-op the thing under test**; a test that asserts a mock is exactly the FAIL. Fix ALL of the listed findings and NOTHING beyond them — 'do not widen scope' means do not go past the prescription, never 'fix only the first item in it'. Re-run the focused tests, then re-commit atomically **with the slice id in the commit SUBJECT** — `feat(A0): <summary>` or `[A0] <summary>`. An untagged subject is read as a foreign commit and this slice parks again, exactly as it would on attempt 1. Then emit:
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.
`[projcore callback] implementer A0 STATUS: DONE — commit <new sha> <one line: what changed, max 100 chars>`

---

## THE SLICE (unchanged since attempt 1 — this is not the correction)

### Scope
HARNESS-CORRECTNESS ONLY. Validator gates this row on `--harness-smoke` exit 0, NEVER on product A5. `acs` is HARNESS-SMOKE (not A5 — A5 stays B8/G2). Recovered HEAD still uses an HTTP proxy for FENCE_STUB (`scripts/cc-run-isolated.mjs` startStubProxy); remaining work: replace that with in-process Fastify preload so FENCE_STUB=ID patches the unit before route/job registration (INTERCEPTION_GAP). Also: every spec writes fence-report-v1.json in finally; `--gate` requires named expected_negative_fail_ids kind=assert (no synthesized ids); print reclaimed_bytes. Recovered commits already on HEAD (3439337). No product OVM removal.

### Acceptance criteria — the TEXT is the contract, the id is only its name
- **HARNESS-SMOKE** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO instead of implementing toward it** — that is a PLAN_DEFECT, and it is worth more than another attempt spent satisfying the wrong thing. **If a criterion states an OUTCOME but not a MECHANISM, name the mechanism you chose in your callback.** A correction that re-invents the mechanism is how a slice reaches attempt 6: four attempts inventing, then one with the prescription in hand.

### Focused tests
`FENCE_ID=B8 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --harness-smoke`
