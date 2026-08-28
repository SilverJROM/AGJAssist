# [projcore DIRECTION for this retry — apply this first]
HARNESS-SMOKE still satisfiable (plan-suspect C0 SOUND at 10:51Z). Not product AC drift, not a plan defect, not north. a4 remainder in validation/C0-fix-a4.md never ran: this RAISE is TOP RUNG on the pre-remainder attempt; budget already 6. HEAD is now F3 (e00ed40+), not afa783f35e. Cherry-pick refs/tiller/command-center-2026-08-26/C0 (6811b3f) onto CURRENT HEAD using harness files only: e2e/command-center-reminders-fence.spec.ts, e2e/run-command-center-playwright-fence.mjs, playwright.cc.config.ts, scripts/cc-run-isolated.mjs. DROP src/api/server.ts and src/web/public/app.js hunks from the cherry-pick — F3 owns app.js; C0 is HARNESS-CORRECTNESS ONLY. Then only: (1) commit scripts/cc-fire-due.mts so a clean checkout can fireDue; (2) remove spec if (FENCE_STUB===C3) throw — negative must be exact C5 kind=assert via ActiveRemindersView, must not 500 C4/C6; (3) parse audit details JSON string before solicit_message; (4) C5 positive: seed LITERAL_ACTIVE_C5 in the sheet current folder group then wait /active; (5) make positive C5 and C6 green before --gate. Do not re-litigate JWT/report-finally. Do not add product routes.

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

# THE SLICE — C0 (run command-center-2026-08-26)

## Scope (do ONLY this)
HARNESS-CORRECTNESS ONLY. Rewrite e2e/command-center-reminders-fence.spec.ts against the REAL C4 contract. Do not add product routes. Collect ALL of C1-C6 (do not abort after the first fail). Owner session required. C1 schema via DB/temp copy not GET /schema. C2 POST /api/agent-reminders with folder_group plus cadence_minutes plus recipients array. C3 fireDue into a real temp pane (not GET /due). C4 owner-gated GET /active. C5 UI sheet visible. C6 solicit reached only included panes. FENCE_STUB=C3 must force named C5 kind=assert red. Write fence-report-v1.json in finally with verdict_line tokens fence=C6 verdict=PASS or FAIL fault_class=none or implementation or plan. Budget 6 after a4 remaining gaps.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **HARNESS-SMOKE** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`FENCE_ID=C6 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs --gate`

## A PREVIOUS CYCLE OF THIS SLICE LEFT A PRESCRIPTION (verbatim)

```
FINDING 1 of 6
WHAT FAILED: The required C6 gate exits 1. `.fence-gate-pos.json` shows C5 and C6 failed in the positive run, and `.fence-gate-neg.json` shows C4, C5, and C6 failed in the negative run instead of the required C5-only failure.
THE FIX: Make the positive journey green first, then make the negative-control failure set exact. Mechanism: run the positive spec alone with `FENCE_REPORT_PATH=.fence-gate-pos.json FENCE_ID=C6 ...` and fix the first real C5/C6 assertion failures before rerunning `--gate`.
WHY THE LAST ATTEMPT MISSED IT: It improved earlier C1-C4/auth issues but did not close the positive C5/C6 path.

FINDING 2 of 6
WHAT FAILED: e2e/command-center-reminders-fence.spec.ts:48-53 calls `scripts/cc-fire-due.mts`, but that file is untracked and not part of commit 6811b3fa6ed8750a5004a0268df055831dbcb21f. A clean checkout of the commit cannot run the C3/C6 fireDue mechanism.
THE FIX: Commit `scripts/cc-fire-due.mts` or move the helper into an already tracked harness file. Mechanism: the helper must open `process.env.DB_PATH`, instantiate `AgentReminderScheduler` with real `TmuxService`, `SafetyService`, `AuditService`, `TerminalGroupsService`, and call `fireDue(userId, folderGroup)`.
WHY THE LAST ATTEMPT MISSED IT: The dirty worktree contained the helper, so local execution masked the missing committed artifact.

FINDING 3 of 6
WHAT FAILED: The C5 negative control is hardcoded in the spec at e2e/command-center-reminders-fence.spec.ts:162-164 with `if (FENCE_STUB === 'C3') throw ...`. That is not a mechanism-level C3 stub causing a UI assertion failure. Separately, the server-side C3 stub still makes `/api/agent-reminders/active` return 500 globally, causing C4 and C6 to fail in the negative run.
THE FIX: Remove the explicit FENCE_STUB throw from the spec. Mechanism: map FENCE_STUB=C3 to the C5 ActiveRemindersView data path only, or otherwise patch the C3 contributor so the browser-visible active-reminder row is absent while C4's owner-gated `/api/agent-reminders/active` probe and C6's post-fire checks still pass. The negative failed set must be exactly `[{"id":"C5","kind":"assert"}]`.
WHY THE LAST ATTEMPT MISSED IT: It forced a named red by branching on the stub flag rather than proving the stubbed dependency broke only C5.

FINDING 4 of 6
WHAT FAILED: C6 in e2e/command-center-reminders-fence.spec.ts:194-196 checks `e.details?.solicit_message`, but AuditService stores `details` as a JSON string. This makes the audit assertion fail even when the audit row exists with the expected serialized payload.
THE FIX: Parse audit `details` before asserting. Mechanism: for each audit entry, if `typeof e.details === "string"`, `JSON.parse(e.details)` and compare `details.solicit_message` to `LITERAL_SOLICIT_C6`; if the API route is intended to return parsed details, implement that in the route and assert the parsed public shape.
WHY THE LAST ATTEMPT MISSED IT: It assumed the API returned structured details without checking AuditService/query output.

FINDING 5 of 6
WHAT FAILED: This harness-only commit changes product files `src/api/server.ts` and `src/web/public/app.js`. The scope says HARNESS-CORRECTNESS ONLY and "Do not add product routes"; the product TEST_MODE routes from the prior attempt remain and this attempt changes app rendering to show `solicit_message`.
THE FIX: Keep C0 changes in harness-owned files only unless the plan explicitly changes scope. Mechanism: move `/api/db/tables` inspection into direct temp-DB reads as already done for C1, move fireDue invocation into the committed harness helper, and avoid product UI changes by asserting UI text that the existing app already renders or by closing the prerequisite C5 product slice separately.
WHY THE LAST ATTEMPT MISSED IT: It carried forward product-route/test-support changes from a previous failed attempt and added a product UI adjustment to satisfy the harness.

FINDING 6 of 6
WHAT FAILED: C5 positive gate still fails even though a separate validation screenshot can show the active reminder row under a manually controlled server. The mandated gate's positive report is authoritative and remains red.
THE FIX: Stabilize the C5 browser setup inside the actual fence spec. Mechanism: after creating `LITERAL_ACTIVE_C5`, wait for the app's `/api/agent-reminders/active` response after opening the terminal menu, then assert exactly one visible `[data-testid="active-reminder-row"]` contains `LITERAL_ACTIVE_C5`. If the app filters reminders by active group/current terminal, seed or select that exact group before opening the sheet.
WHY THE LAST ATTEMPT MISSED IT: It did not align the seeded reminder's folder group with the terminal sheet's active group/loading lifecycle in the mandated gate run.
```
**This row has been attempted before.** The finding above is from that cycle, not from you — read it before deciding your approach. It may be stale (the row may have been decomposed or repaired since); if it no longer applies, say so in your callback rather than working around it. Attempts that carried a prescription have passed at 25-27% against 17% for those that did not.

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=C0 attempt=1 role=implementer
  marker=DRV-C0-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY)
Build it, run the focused tests, then commit atomically **with the slice id in the commit SUBJECT as a delimited token** — `feat(C0): <summary>` or `[C0] <summary>`. Tiller binds your commit to this slice ONLY via that tag; an untagged subject is rejected as a foreign commit and the slice PARKS. ONLY after the commit lands, append ONE line to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] implementer C0 STATUS: DONE — commit <sha> <one line: what changed, max 100 chars>`
**Emit it in the SAME command as the commit**, so the callback cannot be lost if your turn ends at the commit — the `&&` keeps the ordering guarantee (nothing is appended unless the commit succeeded):
```sh
git commit -m '[C0] <summary>' \
  && printf '%s\n' '[projcore callback] implementer C0 STATUS: DONE — commit '"$(git rev-parse --short HEAD)"' <what changed>' >> /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md
```
Use BLOCKED only if you genuinely could NOT commit (never after a successful commit): `[projcore callback] implementer C0 STATUS: BLOCKED — <reason>`. Do not widen scope.
