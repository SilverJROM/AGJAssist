# [projcore DIRECTION for this retry — apply this first]
EXIT 09:55:16Z D0-a10 unparked then immediately re-parked: fences_for(D0) included D7 because D0 was in D7 plan deps, and parked fence D7 has no OPEN (retired to .pre-reprepare; post-PREPARE OPEN is vacuous because D1-D6 already landed). D0 is harness-author, not a product unit. Plan D7 deps no longer list D0; D7 stays parked until advance-D0.marker. Standing D0.txt: port summaries-fence from 8a0ebc5 / D0-fix-a3.md onto HEAD 241b5cf; do NOT wholesale cherry-pick 8a0ebc5 (would revert F4-F6). Keep cc-capture-reply.mts. FENCE_STUB=D3 named-red E1. Not a new north question.

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

# THE SLICE — D0 (run command-center-2026-08-26)

## Scope (do ONLY this)
HARNESS-CORRECTNESS ONLY. Rewrite e2e/command-center-summaries-fence.spec.ts against the real D4 owner-gated contract plus the closed-C6 solicit-reply arrival fixture. Do not invent unauth GET /api/summary-endpoints 200, GET /api/agent-summaries, or GET /api/summary-endpoints/default. Use FENCE_ORIGIN and OWNER_TOKEN. Collect ALL of E1,E2,E3,F1,F2,F3. FENCE_STUB=D3 named-red on E1 kind=assert. Write fence-report-v1.json in finally. Do not add product routes. North 2026-08-28 PLAN_SOUND: carry validation/D0-fix-a3.md.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **HARNESS-SMOKE** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`FENCE_ID=D7 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate`

## A PREVIOUS CYCLE OF THIS SLICE LEFT A PRESCRIPTION (verbatim)

```
FINDING 1 of 2
WHAT FAILED: The focused D7 gate failed in e2e/command-center-summaries-fence.spec.ts E1. The positive run timed out at Playwright's 60000ms test timeout and wrote failed E1 kind=assert because no `LITERAL_SUMMARY_FOR_TEST` row appeared in GET /api/summary-agents/<unique-agent>/summaries.
THE FIX: Make E1 use an actual summary-creation mechanism that exists in the application under test. If the intended production arrival path is service-level, invoke it through a real app-owned CLI/API hook rather than a Playwright-local import; if the intended path is UI/API, add/use the concrete route or script that captures a tmux pane reply and calls ReplySummaryService with that captured text. The harness should then create/fire the C6 reminder, produce the pane reply, trigger that concrete capture mechanism, and poll only the public /api/summary-agents/<unique-agent>/summaries read path for `LITERAL_SUMMARY_FOR_TEST`.
WHY THE LAST ATTEMPT MISSED IT: It assumed opening the summaries dropdown generated summaries, but the UI only reads existing summaries.

FINDING 2 of 2
WHAT FAILED: e2e/command-center-summaries-fence.spec.ts currently waits 10000ms plus up to 120 polling iterations inside one Playwright test whose default timeout is 60000ms. When the summary is missing, the named assertion is masked by a test timeout before the intended polling budget completes.
THE FIX: Set an explicit test timeout large enough for the harness path, or reduce the E1 polling/wait budget so the named E1 assertion fails before Playwright's test-level timeout. Keep the outer command timeout wrapper unchanged.
WHY THE LAST ATTEMPT MISSED IT: It increased the poll loop from 60 to 120 without increasing the Playwright test timeout.
```
**This row has been attempted before.** The finding above is from that cycle, not from you — read it before deciding your approach. It may be stale (the row may have been decomposed or repaired since); if it no longer applies, say so in your callback rather than working around it. Attempts that carried a prescription have passed at 25-27% against 17% for those that did not.

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=D0 attempt=1 role=implementer
  marker=DRV-D0-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY)
Build it, run the focused tests, then commit atomically **with the slice id in the commit SUBJECT as a delimited token** — `feat(D0): <summary>` or `[D0] <summary>`. Tiller binds your commit to this slice ONLY via that tag; an untagged subject is rejected as a foreign commit and the slice PARKS. ONLY after the commit lands, append ONE line to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] implementer D0 STATUS: DONE — commit <sha> <one line: what changed, max 100 chars>`
**Emit it in the SAME command as the commit**, so the callback cannot be lost if your turn ends at the commit — the `&&` keeps the ordering guarantee (nothing is appended unless the commit succeeded):
```sh
git commit -m '[D0] <summary>' \
  && printf '%s\n' '[projcore callback] implementer D0 STATUS: DONE — commit '"$(git rev-parse --short HEAD)"' <what changed>' >> /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md
```
Use BLOCKED only if you genuinely could NOT commit (never after a successful commit): `[projcore callback] implementer D0 STATUS: BLOCKED — <reason>`. Do not widen scope.
