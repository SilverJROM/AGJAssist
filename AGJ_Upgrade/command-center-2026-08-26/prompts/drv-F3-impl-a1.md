# [projcore DIRECTION for this retry — apply this first]
[north] PLAN_SOUND: I1/I2 (refresh re-renders transcript AND never blocks the composer) is correct and SATISFIABLE — not criterion drift, do not re-plan, do not re-raise as plan-defect. Carry validation/F3-fix-a4.md only: (1) refreshOutput() must not use incremental applyConversationSnapshot that preserves prior rendered output; add processRefreshSnapshot(latest) that rebuilds snapshot/entries/statusLine/lastUpdatedAt from applyAgentPatch(conversationSeed(...), latest) and call it from refreshOutput(); (2) focused test initial /output fixture must be non-empty 'initial output fixture'; after refresh assert transcript contains 'refreshed output fixture' and not the initial (repeat for search-open). Cherry-pick refs/tiller/command-center-2026-08-26/F3 (fe71264) first. Plan budget now 6, impl_tier L4 so after L1 the informed attempts are sol.

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

# THE SLICE — F3 (run command-center-2026-08-26)

## Scope (do ONLY this)
Web UI layer: always-reachable refresh control on `FriendlyTerminalView`; re-pull pane output and session metadata together; in-progress then completion; composer stays interactive. Project `cc` supplies live API/tmux. North 2026-08-27 PLAN_SOUND: I1/I2 satisfiable; after L1 resume at L4 (sol) with budget 6 so >=2 strong informed attempts on the a4 remainder.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **I1** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **I2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`npx playwright test e2e/command-center-refresh.spec.ts --project=cc`

## A PREVIOUS CYCLE OF THIS SLICE LEFT A PRESCRIPTION (verbatim)

```
FINDING 1 of 2
WHAT FAILED: Explicit refresh fetches pane output but does not update the rendered transcript when the pane already has non-empty output. The attempt 4 probe recorded the refresh request `/output?lines=2000&refresh=1` returning `refreshed output fixture`, followed by background polls also returning it, but `normalAfter.conversationText` remained `initial output fixture`; the same happened for `search refresh output fixture` in the search-open branch.
THE FIX: Add an explicit refresh output rendering path in `FriendlyTerminalView`. One concrete mechanism is to change `refreshOutput()` so after fetching and normalizing the latest output, it forces the visible conversation seed to be rebuilt from the latest snapshot instead of going through the incremental `applyConversationSnapshot` path that preserves the previous no-user agent. For example, create `processRefreshSnapshot(latest)` that updates `snapshotRef`, `snapshot`, `previousSnapshotRef`, `lastUpdatedAt`, `statusLine`, and `entries` from `applyAgentPatch(conversationSeed(readTerminalMemory(target) || {}), latest)` or an equivalent fresh parse of the latest snapshot, then call that from `refreshOutput()`.
WHY THE LAST ATTEMPT MISSED IT: The focused test used an empty initial output fixture, so there was no existing rendered agent output to replace.

FINDING 2 of 2
WHAT FAILED: The focused test does not discriminate the existing-output refresh case. Its initial non-refresh output fixture is `''`, so it would pass even when explicit refresh fetches a new snapshot but leaves a prior non-empty transcript visible.
THE FIX: In `e2e/command-center-refresh.spec.ts`, make the initial `/output` fixture a literal non-empty value such as `initial output fixture`; assert the transcript initially contains that value, then after the normal refresh assert it contains `refreshed output fixture` and no longer contains `initial output fixture`. Repeat the same replacement assertion for the search-open refresh using `search refresh output fixture`.
WHY THE LAST ATTEMPT MISSED IT: It verified request counts and lifecycle state, but not visible replacement from a previously rendered pane snapshot.
```
**This row has been attempted before.** The finding above is from that cycle, not from you — read it before deciding your approach. It may be stale (the row may have been decomposed or repaired since); if it no longer applies, say so in your callback rather than working around it. Attempts that carried a prescription have passed at 25-27% against 17% for those that did not.

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=F3 attempt=1 role=implementer
  marker=DRV-F3-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY)
Build it, run the focused tests, then commit atomically **with the slice id in the commit SUBJECT as a delimited token** — `feat(F3): <summary>` or `[F3] <summary>`. Tiller binds your commit to this slice ONLY via that tag; an untagged subject is rejected as a foreign commit and the slice PARKS. ONLY after the commit lands, append ONE line to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] implementer F3 STATUS: DONE — commit <sha> <one line: what changed, max 100 chars>`
**Emit it in the SAME command as the commit**, so the callback cannot be lost if your turn ends at the commit — the `&&` keeps the ordering guarantee (nothing is appended unless the commit succeeded):
```sh
git commit -m '[F3] <summary>' \
  && printf '%s\n' '[projcore callback] implementer F3 STATUS: DONE — commit '"$(git rev-parse --short HEAD)"' <what changed>' >> /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md
```
Use BLOCKED only if you genuinely could NOT commit (never after a successful commit): `[projcore callback] implementer F3 STATUS: BLOCKED — <reason>`. Do not widen scope.
