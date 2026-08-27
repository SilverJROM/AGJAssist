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

# THE SLICE — A0 (run command-center-2026-08-26)

## Scope (do ONLY this)
HARNESS-CORRECTNESS ONLY. Validator gates this row on `--harness-smoke` exit 0, NEVER on product A5. `acs` is HARNESS-SMOKE (not A5 — A5 stays B8/G2). Recovered HEAD still uses an HTTP proxy for FENCE_STUB (`scripts/cc-run-isolated.mjs` startStubProxy); remaining work: replace that with in-process Fastify preload so FENCE_STUB=ID patches the unit before route/job registration (INTERCEPTION_GAP). Also: every spec writes fence-report-v1.json in finally; `--gate` requires named expected_negative_fail_ids kind=assert (no synthesized ids); print reclaimed_bytes. Recovered commits already on HEAD (3439337). No product OVM removal.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **HARNESS-SMOKE** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`FENCE_ID=B8 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --harness-smoke`

## A PREVIOUS CYCLE OF THIS SLICE LEFT A PRESCRIPTION (verbatim)

```
FINDING 1 of 5
WHAT FAILED: Only e2e/command-center-ovm-fence.spec.ts writes fence-report-v1.json from a finally block. The reminders/summaries/wakeup/window specs still throw from check() before their final fs.writeFileSync, so a failed non-B8 run leaves stale report data. Confirmed with `FENCE_STUB=C3 FENCE_ID=C6 ...`: Playwright failed `FENCE_ASSERT:C1`, but fence-report-v1.json still contained B8 A1/A2/A3/A4/A5/B1/B2 data with only the verdict_line rewritten to C6.
THE FIX: Apply the OVM spec's try/catch/finally + final `expect(failed).toEqual([])` pattern to e2e/command-center-reminders-fence.spec.ts, e2e/command-center-summaries-fence.spec.ts, e2e/command-center-wakeup-fence.spec.ts, and e2e/command-center-window-fence.spec.ts so every failed journey writes its own collected/passed/failed report before throwing.
WHY THE LAST ATTEMPT MISSED IT: The attempt fixed the B8 smoke spec only, but A0 owns all five fence journeys.

FINDING 2 of 5
WHAT FAILED: FENCE_STUB coverage is B8-only. scripts/cc-run-isolated.mjs defines a handler only for B2, while fence-contract.json also requires C3, D3, E2, and F1 negative controls to replace contributors and fail on C5, E1, D3, and G3 respectively.
THE FIX: Add explicit stub mechanisms for C3, D3, E2, and F1 in the same harness path used by B2; each handler must alter the public assertion surface so the selected fence records the contract's expected_negative_fail_ids with kind "assert".
WHY THE LAST ATTEMPT MISSED IT: It implemented the focused B8/B2 control but did not expand the mechanism across the full five-fence contract.

FINDING 3 of 5
WHAT FAILED: e2e/run-command-center-playwright-fence.mjs --gate still treats any negative nonzero exit as a valid negative. Lines 91-98 do not read the negative report or verify expected_negative_fail_ids/expected_negative_kind, and line 96 synthesizes the expected failure id even if the actual failure was import/env/not_found or a different assert.
THE FIX: In --gate, run positive and negative with separate FENCE_REPORT_PATH files, read the negative report, and require every id in fence.expected_negative_fail_ids to appear with fence.expected_negative_kind before exiting 0 or writing those failures to fence-report-v1.json.
WHY THE LAST ATTEMPT MISSED IT: The named-report validation was added to --harness-smoke but not to --gate.

FINDING 4 of 5
WHAT FAILED: The FENCE_STUB mechanism is a port-3210 HTTP proxy in scripts/cc-run-isolated.mjs, not an in-process contributor replacement. The scope requires `FENCE_STUB=<contributor>` to replace that unit in-process before the same assertions; the proxy only rewrites selected HTTP paths and cannot replace module behavior, background jobs, DB writes, or WebSocket paths inside Fastify.
THE FIX: Load a test-mode stub registry/preload inside the Fastify process launched from src/index.ts, map FENCE_STUB to the contributor unit from fence-contract.json, and patch that module/function before route registration or job execution; keep the Playwright assertions unchanged.
WHY THE LAST ATTEMPT MISSED IT: It solved page.request interception at the network boundary instead of replacing the contributor unit in the application process.

FINDING 5 of 5
WHAT FAILED: `node scripts/cc-run-isolated.mjs --serve` deletes the temp DB on cleanup but does not print reclaimed_bytes. The focused harness output contains no reclaimed_bytes line from the serve-mode isolated runner, even though the slice requires the isolated runner to delete temp DB/server and print reclaimed_bytes.
THE FIX: Track the copied temp DB size in serve mode and print `reclaimed_bytes=<bytes>` from the cleanup path before process exit, without suppressing Playwright teardown.
WHY THE LAST ATTEMPT MISSED IT: reclaimed_bytes was implemented only for the non-serve command wrapper path.
```
**This row has been attempted before.** The finding above is from that cycle, not from you — read it before deciding your approach. It may be stale (the row may have been decomposed or repaired since); if it no longer applies, say so in your callback rather than working around it. Attempts that carried a prescription have passed at 25-27% against 17% for those that did not.

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=A0 attempt=1 role=implementer
  marker=DRV-A0-24 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY)
Build it, run the focused tests, then commit atomically **with the slice id in the commit SUBJECT as a delimited token** — `feat(A0): <summary>` or `[A0] <summary>`. Tiller binds your commit to this slice ONLY via that tag; an untagged subject is rejected as a foreign commit and the slice PARKS. ONLY after the commit lands, append ONE line to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] implementer A0 STATUS: DONE — commit <sha> <one line: what changed, max 100 chars>`
**Emit it in the SAME command as the commit**, so the callback cannot be lost if your turn ends at the commit — the `&&` keeps the ordering guarantee (nothing is appended unless the commit succeeded):
```sh
git commit -m '[A0] <summary>' \
  && printf '%s\n' '[projcore callback] implementer A0 STATUS: DONE — commit '"$(git rev-parse --short HEAD)"' <what changed>' >> /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md
```
Use BLOCKED only if you genuinely could NOT commit (never after a successful commit): `[projcore callback] implementer A0 STATUS: BLOCKED — <reason>`. Do not widen scope.
