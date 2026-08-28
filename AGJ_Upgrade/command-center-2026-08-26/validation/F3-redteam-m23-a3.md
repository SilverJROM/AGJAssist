# F3 standard red-team validation — marker DRV-F3-21, attempt 3

Commit under test: `e00ed40bb1082c44ebe1a9015795b5fc0ec6d533` (analysed via `git show` / `git diff e00ed40^..e00ed40`, NOT `git rev-parse HEAD`).
The diff is **test-only** (+16 lines in `e2e/command-center-refresh.spec.ts`); `src/web/public/app.js` is unchanged from the
attempt-2 commit.
Focused command: `timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-refresh.spec.ts --project=cc`
Focused result: **PASS** — 1 passed, exit 0 (`F3-focused-m23-a3.log`).

## Scope-authority note (mandatory)
I1/I2 have **no criterion text in og-requirements.md**; the SCOPE paragraph is the authority, and it states an OUTCOME,
not a MECHANISM. The mechanism under test is unchanged from attempt 2: `processRefreshSnapshot()` keeps entries up to the
last YOU turn, rebuilds the agent tail via `applyAgentPatch(kept, latest)`, and retires `openAgentAfterYouRef` /
`sendBaselineRef`. This attempt only adds the specimen that is supposed to guard the second half.

## Product behaviour — unchanged and still correct (lenses re-run at THIS commit)
`F3-dom-aria-m23-a3.json` / `F3-dom-aria-m23-a3b.json`:
- LENS 1 mid-send refresh keeps the YOU turn and the live poll: `youTurnsAfter=1`, `livePollRendered=true`. **PASS**
- LENS 3 the rebuild still replaces the agent tail with a YOU turn kept: `showsReplyTwo=true`, `youTextKept=true`. **PASS**
- LENS 4 a failed YOU turn keeps its `↻ Resend` affordance and its memory entry: `resendAfter=1`,
  `failedYouSurvived=true`. **PASS**
- LENS 5/6 the reset is load-bearing and HEAD has it: `lens5_head_livePollRendered=true` vs
  `lens6_m2_livePollRendered=false` on the mutant. **PASS**

## Test discrimination — mutation pass over the SHIPPED spec
Each mutant is the shipped spec byte-for-byte, run against `/app.js` served through a route that reverts part of the
product change, asserting the needle matched exactly once first.

| mutant | reverts | expected | observed |
|---|---|---|---|
| M1 | `const kept = … slice(0, lastUser+1) …` → `const kept = []` | RED | **RED** at line 181 (`terminal-turn-user` 1 → 0), exit 1 ✅ |
| M2 | both reset lines removed | RED | **GREEN**, `1 passed`, exit 0 ❌ |
| M2a | only `openAgentAfterYouRef.current = false;` removed | RED | **GREEN**, exit 0 ❌ |
| M2b | only `sendBaselineRef.current = '';` removed | — | GREEN, exit 0 |

The new mid-send block does not reach the state it was written for. **Root cause, verified by experiment, not inferred:**
the mid-send refresh response is served by the same route branch that sleeps 1200ms
(`await new Promise(r => setTimeout(r, 1200))`), so `processRefreshSnapshot` runs ~1.6s after the send click — but
`captureCommandResult` has already returned by ~1.15s. The block sets `nonRefreshOutput = 'initial output fixture'`
immediately before the send, so the FIRST capture read sees a change (`changed = true`) and the loop exits after two
stable reads instead of running its full 8 iterations. `performSend` therefore clears `openAgentAfterYouRef` through the
normal path BEFORE the rebuild runs, and the reset the specimen is meant to exercise is a no-op. The in-spec comment
"captureCommandResult runs ~3.4s" is only true when the pane output does NOT change during the capture.

## FIXCHECK — the candidate fix was tested, not just proposed
Candidate: gate the 1200ms sleep behind a flag and clear it for the mid-send refresh only (`delayRefreshResponse = false`),
so the rebuild lands at ~400ms, inside the send window. Same spec otherwise.
- on HEAD: **1 passed**, exit 0
- on the M2 mutant: **1 failed**, exit 1, at line 203 — `midsend poll fixture` never arrives; the transcript is frozen on
  `midsend refresh body fixture`
- on the M2a mutant: **1 failed**, exit 1 — so it pins the load-bearing line specifically
- on the M2b mutant: 1 passed — `sendBaselineRef.current = ''` stays unguarded (see below)

## Note on M2b — deliberately NOT a finding
`sendBaselineRef.current = ''` only changes behaviour when `applyConversationSnapshot` runs with `openNew === true` and
falls to the `hasBaseline` branch. After a refresh that appended an agent entry, `openNew` is false; after a refresh that
appended nothing, the refresh snapshot equals the pre-send snapshot, so the baseline diff and the previous-snapshot diff
are identical. No user-visible difference could be constructed, so it reads as defensive code, not a coverage gap. The
next seat should not spend an attempt hunting a specimen for it.

## Verdict: **FAIL** — the implementation remains correct and M1 is well guarded, but the specimen added by this commit
still cannot distinguish the fixed build from the unfixed one; a one-line route change (verified above) makes it.
