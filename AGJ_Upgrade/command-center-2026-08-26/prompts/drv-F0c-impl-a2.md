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

# [driver] F0c CORRECTION (attempt 2) — fix EVERY finding the validator listed


## ⚠ STANDING DIRECTION FROM THE COORDINATOR — applies to THIS attempt too

[projcore] After F0b. One named-red per G1-J2 via FENCE_STUB=<AC> perturbing the public path — not FENCE_STUB_G* and not throw-in-check. Remap fence-contract.json F7 expected_negative_fail_ids / negative_control_cmd to a server-backed contributor (I1 pane-output refresh). Remove any early if (FENCE_STUB===F1) throw in the I1 callback. Prefer contract remap over product server.ts. F1-F6 frozen. Gate: FENCE_ID=F7 --gate.

**This is a constraint, not background.** It was written after a previous attempt and it still binds: if it forbids something, the fix that does it is wrong even when the tests go green.
The independent validator FAILed F0c: defect_class=TEST_NOT_DISCRIMINATING gate=None.
**Validator's callback summary:** [projcore callback] validator F0c STATUS: DONE — FAIL gate green; red-team finds throw-in-check and missing per-AC stubs

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
FINDING 1 of 2
WHAT FAILED: The I1 named-red is implemented as a throw-in-check. `e2e/command-center-window-fence.spec.ts:290-298` installs a pane-output refresh route, but `e2e/command-center-window-fence.spec.ts:306-309` throws `FENCE_STUB=I1 forces I1 failure` before clicking `[data-testid="terminal-refresh"]`. The negative report `validation/F0c-gate-neg-drv21-a1.json` therefore proves the direct throw branch, not the public `/api/tmux/panes/:target/output?...refresh=...` path required by scope.
THE FIX: Remove the `if (FENCE_STUB === 'I1') throw ...` branch from the I1 check. Keep the route perturbation, make the route match the actual refresh request shape issued by the product, click `[data-testid="terminal-refresh"]`, and assert the product-visible refreshed transcript/detail state so the route-level failure naturally records exactly `{ "id": "I1", "kind": "assert" }`.
WHY THE LAST ATTEMPT MISSED IT: It added a real-looking route stub but made the gate pass by short-circuiting the assertion before that stub could be exercised.

FINDING 2 of 2
WHAT FAILED: F0c scope required one named-red per G1-J2 via `FENCE_STUB=<AC>` that perturbs the public path. `rg FENCE_STUB e2e/command-center-window-fence.spec.ts` shows only `I1`; there are no named public-path perturbations for G1, G2, G3, H1, H2, H3, I2, J1, or J2.
THE FIX: Add AC-id stubs for every remaining acceptance id: `FENCE_STUB=G1`, `G2`, `G3`, `H1`, `H2`, `H3`, `I2`, `J1`, and `J2`. Each branch must alter the concrete specimen consumed by that assertion, such as draft storage/session selection for G ids, collapsed/header viewport state for H ids, refresh/composer request timing for I2, and dropdown/scrubber tab specimens for J ids. Do not use `FENCE_STUB_G*` names and do not throw directly inside `check()`; the public UI/API path must make the matching existing assertion fail.
WHY THE LAST ATTEMPT MISSED IT: It closed only the contract-selected I1 negative gate and did not implement the per-AC named-red matrix required by the F0c scope.
```
**Do this before inventing anything.** A slice spent four attempts each inventing a different mechanism while this file sat unread, and closed on the first attempt that had it. If the prescription is WRONG, say why in your callback — that is a finding worth more than a fifth invention.

Address EVERY finding in the prescription — if it lists FINDING 1 of 3, all three land in this one attempt. Leaving one for later does not defer it, it re-spends a whole cycle rediscovering it. If it says the real path is *untested/mocked/no-op*, you MUST write tests that drive the **ACTUAL** overmind code (the real watcher/completion/ingestion path) end-to-end — **do NOT mock, stub, or no-op the thing under test**; a test that asserts a mock is exactly the FAIL. Fix ALL of the listed findings and NOTHING beyond them — 'do not widen scope' means do not go past the prescription, never 'fix only the first item in it'. Re-run the focused tests, then re-commit atomically **with the slice id in the commit SUBJECT** — `feat(F0c): <summary>` or `[F0c] <summary>`. An untagged subject is read as a foreign commit and this slice parks again, exactly as it would on attempt 1. Then emit:
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.
`[projcore callback] implementer F0c STATUS: DONE — commit <new sha> <one line: what changed, max 100 chars>`

---

## THE SLICE (unchanged since attempt 1 — this is not the correction)

### Scope
HARNESS-CORRECTNESS ONLY. After F0b, add one named-red per G1-J2 via FENCE_STUB=<AC> that perturbs the public path (not FENCE_STUB_G* or throw-in-check). Remap fence-contract.json F7 expected_negative_fail_ids / negative_control_cmd to a server-backed contributor (I1 pane-output refresh, not F1 client-only). Collect ALL G1-J2. Write fence-report-v1.json in finally. Do not implement product UI.

### Acceptance criteria — the TEXT is the contract, the id is only its name
- **HARNESS-SMOKE** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO instead of implementing toward it** — that is a PLAN_DEFECT, and it is worth more than another attempt spent satisfying the wrong thing. **If a criterion states an OUTCOME but not a MECHANISM, name the mechanism you chose in your callback.** A correction that re-invents the mechanism is how a slice reaches attempt 6: four attempts inventing, then one with the prescription in hand.

### Focused tests
`FENCE_ID=F7 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate`
