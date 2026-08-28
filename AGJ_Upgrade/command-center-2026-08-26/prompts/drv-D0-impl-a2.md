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

# [driver] D0 CORRECTION (attempt 2) — fix EVERY finding the validator listed


## ⚠ STANDING DIRECTION FROM THE COORDINATOR — applies to THIS attempt too

[north] PLAN_SOUND: F-SUMMARIES ACs SATISFIABLE — do not re-plan, do not re-suspect, do not split. Carry validation/D0-fix-a3.md in full. Park rolled HEAD to b1d8258; cherry-pick refs/tiller/command-center-2026-08-26/D0 (8a0ebc5, includes e88a200 and 5a54514) first. Stay on sonnet5 for this retry (a4). ONLY: (1) trigger the REAL create-path — fire closed-C6 reminder solicit into a temp pane, capture pane reply, ReplySummaryService via app-owned hook/route (not Playwright-local import) against the deterministic OpenAI-compatible fixture returning LITERAL_SUMMARY_FOR_TEST, persist, THEN poll only public GET /api/summary-agents/<agent>/summaries for that literal; (2) set explicit Playwright per-test timeout large enough OR trim E1 poll budget so named E1 kind=assert fails BEFORE 60000ms test timeout; keep outer command-timeout wrapper unchanged. Keep FENCE_STUB=D3 named-red on E1. Do not add product routes. Commit with [D0] tag then callback DONE immediately — a4 parked SLICE-TOO-BIG at 1800s still-working; do not sit at the prompt. If this FULL a3 direction still fails, escalate to sol/opus5 (a5) with budget 8. Do not re-plan ACs.

[what_validator_missed]
HARNESS-SMOKE is satisfiable. a3 named two concrete harness bugs, not AC drift: (1) dropdown only READS summaries — E1 must fire closed-C6 into a temp pane, capture the pane reply, run ReplySummaryService via a real app-owned hook against the deterministic OpenAI-compatible fixture returning LITERAL_SUMMARY_FOR_TEST, persist, then poll only GET /api/summary-agents/<agent>/summaries; no Playwright-local import. (2) E1 named assert is masked by Playwright 60000ms — set an explicit per-test timeout or trim the 10s+120-poll budget so kind=assert fails first; keep the outer command-timeout wrapper.

**This is a constraint, not background.** It was written after a previous attempt and it still binds: if it forbids something, the fix that does it is wrong even when the tests go green.
The independent validator FAILed D0: defect_class=IMPL_INCOMPLETE gate=None.
**Validator's callback summary:** [projcore callback] validator D0 STATUS: DONE — FAIL focused D7 positive still fails E1; missing real create path

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
FINDING 1 of 1
WHAT FAILED: The focused D7 gate failed its positive run in e2e/command-center-summaries-fence.spec.ts E1. After creating/firing the C6 reminder, sending a real tmux pane reply, patching the default endpoint to the local OpenAI fixture, and opening the summaries UI, GET /api/summary-agents/<unique-agent>/summaries never returned `LITERAL_SUMMARY_FOR_TEST`; .fence-gate-pos.json and fence-report-v1.json both show failed E1 kind=assert with no passed ids.
THE FIX: Replace the "open summaries dropdown" step with an app-owned reply capture/summarization mechanism that actually exists. Mechanism: after scripts/cc-fire-due.mts sends the solicit and the test writes the reply into the same tmux pane, invoke a real project script/API/service hook that captures the pane output after the solicit marker and calls ReplySummaryService with that captured text, using the default summary endpoint already patched to the local /v1/chat/completions fixture. Then poll only GET /api/summary-agents/<unique-agent>/summaries for the literal `LITERAL_SUMMARY_FOR_TEST` row and keep the FENCE_STUB=D3 negative path red through the real /api/summary-endpoints dependency. Do not insert agent_summaries directly, do not import ReplySummaryService in the Playwright spec, and do not treat the summaries dropdown as a create path because it only reads existing summaries.
WHY THE LAST ATTEMPT MISSED IT: It fixed the timeout/poll budget but left the prior missing create-path intact.
```
**Do this before inventing anything.** A slice spent four attempts each inventing a different mechanism while this file sat unread, and closed on the first attempt that had it. If the prescription is WRONG, say why in your callback — that is a finding worth more than a fifth invention.

Address EVERY finding in the prescription — if it lists FINDING 1 of 3, all three land in this one attempt. Leaving one for later does not defer it, it re-spends a whole cycle rediscovering it. If it says the real path is *untested/mocked/no-op*, you MUST write tests that drive the **ACTUAL** overmind code (the real watcher/completion/ingestion path) end-to-end — **do NOT mock, stub, or no-op the thing under test**; a test that asserts a mock is exactly the FAIL. Fix ALL of the listed findings and NOTHING beyond them — 'do not widen scope' means do not go past the prescription, never 'fix only the first item in it'. Re-run the focused tests, then re-commit atomically **with the slice id in the commit SUBJECT** — `feat(D0): <summary>` or `[D0] <summary>`. An untagged subject is read as a foreign commit and this slice parks again, exactly as it would on attempt 1. Then emit:
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.
`[projcore callback] implementer D0 STATUS: DONE — commit <new sha> <one line: what changed, max 100 chars>`

---

## THE SLICE (unchanged since attempt 1 — this is not the correction)

### Scope
HARNESS-CORRECTNESS ONLY. Rewrite e2e/command-center-summaries-fence.spec.ts against the real D4 owner-gated contract plus the closed-C6 solicit-reply arrival fixture. Do not invent unauth GET /api/summary-endpoints 200, GET /api/agent-summaries, or GET /api/summary-endpoints/default. Use FENCE_ORIGIN and OWNER_TOKEN. Collect ALL of E1,E2,E3,F1,F2,F3. FENCE_STUB=D3 named-red on E1 kind=assert. Write fence-report-v1.json in finally. Do not add product routes. North 2026-08-28 PLAN_SOUND: carry validation/D0-fix-a3.md (real C6 create-path + E1 timeout).

### Acceptance criteria — the TEXT is the contract, the id is only its name
- **HARNESS-SMOKE** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO instead of implementing toward it** — that is a PLAN_DEFECT, and it is worth more than another attempt spent satisfying the wrong thing. **If a criterion states an OUTCOME but not a MECHANISM, name the mechanism you chose in your callback.** A correction that re-invents the mechanism is how a slice reaches attempt 6: four attempts inventing, then one with the prescription in hand.

### Focused tests
`FENCE_ID=D7 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate`
