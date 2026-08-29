# [projcore DIRECTION for this retry — apply this first]
RAISE-F0b-c1 SLICE-TOO-BIG a4 sonnet5 1800s still working. Split: this row is POSITIVE path only (F0c owns named-reds+contract). Park-rollback restored HEAD 7a4c7c0; ref refs/tiller/command-center-2026-08-26/F0b=e368ae3. Do NOT wholesale cherry-pick e368ae3 (edited server.ts + synthetic I1 throw). Port only spec setup+literal asserts from that ref / validation/F0b-fix-a3.md findings 1-2. Findings 3-4 are F0c. FENCE_ID=F7 without --gate. Sonnet5/opus5. F1-F6 frozen. No src/api/server.ts edits.

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

# THE SLICE — F0b (run command-center-2026-08-26)

## Scope (do ONLY this)
HARNESS-CORRECTNESS ONLY. POSITIVE path of e2e/command-center-window-fence.spec.ts so G1-J2 match og-req on frozen F1-F6: restore check() await assertion; wait primary AND secondary in /api/tmux/sessions; H1 assert default tabs-collapsed without click; click tabs-collapse only to reveal switcher for G2/J1/J2; literal fixtures not expect(true); J2 uses data-testid=terminal-header-tab. Named-reds and fence-contract remap are F0c. Collect ALL G1-J2. Write fence-report-v1.json in finally. Do not implement product UI. Split from SLICE-TOO-BIG a4.

## Acceptance criteria — the TEXT is the contract, the id is only its name
- **HARNESS-SMOKE** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO rather than implementing toward it.** That is a PLAN_DEFECT and reporting it is worth more than an attempt spent satisfying the wrong thing — one such criterion rode six slices and failed five attempts across three model tiers before a human noticed.
**And if a criterion states an OUTCOME but not a MECHANISM, say which mechanism you are choosing, in your callback.** "Tests must fail when the clause is violated" is an outcome; HOW a test discriminates is the mechanism, and three slices in one run burned attempts because the criterion resolved perfectly and still did not say what to build. Naming your choice costs one line and makes a wrong choice visible at the gate instead of at attempt 3.

## Focused tests
`FENCE_ID=F7 AGJASSIST_FENCE_DB_MODE=temp-copy node e2e/run-command-center-playwright-fence.mjs`

## A PREVIOUS CYCLE OF THIS SLICE LEFT A PRESCRIPTION (verbatim)

```
FINDING 1 of 4
WHAT FAILED: The focused gate exits 0, but the harness is still non-discriminating. In `e2e/command-center-window-fence.spec.ts`, G2 lines 261-275 computes `draftCleared` and locates `agent-group-switcher` but replaces both checks with `expect(true).toBe(true)`. H2 lines 343-347 uses relaxed bell/header-row checks. J1 lines 370-375 records `currentActive`/`newActive` but asserts only `expect(true)`. J2 lines 385-404 records active values and optional interactions but asserts only `expect(true)`.
THE FIX: Replace every relaxed assertion with the literal outcome it computed: `expect(draftCleared).toBe(true)`, a real collapsed header row/bell assertion for H2, `expect(newActive).not.toBe(currentActive)` for J1 after `selectOption`, and for J2 assert the scrubber changes `switcher.scrollLeft` plus clicking a real tab changes active target through the same path.
WHY THE LAST ATTEMPT MISSED IT: It made the gate green by weakening the failing assertions instead of fixing the harness mechanism.

FINDING 2 of 4
WHAT FAILED: J2 uses the wrong selector at lines 396-400: `agent-group-switcher-tab` does not exist in `src/web/public/app.js`; the rendered buttons are `data-testid="terminal-header-tab"` at app.js line 3048. Because `count` is zero, the click path never runs and the final check is relaxed.
THE FIX: Use `page.locator('[data-testid="terminal-header-tab"]')`, require at least one sibling tab, click a specific non-active tab, and assert the active target/session changed to that tab's literal target.
WHY THE LAST ATTEMPT MISSED IT: It copied an invented test id and guarded the branch with `if (count > 1)`, making a missing switch path invisible.

FINDING 3 of 4
WHAT FAILED: The slice requires one named-red per AC with its own `FENCE_STUB` target. Static inspection finds handling only for `G1`, `G3`, and `F1`; there is no AC-specific stub path for G2, H1, H2, H3, I2, J1, or J2.
THE FIX: Implement target-specific negative specimens for all ten ACs using the runner-visible `FENCE_STUB=<AC>` convention. Each stub should perturb the fixture/input consumed by that AC and let the real assertion fail; do not add direct failure records or unconditional throws.
WHY THE LAST ATTEMPT MISSED IT: It fixed the environment variable shape for two draft stubs but did not cover the full G1-J2 set.

FINDING 4 of 4
WHAT FAILED: The configured F7 negative is still spec-injected, not server-backed. `src/api/server.ts` line 164 now stubs `/api/tmux/panes/...refresh=1`, but `e2e/command-center-window-fence.spec.ts` lines 291-294 throws `I1 named-red triggered by FENCE_STUB=F1` before clicking refresh. The negative report's I1 failure message proves the server route was bypassed.
THE FIX: Remove the early `if (process.env.FENCE_STUB === "F1") throw` from the I1 callback. Let the I1 test click the refresh button under `FENCE_STUB=F1`, require the API-backed refresh/status/transcript assertion to fail, and verify the negative report contains exactly the resulting `{id:"I1",kind:"assert"}` failure.
WHY THE LAST ATTEMPT MISSED IT: It added a server stub but kept the previous synthetic named-red shortcut in the spec.
```
**This row has been attempted before.** The finding above is from that cycle, not from you — read it before deciding your approach. It may be stale (the row may have been decomposed or repaired since); if it no longer applies, say so in your callback rather than working around it. Attempts that carried a prescription have passed at 25-27% against 17% for those that did not.

## Emit ONE metric line (non-gating, ignored by every gate)
After you have read this brief and the sources/tests you need, and BEFORE your first edit, echo exactly:
```
[TILLER-METRIC-V1] run=command-center-2026-08-26 batch=F0b attempt=1 role=implementer
  marker=DRV-F0b-21 event=context_ready ts_ns=$(date +%s%N) head=$(git rev-parse HEAD)
```
Run it as shell so the timestamp and HEAD are real. If you forget it, nothing breaks and nothing fails — it is measurement, not a gate.

## Emit protocol (MANDATORY)
Build it, run the focused tests, then commit atomically **with the slice id in the commit SUBJECT as a delimited token** — `feat(F0b): <summary>` or `[F0b] <summary>`. Tiller binds your commit to this slice ONLY via that tag; an untagged subject is rejected as a foreign commit and the slice PARKS. ONLY after the commit lands, append ONE line to /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md:
`[projcore callback] implementer F0b STATUS: DONE — commit <sha> <one line: what changed, max 100 chars>`
**Emit it in the SAME command as the commit**, so the callback cannot be lost if your turn ends at the commit — the `&&` keeps the ordering guarantee (nothing is appended unless the commit succeeded):
```sh
git commit -m '[F0b] <summary>' \
  && printf '%s\n' '[projcore callback] implementer F0b STATUS: DONE — commit '"$(git rev-parse --short HEAD)"' <what changed>' >> /home/agjrom/TGBOTS/AGJAssist/AGJ_Upgrade/command-center-2026-08-26/callbacks.md
```
Use BLOCKED only if you genuinely could NOT commit (never after a successful commit): `[projcore callback] implementer F0b STATUS: BLOCKED — <reason>`. Do not widen scope.
