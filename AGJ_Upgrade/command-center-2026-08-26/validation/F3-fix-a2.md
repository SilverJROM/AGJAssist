FINDING 1 of 1
WHAT FAILED: The product change is CORRECT — do not touch `src/web/public/app.js`. What fails is discrimination: half of it is unguarded. Proof: the shipped `e2e/command-center-refresh.spec.ts`, byte-for-byte, was run against an `/app.js` served through a Playwright route with ONE half of the commit reverted.
  - MUTANT M1 (`const kept = lastUser >= 0 ? list.slice(0, lastUser + 1) : [];` -> `const kept = [];`) => RED at line 181, `terminal-turn-user` expected 1 received 0. Correct.
  - MUTANT M2 (delete the two lines `openAgentAfterYouRef.current = false;` and `sendBaselineRef.current = '';` from `processRefreshSnapshot`) => `1 passed`, exit 0. The spec cannot tell the fixed build from the unfixed one.
And the behaviour M2 removes really is broken (validation/F3-dom-aria-m22-a2b.json, LENS 6): with those two lines gone, a refresh clicked WHILE a send is still capturing, whose response carries new body text, leaves `openAgentAfterYouRef.current === true` while the rebuild has appended a fresh agent after the kept YOU turn; every later poll then hits `applyConversationSnapshot`'s guard `if (openAgentAfterYouRef.current) { if (lastUserIdx < 0 || lastUserIdx < lastAgentIdx) return list; }` and returns the list unchanged — the clearing line sits AFTER that early return — so the transcript freezes permanently (`lens6_m2_livePollRendered=false`, stuck on `REFRESH BODY rho`). At HEAD the same journey renders it (`lens5_head_livePollRendered=true`).
The spec misses it because its freeze block refreshes only after `await page.waitForTimeout(3000)  // Allow send to settle` (line 158): the completed `performSend` has already cleared `openAgentAfterYouRef` via the normal path, so line 167's assertion passes for a build that never executed the reset. Line 167 as written is near-vacuous — it asserts only that ordinary polling works, which it always did. Raising its timeout or moving the literal will NOT fix this.
THE FIX: the discriminating specimen is REFRESH-DURING-SEND, with the refresh response carrying NEW body text. Add a second block to `e2e/command-center-refresh.spec.ts` (keep the existing settled-send block — it guards M1):
    // Freeze prevention: refresh clicked WHILE the send is still capturing.
    // captureCommandResult runs ~3.4s, so 400ms after the click the send is still in flight
    // and openAgentAfterYouRef is still set — this is the only window that exercises the reset.
    nonRefreshOutput = 'initial output fixture';
    await composer.fill('midsend fixture');
    await sendBtn.click();
    await expect(page.locator('[data-testid="terminal-turn-user"]')).toHaveCount(2);
    await page.waitForTimeout(400);                       // NO settle wait — that is the point
    pendingRefreshOutput = 'initial output fixture\nmidsend refresh body fixture';
    await refreshBtn.click();
    await expect(refreshStatus).toContainText('Updated', { timeout: 10000 });
    await expect(page.locator('[data-testid="terminal-conversation"]')).toContainText('midsend refresh body fixture', { timeout: 10000 });
    // The pane moves on; only the 1s background poll can deliver this literal.
    nonRefreshOutput = 'initial output fixture\nmidsend refresh body fixture\nmidsend poll fixture';
    await expect(page.locator('[data-testid="terminal-conversation"]')).toContainText('midsend poll fixture', { timeout: 10000 });
Three requirements make it discriminate, and all three are load-bearing:
  (1) NO settle wait between `sendBtn.click()` and `refreshBtn.click()` — 400ms, inside `captureCommandResult`;
  (2) `pendingRefreshOutput` must be set to text NOT already on screen, so the rebuild opens an agent entry after the kept YOU turn (with an unchanged body the rebuild appends nothing, `lastUserIdx` stays greater than `lastAgentIdx`, the guard never fires, and the mutant passes — verified: LENS 2, `lens2_m2_livePollRendered=true`);
  (3) the final literal must arrive ONLY through `nonRefreshOutput` (the background poll), never through a refresh click.
Every expected value is a literal fixture served by the route, not a value read back from the mechanism under test. To confirm it discriminates before reporting DONE, delete those two reset lines from `processRefreshSnapshot`, run the spec, and check it goes red at the `midsend poll fixture` assertion; then restore them.
WHY THE LAST ATTEMPT MISSED IT: F3-fix-a1.md Finding 3(b) named the freeze literal but not the ORDERING — it said "after that refresh", and the attempt reasonably read that as after a settled send, which is the one arrangement in which the guard cannot fire.
