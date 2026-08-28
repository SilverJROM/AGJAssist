# F3 standard red-team validation — marker DRV-F3-21, attempt 4

Commit under test: `bc17fe2cc9c068e02b248d78dbe0dddd5117788b` (analysed via `git show` / `git diff bc17fe2^..bc17fe2`, NOT `git rev-parse HEAD`).
Test-only diff (+5/-3 in `e2e/command-center-refresh.spec.ts`). `git diff --stat e3afd7b bc17fe2 -- src/web/public/app.js`
is EMPTY: the product code is byte-identical to the attempt-2 commit.

## Scope-authority note (mandatory)
I1/I2 have **no criterion text in og-requirements.md**; the SCOPE paragraph is the authority and states an OUTCOME, not a
MECHANISM. The mechanism under test is unchanged: `processRefreshSnapshot()` keeps entries up to the last YOU turn,
rebuilds the agent tail with `applyAgentPatch(kept, latest)`, and retires `openAgentAfterYouRef` / `sendBaselineRef`.

## Focused test — **FAIL (flaky)**
`timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-refresh.spec.ts --project=cc`, run
three times back-to-back (`F3-focused-m24-a4.log`):
- run 1: 1 passed (11.3s), exit 0
- run 2: **1 failed**, exit 1 — `Test timeout of 30000ms exceeded` at line 185 (`midsend poll fixture`)
- run 3: 1 passed (29.9s), exit 0 — 0.1s under the ceiling
Per the standing contract a nonzero exit is a FAIL, fail closed.

## Test discrimination — **PASS**, the attempt-3 prescription worked
Each mutant is the shipped spec run against `/app.js` served through a route that reverts part of the product change
(needle asserted unique), with `test.setTimeout(120000)` so a failure means the MUTATION and not the box:

| mutant | reverts | observed |
|---|---|---|
| M1 | `kept` slice → `[]` | **RED** at line 182 (`terminal-turn-user` 1 → 0), exit 1 ✅ |
| M2 | both reset lines removed | **RED** at line 204 (`midsend poll fixture`), exit 1 ✅ |
| M2a | only `openAgentAfterYouRef.current = false;` removed | **RED** at line 204, exit 1 ✅ |
| M2b | only `sendBaselineRef.current = '';` removed | GREEN — expected, see the attempt-3 report; defensive line with no constructible user-visible failure |

## Product behaviour — re-run at THIS commit. **PASS**
`F3-dom-aria-m24-a4.json` / `F3-dom-aria-m24-a4b.json`: LENS 1 mid-send refresh keeps the YOU turn and the live poll
(`youTurnsAfter=1`, `livePollRendered=true`); LENS 3 the agent tail is still replaced (`showsReplyTwo=true`,
`youTextKept=true`); LENS 4 a failed YOU turn keeps its `↻ Resend` affordance (`resendAfter=1`); LENS 5/6 the reset is
load-bearing and HEAD has it (`true` vs `false` on the mutant).

## Root cause of the flake — measured, not inferred
An instrumented copy of the journey (`F3-timing-m24.spec.ts`, marks in `F3-timing-m24.jsonl`, 5 runs) shows every wait
AFTER the view mounts is stable at **~10.2s** (view-mounted → midsend-poll-rendered: 10135, 10126, 10138, 10131, 10138 ms).
What varies is the MOUNT: **1207, 2470, 4801, 13515, 16893 ms**. Two of those runs finished at 24.9s and 28.1s — the
second is 1.9s under the 30000ms per-test timeout in `playwright.config.ts`. A mount around 20s, as in focused run 2,
puts the last assertion past the ceiling; the failure transcript shows the correct pre-poll state, i.e. the clock ran out
mid-assertion, not a product freeze.
`F3-netprobe-m24.spec.ts` rules the CDN in as a contributor but not the driver: the mount phase fetches
`telegram.org/js/telegram-web-app.js` (~850ms), `esm.sh/preact`, `esm.sh/htm` and a jsdelivr stylesheet, but on a quiet
box the whole mount is a consistent ~1.2s. The jitter tracks machine load — `uptime` showed load ~2.8 with another
project's node process at 173% CPU during the failing window. This is a shared, bursty box; the journey's ~10.2s of
deliberate waits (a 3000ms settle sleep plus two 1200ms route delays) leaves no headroom for it.

## FIXCHECK — the candidate was run before being prescribed
Shipped spec + `test.setTimeout(90000)` as the first line of the test: **5 runs, 5 passed**, exits 0
(`F3-fixcheck-timeout-m24.spec.ts`). Discrimination survives the longer timeout — the four mutants above already carry
`test.setTimeout(120000)` and M1/M2/M2a still go red at the same lines.

## Verdict: **FAIL** — implementation correct, discrimination now correct, but the slice's gate test does not pass
reliably: 1 failure in 3 consecutive runs, exit 1. One line fixes it and provably does not weaken the test.
