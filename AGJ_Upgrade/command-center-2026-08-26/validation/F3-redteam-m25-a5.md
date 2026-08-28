# F3 standard red-team validation — marker DRV-F3-21, attempt 5

Commit under test: `41459b9897b7615ac3135f824369baa32d967192` (analysed via `git show` / `git diff 41459b9^..41459b9`,
NOT `git rev-parse HEAD`). Test-only diff: +3 lines (a comment and `test.setTimeout(90000);`).
`git diff --stat e3afd7b 41459b9 -- src/web/public/app.js` is EMPTY — the product code is byte-identical to the
attempt-2 commit, where it was first validated.

## Scope-authority note (mandatory)
I1 and I2 have **no criterion text in og-requirements.md**. Per the brief I treat the SCOPE paragraph as the authority:
"always-reachable refresh control on FriendlyTerminalView; re-pull pane output and session metadata together; in-progress
then completion; composer stays interactive." That is an OUTCOME, not a MECHANISM. The mechanism I judged against, and
which the spec now guards, is: `refreshOutput()` → `processRefreshSnapshot()`, which keeps entries up to the last YOU turn
(`lastRoleIndex(list,'user')`), rebuilds the agent tail with `applyAgentPatch(kept, latest)`, and retires the
send-lifecycle refs `openAgentAfterYouRef` / `sendBaselineRef`.

## Focused test — **PASS**, five consecutive runs
`timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-refresh.spec.ts --project=cc`
(`F3-focused-m25-a5.log`): 12.5s / 12.7s / 12.4s / 12.3s / 12.5s — **5 passed, exit 0 every time**. At attempt 4 the same
command failed 1 run in 3.

## LENS A — does the fix actually address the measured failure mode? **PASS (causal, not correlational)**
The box was quiet during those five runs (load 1.97), so green runs alone prove nothing. I reproduced the failure
condition instead: a route that stalls the parser-blocking `<head>` script `https://telegram.org/js/telegram-web-app.js`
for 20s, simulating the 1.2s–16.9s mount jitter measured at attempt 4. Same journey, only the test timeout differs:
- `test.setTimeout(90000)` (as shipped): **1 passed (31.6s)**, exit 0
- `test.setTimeout(30000)` (the pre-fix config default): **1 failed** — `Test timeout of 30000ms exceeded`, exit 1,
  the same signature as the attempt-4 flake
Evidence: `F3-headroom90-m25.spec.ts`, `F3-headroom30-m25.spec.ts`.

## LENS B — does the raised ceiling MASK a hang? **PASS**
Every transcript assertion in the spec carries its own bounded budget (`{ timeout: 10000 }`; the `toHaveCount` calls use
the 5s default), so a frozen build fails at the assertion, not at the test ceiling. Measured: the M2 mutant fails in
**22s wall** (webServer boot + ~11s journey + its 10s assertion budget) — nowhere near 90s. Worst wall-clock observed
anywhere in this validation is 31.6s, comfortably inside the standing contract's 180s wrapper.
`test.setTimeout()` called inside a test body is a per-test override: it does not touch `playwright.config.ts` and does
not change the ceiling for any other spec.

## LENS C — test discrimination. **PASS**
Each mutant is the shipped spec byte-for-byte, run against `/app.js` served through a route that reverts part of the
product change (needle asserted unique). They inherit the spec's OWN `test.setTimeout(90000)` — no validator override:

| mutant | reverts | observed |
|---|---|---|
| M1 | `kept` slice → `[]` | **RED** at line 184 (`terminal-turn-user` 1 → 0), exit 1 |
| M2 | both reset lines removed | **RED** at line 206 (`midsend poll fixture`), exit 1 |
| M2a | only `openAgentAfterYouRef.current = false;` removed | **RED** at line 206, exit 1 |
| M2b | only `sendBaselineRef.current = '';` removed | GREEN — settled at attempt 3: after a refresh either an agent entry was appended (`openNew` false) or the refresh snapshot equals the pre-send snapshot (both diffs identical), so no user-visible failure can be constructed from it |

## LENS D — product behaviour, re-run at THIS commit. **PASS**
`F3-dom-aria-m25-a5.json` / `F3-dom-aria-m25-a5b.json`:
- mid-send refresh keeps the YOU turn and the live poll (`youTurnsAfter=1`, `livePollRendered=true`)
- the rebuild still replaces the agent tail with a YOU turn kept (`showsReplyTwo=true`, `youTextKept=true`)
- a failed YOU turn keeps its `↻ Resend` affordance and its memory entry (`resendAfter=1`, `failedYouSurvived=true`)
- the reset is load-bearing and HEAD has it (`lens5_head_livePollRendered=true` vs `lens6_m2_livePollRendered=false`)

## LENS E — "composer stays interactive" tested harder than the spec does. **PASS**
The shipped spec only asserts the composer RETAINS its value across a refresh. I typed into it through the public
control while a refresh was deliberately held in flight for 2.5s, and again afterwards (`F3-dom-aria-m25-a5c.json`):
`duringRefresh_editable=true`, `duringRefresh_value='typed-while-refreshing'`, that text survives the refresh
completing (`afterRefresh_valueKept='typed-while-refreshing'`), `afterRefresh_editable=true`, and
`afterRefresh_sendEnabled=true`. Evidence: `F3-m25-lens7-during-refresh.png`, `F3-m25-lens7-after-refresh.png`.

## Verdict: **PASS** — implementation correct, the spec discriminates every load-bearing half of it, the journey passes
five consecutive runs, and the one-line headroom change is proven to fix the measured failure mode without masking a hang.
