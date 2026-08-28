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

# [driver] F3 CORRECTION (attempt 2) — fix EVERY finding the validator listed

The independent validator FAILed F3: defect_class=IMPL_INCOMPLETE gate=None.
**Validator's callback summary:** [projcore callback] validator F3 STATUS: DONE — FAIL refresh rebuild from empty seed wipes YOU turns and freezes live poll

## THE VALIDATOR'S PRESCRIPTION (verbatim — this is the fix, not a hint)

```
FINDING 1 of 3
WHAT FAILED: `processRefreshSnapshot` in `src/web/public/app.js` (~line 3709) rebuilds the transcript from `const seed = []`, so clicking Refresh DELETES every YOU turn and every earlier agent turn that is not in the current pane capture. Probe LENS D (live send through `[data-testid="terminal-composer-input"]` + `terminal-send-command`, then Refresh): `terminal-turn-user` count 1 -> 0, `lensD_sentMessageSurvived=false`. LENS E is the same journey with only this commit's one product line reverted: count stays 1. So the loss is introduced by this diff. Worse, the `entries` effect then calls `writeTerminalMemory(target, entries)`, so `localStorage['agj_term_mem_TEST_0.0']` is OVERWRITTEN with the agent-only list (`lensB_memoryAfterRefresh` in validation/F3-dom-aria-m21-a1.json) — the history does not come back on reopen, and a failed message's `resendText` / "⚠ Not sent · ↻ Resend" affordance is destroyed with it. That directly contradicts the invariant in the comment above `performSend`: "it persists via the recent-message memory, so a message that didn't go through is never silently lost".
THE FIX: do not seed from `[]`. Seed from the entries that are already on screen, truncated at the last YOU turn, so the rebuild replaces only the stale agent tail:
    const cutAt = /* index of the last entry whose role === 'user' */;
    setEntries(prev => {
      const list = Array.isArray(prev) ? prev : [];
      const lastUser = lastRoleIndex(list, 'user');
      const kept = lastUser >= 0 ? list.slice(0, lastUser + 1) : [];
      return applyAgentPatch(kept, latest);
    });
With no YOU turn, `kept` is `[]` and today's behaviour (and the shipped spec) is unchanged; with a YOU turn present, `applyAgentPatch` opens a FRESH agent entry after it from `latest`, so the stale agent body is still replaced. (`lastRoleIndex` already exists in this component.) Note `setEntries(prev => ...)` is required — the current code computes `entriesNext` outside the updater and would race a concurrent send.
WHY THE LAST ATTEMPT MISSED IT: F3-fix-a4.md prescribed `applyAgentPatch(conversationSeed(readTerminalMemory(target) || {}), latest)`; the attempt substituted an empty seed, which satisfies the a4 assertion but drops the seed the prescription named.

FINDING 2 of 3
WHAT FAILED: Refresh clicked WHILE a send is still capturing permanently FREEZES the live transcript. The refresh button is only disabled on `refreshing`, never on `sending`, so this is reachable. Probe LENS F (send, Refresh 500ms later, then move the pane on and wait 6s = 6+ poll cycles): `lensF_head_livePollRendered=false` — the view is stuck on `initial output fixture` and the new pane text never renders. LENS G, the same journey with the product line reverted, renders it (`lensG_precommit_livePollRendered=true`). Mechanism: `performSend` sets `openAgentAfterYouRef.current = true`; `processRefreshSnapshot` then rebuilds `entries` without the YOU turn; from then on every `applyConversationSnapshot` hits `if (openAgentAfterYouRef.current) { if (lastUserIdx < 0 || lastUserIdx < lastAgentIdx) return list; }` and returns unchanged — and the line that clears that ref (`if (openAgentAfterYouRef.current && lastRoleIndex(next,'agent') > lastRoleIndex(next,'user')) openAgentAfterYouRef.current = false;`) sits AFTER that early return, so it never runs. Only a pane switch (`loadInitial`) or a new send recovers the view.
THE FIX: `processRefreshSnapshot` must reset the post-send bookkeeping it invalidates, in the same function, right after it assigns `previousSnapshotRef.current = latest`:
    openAgentAfterYouRef.current = false;
    sendBaselineRef.current = '';
This is required EVEN IF Finding 1 is fixed: with the YOU turn preserved, the rebuild appends a fresh agent AFTER it, so `lastUserIdx < lastAgentIdx` is true and the same guard freezes the view on the next poll. The refresh has just re-established a full snapshot baseline, so the "don't patch the pre-send agent" state is stale by construction.
WHY THE LAST ATTEMPT MISSED IT: the new function copies the fields `processSnapshot` writes, but not the send-lifecycle refs that only `applyConversationSnapshot` (which it deliberately bypasses) knows how to retire.

FINDING 3 of 3
WHAT FAILED: `e2e/command-center-refresh.spec.ts` cannot turn red on either finding above. Its journey never produces a `terminal-turn-user` entry, and it makes no assertion after the refresh has settled, so it proves replacement only for a transcript that contains nothing but agent output. (Its new non-empty-fixture assertions ARE discriminating for the case they cover — a served-app.js mutation reverting `processRefreshSnapshot` -> `processSnapshot` leaves `initial output fixture` on screen, `lensA_stillStale=true` — so keep them.)
THE FIX: extend the same spec with two concrete specimens.
  (a) History: stub `**/api/tmux/panes/*/send*` with `{status:200, contentType:'application/json', body:'{"ok":true}'}`, fill `[data-testid="terminal-composer-input"]` with a literal such as `you-turn fixture`, click `[data-testid="terminal-send-command"]`, `await expect(page.locator('[data-testid="terminal-turn-user"]')).toHaveCount(1)`, then click refresh and assert `toHaveCount(1)` again plus `await expect(conv).toContainText('you-turn fixture')`.
  (b) Freeze: after that refresh, change the non-refresh `/output` fixture to a THIRD literal (`post refresh poll fixture`) and assert `await expect(conv).toContainText('post refresh poll fixture', { timeout: 10000 })` with no further clicks — the 1s background poll must still reach the transcript. Both literals are fixtures, not values read back from the mechanism under test; (b) fails today at the 10s timeout, (a) fails on `toHaveCount(1)` -> 0.
WHY THE LAST ATTEMPT MISSED IT: the a4 prescription only asked for a non-empty INITIAL fixture, and an agent-only transcript is the one shape in which an empty rebuild seed is indistinguishable from a correct one.
```
**Do this before inventing anything.** A slice spent four attempts each inventing a different mechanism while this file sat unread, and closed on the first attempt that had it. If the prescription is WRONG, say why in your callback — that is a finding worth more than a fifth invention.

Address EVERY finding in the prescription — if it lists FINDING 1 of 3, all three land in this one attempt. Leaving one for later does not defer it, it re-spends a whole cycle rediscovering it. If it says the real path is *untested/mocked/no-op*, you MUST write tests that drive the **ACTUAL** overmind code (the real watcher/completion/ingestion path) end-to-end — **do NOT mock, stub, or no-op the thing under test**; a test that asserts a mock is exactly the FAIL. Fix ALL of the listed findings and NOTHING beyond them — 'do not widen scope' means do not go past the prescription, never 'fix only the first item in it'. Re-run the focused tests, then re-commit atomically **with the slice id in the commit SUBJECT** — `feat(F3): <summary>` or `[F3] <summary>`. An untagged subject is read as a foreign commit and this slice parks again, exactly as it would on attempt 1. Then emit:
- **STANDING (north 2026-08-07):** the path in the slice `tests` column (below) is the test file THAT THIS SLICE MUST AUTHOR, then run green. It is an OUTPUT of the slice, not a precondition. A missing spec file is NEVER a reason to block — write the spec, make it pass, only then report DONE.
- test cmd: **use the `tests` command from YOUR slice row BELOW, exactly as written** — it is the authority. Do NOT substitute a build/test command the project does not have: if the row's command is a plain `node -e ...` one-liner, run that and nothing else. Only run `npm run build` / `npm ci` if the row asks for it or the repo demonstrably has that script. A missing script you were never asked to run is NOT a blocker.
- **YOUR TEST MUST NOT COMPUTE ITS EXPECTED VALUE FROM THE MECHANISM UNDER TEST** (north D-082). The expected value comes from a LITERAL, a FIXTURE, or a SECOND PATH that does not share the code under test. An assertion that asks the thing it is testing what to expect passes whatever that thing does, including wrong, and proves nothing.
  **Concretely: supply an input the mechanism would NOT choose on its own, then assert the output honours it** — a routing selection that is deliberately not the health-ranked winner; a value read back through the public path rather than raw SQL; a host deliberately different from the default. **If you cannot say what would make your test FAIL, it is not a test yet** — say so in your callback rather than reporting DONE on it.
- IF (and only if) your row's command is vitest: `npx vitest run <the focused spec> --minWorkers=1 --maxWorkers=4` — the pool-agnostic worker cap is MANDATORY on EVERY vitest run (incl. any full-suite check); uncapped Vitest thrashes/OOMs this box and kills every tmux session including live runs.
- E2E/UI/browser commands (Playwright etc.): ALWAYS wrap them as `timeout --signal=TERM --kill-after=15s 180s <command>` — a webServer/browser teardown can hang forever and freeze this seat; TERM alone may not kill an unresponsive child, so --kill-after SIGKILLs it. ANY nonzero exit (124 timeout, 137 killed, OR a real test failure) is a **FAIL, never a PASS** — fail closed; never infer a pass from partial output. If you pipe through `tee`, set `-o pipefail` (or read `${PIPESTATUS[0]}`) so the pipe cannot mask the failure.
`[projcore callback] implementer F3 STATUS: DONE — commit <new sha> <one line: what changed, max 100 chars>`

---

## THE SLICE (unchanged since attempt 1 — this is not the correction)

### Scope
Web UI layer: always-reachable refresh control on `FriendlyTerminalView`; re-pull pane output and session metadata together; in-progress then completion; composer stays interactive. Project `cc` supplies live API/tmux. North 2026-08-27 PLAN_SOUND: I1/I2 satisfiable; after L1 resume at L4 (sol) with budget 6 so >=2 strong informed attempts on the a4 remainder.

### Acceptance criteria — the TEXT is the contract, the id is only its name
- **I1** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)
- **I2** — ⚠ NO CRITERION TEXT FOUND in og-requirements.md. Treat the SCOPE above as the authority for this one, and say so in your callback if that is ambiguous. (Plan-invented ids such as `FH*` legitimately have no og-requirement.)

**If a criterion above does not describe the work in Scope, SAY SO instead of implementing toward it** — that is a PLAN_DEFECT, and it is worth more than another attempt spent satisfying the wrong thing. **If a criterion states an OUTCOME but not a MECHANISM, name the mechanism you chose in your callback.** A correction that re-invents the mechanism is how a slice reaches attempt 6: four attempts inventing, then one with the prescription in hand.

### Focused tests
`npx playwright test e2e/command-center-refresh.spec.ts --project=cc`
