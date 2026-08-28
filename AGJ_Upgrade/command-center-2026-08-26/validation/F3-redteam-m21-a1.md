# F3 standard red-team validation — marker DRV-F3-21, attempt 1

Commit under test: `f825618ec778ca5209ce59ecf3babead8f02dc02` (analysed via `git show` / `git diff f825618^..f825618`, NOT `git rev-parse HEAD`).
Focused command: `timeout --signal=TERM --kill-after=15s 180s npx playwright test e2e/command-center-refresh.spec.ts --project=cc`
Focused result: **PASS** — 1 passed (`F3-focused-m21-a1.log`).

## Scope-authority note (mandatory)
I1 and I2 have **no criterion text in og-requirements.md**. Per the brief I treat the SCOPE paragraph as the authority:
"always-reachable refresh control on FriendlyTerminalView; re-pull pane output and session metadata together;
in-progress then completion; composer stays interactive."
That scope states OUTCOMES, not a MECHANISM for *how* the re-pull reaches the rendered transcript. The mechanism this
commit chose is: `refreshOutput()` → `processRefreshSnapshot()` → `setEntries(applyAgentPatch([], latest))`, i.e. a full
transcript rebuild **from an empty seed**. Naming that choice is what the lenses below attack.

## Lenses

### LENS A — does the shipped assertion discriminate? **PASS**
Mechanism: served `/app.js` through a Playwright route that reverts exactly this commit's one product line
(`processRefreshSnapshot(...)` → `processSnapshot(...)`), then replayed the shipped journey's core claim.
Result (`F3-dom-aria-m21-a1.json`): `lensA_mutationApplied=true`, `lensA_stillStale=true`, `lensA_showsRefreshed=false` —
the mutant keeps `initial output fixture`. The new fixtures/assertions in `e2e/command-center-refresh.spec.ts` are
genuinely discriminating; the a4 TEST_NOT_DISCRIMINATING finding is closed.
Evidence: `F3-m21-lensA-mutant-after.png`.

### LENS B — restored conversation history vs the rebuild. **FAIL**
Seeded the app's OWN persistent recent-message memory (`agj_term_mem_TEST_0.0`), opened the pane, confirmed the YOU
bubble rendered, then clicked Refresh.
Result: `lensB_userTurnsBefore=1` → `lensB_userTurnsAfter=0`, `lensB_youBubbleSurvived=false`, and
`lensB_memoryAfterRefresh` shows localStorage **overwritten** with a single agent entry — the history is not just hidden,
it is destroyed on disk (the `entries` effect calls `writeTerminalMemory`).
Evidence: `F3-m21-lensB-before.png`, `F3-m21-lensB-after.png`.

### LENS C — post-refresh stability (is the "not stale" assertion transient?). **PASS**
Waited 3s (3+ background poll cycles) after the refresh completed. `lensC_settledHasInitial=false`,
`lensC_settledHasRefreshed=true`. The 1s poll does not re-introduce the replaced text; the shipped assertion is stable,
not a race. Evidence: `F3-m21-lensC-settled.png`.

### LENS D — live send through the public composer, then Refresh. **FAIL**
No seeded storage: typed into `[data-testid="terminal-composer-input"]`, clicked `terminal-send-command`, confirmed one
`terminal-turn-user`, then clicked Refresh. `lensD_youTurnsAfter=0`, `lensD_sentMessageSurvived=false`.
LENS E is the control for the same journey with the one product line reverted: `lensE_youTurnsAfter=1`,
`lensE_sentMessageSurvived=true`, and the pre-commit build still shows the "⚠ Not sent … ↻ Resend" affordance.
So the loss is **introduced by this diff**, not pre-existing — and it contradicts the invariant documented above
`performSend`: "it persists via the recent-message memory, so a message that didn't go through is never silently lost".
Evidence: `F3-m21-lensD-before-refresh.png`, `F3-m21-lensD-after-refresh.png`, `F3-m21-lensE-control-after.png`,
`F3-dom-aria-m21-a1b.json`.

### LENS F/G — Refresh clicked mid-send, then the live view. **FAIL (worst finding)**
The refresh control is NOT disabled while a send is capturing, so this is a reachable user action. Sent a message,
clicked Refresh 500ms later, then moved the pane on and waited 6s (6+ poll cycles).
HEAD: `lensF_head_youTurnsAfter=0`, `lensF_head_livePollRendered=false` — the transcript is **frozen** on
`initial output fixture`; the new pane text never appears.
Pre-commit control: `lensG_precommit_youTurnsAfter=1`, `lensG_precommit_livePollRendered=true`.
Mechanism: `processRefreshSnapshot` rebuilds `entries` from `[]`, deleting the YOU turn, while `openAgentAfterYouRef.current`
is still `true` from `performSend`. Every later `applyConversationSnapshot` then hits
`if (openAgentAfterYouRef.current) { if (lastUserIdx < 0 || lastUserIdx < lastAgentIdx) return list; }` and returns the
list unchanged — and the line that clears that ref sits *after* the early return, so it never clears. Recovery requires a
pane switch (`loadInitial`) or a new send. Evidence: `F3-m21-lensF_head.png`, `F3-m21-lensG_precommit.png`,
`F3-dom-aria-m21-a1c.json`.

### LENS H — focused-spec coverage of the above. **FAIL**
`e2e/command-center-refresh.spec.ts` never creates a YOU turn and never asserts anything after the refresh settles, so
neither the history loss nor the freeze can turn it red. It proves replacement only for a transcript that contains
nothing but agent output.

## Verdict: **FAIL** — the a4 prescription's outcome was reached, but with a seed (`[]`) that the prescription did not
ask for, and that seed regresses two adjacent, user-visible behaviours the pre-commit build had.
