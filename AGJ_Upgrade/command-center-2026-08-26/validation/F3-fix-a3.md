FINDING 1 of 1
WHAT FAILED: `src/web/public/app.js` is CORRECT — do not touch it. The mid-send specimen added by this commit
(`e2e/command-center-refresh.spec.ts` lines 169-184) still does not discriminate. Proof: the shipped spec, byte-for-byte,
run against an `/app.js` served through a Playwright route with part of the product change reverted (each mutant asserts
its needle matched exactly once):
  - M1 (`const kept = lastUser >= 0 ? list.slice(0, lastUser + 1) : [];` -> `const kept = [];`)  => RED at line 181, exit 1. Correct.
  - M2 (delete BOTH `openAgentAfterYouRef.current = false;` and `sendBaselineRef.current = '';`) => `1 passed`, exit 0. WRONG.
  - M2a (delete ONLY `openAgentAfterYouRef.current = false;`)                                     => `1 passed`, exit 0. WRONG.
ROOT CAUSE (measured, not inferred): the mid-send refresh is served by the SAME route branch that sleeps 1200ms
(`await new Promise(r => setTimeout(r, 1200));`), so `processRefreshSnapshot` runs ~1.6s after `sendBtn.click()`. But
`captureCommandResult` has already returned by ~1.15s: line 172 sets `nonRefreshOutput = 'initial output fixture'`
immediately before the send, so the FIRST capture read sees a change, `changed` becomes true, and the loop exits after two
stable reads (250 + 450 + 450 ms) instead of running its full 8 iterations. `performSend` therefore clears
`openAgentAfterYouRef` through the normal path BEFORE the rebuild runs, and the reset the specimen exists to exercise is a
no-op. The comment on line 170 ("captureCommandResult runs ~3.4s") holds only when the pane output does NOT change during
the capture, which is not this arrangement.
THE FIX: keep the whole block, keep the 400ms wait, keep the literals — make the MID-SEND refresh response return
IMMEDIATELY so the rebuild lands inside the send window. Three edits to `e2e/command-center-refresh.spec.ts`:
  1. beside `let nonRefreshOutput = 'initial output fixture';` add:
         let delayRefreshResponse = true;
  2. in the `**/api/tmux/panes/*/output*` route, change
         await new Promise(r => setTimeout(r, 1200));
     to
         if (delayRefreshResponse) await new Promise(r => setTimeout(r, 1200));
     (the earlier refreshes still need the delay — they assert `Refreshing` before `Updated`; only the mid-send one must not have it)
  3. in the mid-send block, immediately BEFORE
         pendingRefreshOutput = 'initial output fixture\nmidsend refresh body fixture';
     add:
         delayRefreshResponse = false;   // land the rebuild INSIDE the send window
While there, correct the line-170 comment: the capture exits early (~1.15s) here because line 172 changes the pane output
right before the send; the specimen works because the refresh response is now immediate, not because the capture is long.
THIS EXACT CHANGE WAS BUILT AND RUN BEFORE BEING PRESCRIBED (validation/F3-fixcheck-*-m23.spec.ts, log
validation/F3-redteam-probe-m23-a3.log):
  - on HEAD: 1 passed, exit 0
  - on the M2 mutant: 1 failed, exit 1, at line 203 — `midsend poll fixture` never arrives, the transcript is frozen on
    `midsend refresh body fixture`
  - on the M2a mutant: 1 failed, exit 1 — it pins the load-bearing line specifically
DO NOT chase M2b. Deleting ONLY `sendBaselineRef.current = '';` leaves the spec green even with the fix above, and that is
correct: that line only changes behaviour when `applyConversationSnapshot` runs with `openNew === true` via the
`hasBaseline` branch, and after a refresh either an agent entry was appended (`openNew` false) or the refresh snapshot
equals the pre-send snapshot (both diffs identical). It is defensive code with no constructible user-visible failure —
spending an attempt on a specimen for it would be wasted.
WHY THE LAST ATTEMPT MISSED IT: F3-fix-a2.md named the ordering (400ms, no settle wait) and the new-body requirement but
not the RESPONSE LATENCY — with the shared 1200ms route delay the refresh resolves after the send has already finished, so
the correct ordering of the CLICKS still produced the wrong ordering of the EFFECTS.
