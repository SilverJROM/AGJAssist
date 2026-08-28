# F3 standard red-team validation — marker DRV-F3-21, attempt 2

Commit under test: `e3afd7b3da8cb0a9ac1bbe99e4d5ad436ed826f5` (analysed via `git show` / `git diff e3afd7b^..e3afd7b`, NOT `git rev-parse HEAD`).
Focused command: `timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-refresh.spec.ts --project=cc`
Focused result: **PASS** — 1 passed, exit 0 (`F3-focused-m22-a2.log`).

## Scope-authority note (mandatory)
I1 and I2 have **no criterion text in og-requirements.md**; per the brief the SCOPE paragraph is the authority
("always-reachable refresh control; re-pull pane output and session metadata together; in-progress then completion;
composer stays interactive"). That is an OUTCOME, not a MECHANISM. The mechanism this commit uses is
`refreshOutput()` → `processRefreshSnapshot()` → keep entries up to the last YOU turn (`lastRoleIndex(list,'user')`),
rebuild the agent tail with `applyAgentPatch(kept, latest)`, and retire the send-lifecycle refs
(`openAgentAfterYouRef`, `sendBaselineRef`). The lenses below attack that mechanism and the test that guards it.

## Product behaviour — all three attempt-1 findings are genuinely fixed

### LENS 1 — refresh mid-send keeps the YOU turn and the live view. **PASS**
Send, click Refresh 500ms later (the control is not disabled while sending), move the pane on, wait 6s.
`lens1_head_midsend_youTurnsAfter=1`, `lens1_head_midsend_livePollRendered=true`. At attempt 1 this was 0 / false.
Evidence: `F3-m22-lens1_head_midsend.png`.

### LENS 3 — the rebuild still replaces the stale agent tail when a YOU turn is kept. **PASS**
With `AGENT REPLY ONE` on screen, a send, then a refresh whose snapshot is `AGENT REPLY TWO ONLY`:
`lens3_showsReplyTwo=true`, `lens3_youTextKept=true`, `lens3_youTurnsAfter=1`. `lens3_staleReplyOneGone=false` is
CORRECT, not a defect — `AGENT REPLY ONE` sits in the agent turn that precedes the YOU turn, i.e. it is conversation
history, and the tail that the refresh owns (everything after the last YOU) was replaced. Evidence:
`F3-m22-lens3-tail-replace.png`.

### LENS 4 — a failed YOU turn and its only recovery affordance survive. **PASS**
Seeded `agj_term_mem_TEST_0.0` with a `failed:true` YOU entry carrying `resendText`. After refresh:
`lens4_resendBefore=1` → `lens4_resendAfter=1`, `lens4_failedYouSurvived=true`, and `lens4_memoryAfter` still holds the
failed entry. The invariant documented above `performSend` ("a message that didn't go through is never silently lost")
holds again. Evidence: `F3-m22-lens4-failed-you.png`.

### LENS 5 — the send-ref reset is load-bearing, and HEAD has it. **PASS**
Mid-send refresh whose response carries NEW body text (so the rebuild actually opens an agent entry after the kept YOU
turn): `lens5_head_livePollRendered=true`. Evidence: `F3-m22-lens5_head.png`, `F3-dom-aria-m22-a2b.json`.

## Test discrimination — mutation pass over the shipped spec

Both mutants are the SHIPPED spec, byte-for-byte, run against an `/app.js` served through a Playwright route that
reverts one half of this commit's product change. Each asserts its needle matched exactly once before proceeding.

### MUTANT M1 — `const kept = lastUser >= 0 ? list.slice(0, lastUser + 1) : [];` → `const kept = [];`. **RED (correct)**
`e2e/command-center-refresh.spec.ts:181` fails: `terminal-turn-user` expected 1, received 0. Exit 1.
The history half of the fix is properly guarded.

### MUTANT M2 — the two reset lines (`openAgentAfterYouRef.current = false; sendBaselineRef.current = '';`) removed. **GREEN (WRONG)**
`1 passed`, exit 0. The shipped spec cannot tell the fixed build from the unfixed one.

### LENS 6 — and the behaviour M2 removes IS broken, so the green is a false negative. **FAIL**
The same mid-send-with-new-body journey as LENS 5, run against the M2 mutant: `lens6_m2_mutationApplied=true`,
`lens6_m2_livePollRendered=false` — the transcript freezes on `REFRESH BODY rho` and the later pane text never arrives.
Mechanism: with the resets gone, `openAgentAfterYouRef.current` is still `true` from `performSend` while the rebuild has
appended a fresh agent after the kept YOU turn, so `lastUserIdx < lastAgentIdx` and
`applyConversationSnapshot`'s guard `if (openAgentAfterYouRef.current) { … return list; }` returns unchanged on every
later poll — and the line that clears that ref sits after the early return. Evidence: `F3-m22-lens6_m2.png`.

Why the shipped spec misses it: its freeze-prevention block refreshes only AFTER
`await page.waitForTimeout(3000)  // Allow send to settle`. By then the completed `performSend` has already cleared
`openAgentAfterYouRef` through the normal path, so the assertion at line 167 passes for a build that has never executed
the reset. The specimen that discriminates is the refresh clicked WHILE the send is still capturing, with a refresh
response that carries new body text.

## Verdict: **FAIL** — the implementation is right and the history half is well guarded, but half the product change
(the fix for attempt 1 Finding 2) is unprotected: deleting those two lines leaves the suite green while a reachable user
action permanently freezes the live transcript.
